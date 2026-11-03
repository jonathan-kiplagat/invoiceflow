"""Vector PDF rendering for invoices and quotations (ReportLab Platypus).

Four templates share one layout engine and differ in typography, header composition,
table styling and colour. Tables repeat their header row on every page and long rows
split across pages, so large invoices and long descriptions never get cut off.
"""

from __future__ import annotations

import io
from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas as rl_canvas
from reportlab.platypus import (
    BaseDocTemplate,
    Flowable,
    Frame,
    HRFlowable,
    Image,
    KeepTogether,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)

from app.core.money import CURRENCIES, ZERO
from app.services.pdf.fonts import register_fonts
from app.services.pdf.view import DocView

PAGE_W, PAGE_H = A4
MARGIN_X = 18 * mm
MARGIN_TOP = 16 * mm
MARGIN_BOTTOM = 20 * mm
CONTENT_W = PAGE_W - 2 * MARGIN_X

INK = colors.HexColor("#111827")
MUTED = colors.HexColor("#6B7280")
LINE = colors.HexColor("#E5E7EB")
SOFT = colors.HexColor("#F9FAFB")

STATUS_LABELS = {
    "draft": "Draft", "sent": "Sent", "partially_paid": "Partially paid", "paid": "Paid",
    "overdue": "Overdue", "cancelled": "Cancelled", "accepted": "Accepted", "declined": "Declined",
    "expired": "Expired", "converted": "Converted",
}


# ---------------------------------------------------------------------------- formatting

def fmt_date(d: date, fmt: str) -> str:
    if fmt == "DD/MM/YYYY":
        return d.strftime("%d/%m/%Y")
    if fmt == "YYYY-MM-DD":
        return d.isoformat()
    return d.strftime("%d %b %Y")


def fmt_amount(v: Decimal) -> str:
    return f"{v:,.2f}"


def fmt_money(v: Decimal, currency: str) -> str:
    sym = CURRENCIES.get(currency, {}).get("symbol", currency)
    sign = "-" if v < 0 else ""
    return f"{sign}{sym} {abs(v):,.2f}"


def fmt_qty(v: Decimal) -> str:
    s = f"{v:,.3f}".rstrip("0").rstrip(".")
    return s or "0"


def fmt_rate(v: Decimal) -> str:
    s = f"{v:.3f}".rstrip("0").rstrip(".")
    return f"{s}%"


def txt(value: str | None) -> str:
    return escape(value or "").replace("\n", "<br/>")


def lighten(c: colors.Color, amount: float) -> colors.Color:
    return colors.Color(c.red + (1 - c.red) * amount, c.green + (1 - c.green) * amount, c.blue + (1 - c.blue) * amount)


# ---------------------------------------------------------------------------- themes

@dataclass
class Theme:
    key: str
    body: str
    bold: str
    heading: str
    title_font: str
    title_size: float
    accent: colors.Color
    ink: colors.Color = INK
    muted: colors.Color = MUTED


def make_theme(key: str, accent_hex: str) -> Theme:
    accent = colors.HexColor(accent_hex)
    if key == "corporate":
        return Theme(key, "Sans", "Sans-Bold", "Sans-Bold", "Sans-Bold", 24, accent)
    if key == "elegant":
        return Theme(key, "Serif", "Serif-Bold", "Serif-Bold", "Serif", 26, accent, ink=colors.HexColor("#1F2937"))
    if key == "classic":
        return Theme(key, "Sans", "Sans-Bold", "Sans-Bold", "Sans-Bold", 22, colors.HexColor("#111827"))
    return Theme("modern", "Poppins", "Poppins-Bold", "Poppins-Medium", "Poppins-Light", 30, accent)


class Styles:
    def __init__(self, t: Theme):
        base = 8.8 if t.key != "elegant" else 9.2
        self.body = ParagraphStyle("body", fontName=t.body, fontSize=base, leading=base * 1.38, textColor=t.ink)
        self.small = ParagraphStyle("small", parent=self.body, fontSize=base - 1, leading=(base - 1) * 1.4, textColor=t.muted)
        self.label = ParagraphStyle(
            "label", parent=self.body, fontName=t.bold if t.key != "elegant" else t.body, fontSize=7.2,
            leading=10, textColor=t.muted if t.key != "classic" else t.ink,
        )
        self.strong = ParagraphStyle("strong", parent=self.body, fontName=t.bold)
        self.biz_name = ParagraphStyle("biz", parent=self.body, fontName=t.heading, fontSize=13.5, leading=17)
        self.right = ParagraphStyle("right", parent=self.body, alignment=TA_RIGHT)
        self.right_small = ParagraphStyle("rsmall", parent=self.small, alignment=TA_RIGHT)
        self.center = ParagraphStyle("center", parent=self.body, alignment=TA_CENTER)
        self.center_small = ParagraphStyle("csmall", parent=self.small, alignment=TA_CENTER)
        self.cell = ParagraphStyle("cell", parent=self.body, fontSize=base - 0.3, leading=(base - 0.3) * 1.35)
        self.cell_r = ParagraphStyle("cellr", parent=self.cell, alignment=TA_RIGHT)
        self.th = ParagraphStyle("th", parent=self.cell, fontName=t.bold, fontSize=7.4, textColor=t.muted)
        self.th_r = ParagraphStyle("thr", parent=self.th, alignment=TA_RIGHT)
        self.title = ParagraphStyle(
            "title", parent=self.body, fontName=t.title_font, fontSize=t.title_size, leading=t.title_size * 1.15,
            alignment=TA_RIGHT, textColor=t.ink,
        )
        self.section = ParagraphStyle(
            "section", parent=self.body, fontName=t.bold if t.key != "elegant" else t.heading, fontSize=8,
            leading=11, textColor=t.accent if t.key in ("modern", "corporate", "elegant") else t.ink, spaceAfter=3,
        )
        self.total_label = ParagraphStyle("tl", parent=self.body, alignment=TA_LEFT)
        self.total_value = ParagraphStyle("tv", parent=self.body, alignment=TA_RIGHT)
        self.grand_label = ParagraphStyle("gl", parent=self.body, fontName=t.bold, fontSize=10.5, leading=14)
        self.grand_value = ParagraphStyle("gv", parent=self.grand_label, alignment=TA_RIGHT)


# ---------------------------------------------------------------------------- building blocks

def logo_flowable(logo: bytes | None, max_w: float, max_h: float) -> Flowable | None:
    if not logo:
        return None
    reader = ImageReader(io.BytesIO(logo))
    iw, ih = reader.getSize()
    scale = min(max_w / iw, max_h / ih)
    img = Image(io.BytesIO(logo), width=iw * scale, height=ih * scale)
    img.hAlign = "LEFT"
    return img


def business_lines(b: dict) -> list[str]:
    lines = []
    if b.get("address"):
        lines.append(txt(b["address"]))
    contact = " · ".join(x for x in [b.get("phone"), b.get("email")] if x)
    if contact:
        lines.append(txt(contact))
    if b.get("website"):
        lines.append(txt(b["website"]))
    ids = []
    if b.get("kra_pin"):
        ids.append(f"KRA PIN: {txt(b['kra_pin'])}")
    if b.get("vat_registered") and b.get("vat_number"):
        ids.append(f"VAT No: {txt(b['vat_number'])}")
    if b.get("registration_number"):
        ids.append(f"Reg. No: {txt(b['registration_number'])}")
    if ids:
        lines.append(" · ".join(ids))
    return lines


def customer_block(v: DocView, st: Styles) -> list[Flowable]:
    c = v.customer
    if not c:
        return [Paragraph("—", st.body)]
    out = [Paragraph(txt(c.get("name")), st.strong)]
    if c.get("company"):
        out.append(Paragraph(txt(c["company"]), st.body))
    if c.get("billing_address"):
        out.append(Paragraph(txt(c["billing_address"]), st.body))
    contact = " · ".join(x for x in [c.get("phone"), c.get("email")] if x)
    if contact:
        out.append(Paragraph(txt(contact), st.small))
    if c.get("tax_id"):
        out.append(Paragraph(f"PIN / Tax ID: {txt(c['tax_id'])}", st.small))
    return out


def meta_rows(v: DocView) -> list[tuple[str, str]]:
    rows = [
        (f"{v.title} no.", v.number),
        ("Issue date", fmt_date(v.issue_date, v.date_format)),
        (v.end_label, fmt_date(v.end_date, v.date_format)),
        ("Currency", v.currency),
    ]
    if v.pricing_mode == "inclusive":
        rows.append(("Prices", "Tax inclusive"))
    return rows


def amount_due(v: DocView) -> tuple[str, Decimal]:
    if v.kind == "invoice":
        return ("Amount due", v.balance_due)
    return ("Quotation total", v.total)


# ---------------------------------------------------------------------------- headers

def header_modern(v: DocView, t: Theme, st: Styles, logo: bytes | None) -> list[Flowable]:
    left: list[Flowable] = []
    lf = logo_flowable(logo, 42 * mm, 18 * mm)
    if lf:
        left += [lf, Spacer(1, 3 * mm)]
    left.append(Paragraph(txt(v.business.get("name")), st.biz_name))
    left += [Paragraph(line, st.small) for line in business_lines(v.business)]
    right = [
        Paragraph(v.title, st.title),
        Paragraph(txt(v.number), ParagraphStyle("n", parent=st.right, textColor=t.muted)),
    ]
    tbl = Table([[left, right]], colWidths=[CONTENT_W * 0.6, CONTENT_W * 0.4])
    tbl.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0)]))
    return [tbl, Spacer(1, 6 * mm), HRFlowable(width="100%", thickness=1.4, color=t.accent, spaceAfter=6 * mm)]


def header_corporate(v: DocView, t: Theme, st: Styles, logo: bytes | None) -> list[Flowable]:
    white = colors.white
    name = ParagraphStyle("cn", parent=st.biz_name, textColor=white, fontSize=15, leading=19)
    info = ParagraphStyle("ci", parent=st.small, textColor=lighten(t.accent, 0.78))
    title = ParagraphStyle("ct", parent=st.title, textColor=white, fontSize=24, leading=27)
    num = ParagraphStyle("cnum", parent=st.right, textColor=lighten(t.accent, 0.78), fontSize=10)
    left: list[Flowable] = []
    lf = logo_flowable(logo, 34 * mm, 16 * mm)
    if lf:
        holder = Table([[lf]], style=[("BACKGROUND", (0, 0), (-1, -1), white), ("BOX", (0, 0), (-1, -1), 0, white),
                                      ("LEFTPADDING", (0, 0), (-1, -1), 4), ("RIGHTPADDING", (0, 0), (-1, -1), 4),
                                      ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 4)])
        holder.hAlign = "LEFT"
        left += [holder, Spacer(1, 3 * mm)]
    left.append(Paragraph(txt(v.business.get("name")), name))
    left += [Paragraph(line, info) for line in business_lines(v.business)]
    right = [Paragraph(v.title.upper(), title), Paragraph(txt(v.number), num)]
    tbl = Table([[left, right]], colWidths=[CONTENT_W * 0.62, CONTENT_W * 0.38])
    tbl.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), t.accent),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 7 * mm), ("RIGHTPADDING", (0, 0), (-1, -1), 7 * mm),
        ("TOPPADDING", (0, 0), (-1, -1), 7 * mm), ("BOTTOMPADDING", (0, 0), (-1, -1), 7 * mm),
        ("ROUNDEDCORNERS", [6, 6, 6, 6]),
    ]))
    return [tbl, Spacer(1, 7 * mm)]


def header_elegant(v: DocView, t: Theme, st: Styles, logo: bytes | None) -> list[Flowable]:
    out: list[Flowable] = []
    lf = logo_flowable(logo, 40 * mm, 18 * mm)
    if lf:
        lf.hAlign = "CENTER"
        out += [lf, Spacer(1, 3 * mm)]
    name = ParagraphStyle("en", parent=st.biz_name, alignment=TA_CENTER, fontSize=18, leading=22)
    out.append(Paragraph(txt(v.business.get("name")), name))
    out += [Paragraph(line, st.center_small) for line in business_lines(v.business)]
    out += [
        Spacer(1, 3 * mm),
        HRFlowable(width="100%", thickness=0.8, color=t.accent, spaceAfter=1.2),
        HRFlowable(width="100%", thickness=0.3, color=t.accent, spaceAfter=4 * mm),
    ]
    spaced = " ".join(v.title.upper())
    out.append(Paragraph(spaced, ParagraphStyle("et", parent=st.center, fontName=t.title_font, fontSize=17, leading=21, textColor=t.accent)))
    out.append(Paragraph(txt(v.number), ParagraphStyle("enum", parent=st.center, textColor=t.muted)))
    out.append(Spacer(1, 4 * mm))
    return out


def header_classic(v: DocView, t: Theme, st: Styles, logo: bytes | None) -> list[Flowable]:
    left: list[Flowable] = []
    lf = logo_flowable(logo, 40 * mm, 18 * mm)
    if lf:
        left += [lf, Spacer(1, 2 * mm)]
    left.append(Paragraph(txt(v.business.get("name")), st.biz_name))
    left += [Paragraph(line, st.small) for line in business_lines(v.business)]
    meta = [[Paragraph(v.title.upper(), ParagraphStyle("clt", parent=st.title, alignment=TA_LEFT, fontSize=20, leading=24)), ""]]
    for label, value in meta_rows(v)[:3]:
        meta.append([Paragraph(label, st.label), Paragraph(txt(value), st.right)])
    mt = Table(meta, colWidths=[30 * mm, 38 * mm])
    mt.setStyle(TableStyle([
        ("SPAN", (0, 0), (-1, 0)),
        ("BOX", (0, 1), (-1, -1), 0.8, INK),
        ("INNERGRID", (0, 1), (-1, -1), 0.4, colors.HexColor("#9CA3AF")),
        ("BACKGROUND", (0, 1), (0, -1), colors.HexColor("#F3F4F6")),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("BOTTOMPADDING", (0, 0), (-1, 0), 6),
    ]))
    tbl = Table([[left, mt]], colWidths=[CONTENT_W - 70 * mm, 70 * mm])
    tbl.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0), ("ALIGN", (1, 0), (1, 0), "RIGHT")]))
    return [tbl, Spacer(1, 7 * mm)]


# ---------------------------------------------------------------------------- parties

def parties(v: DocView, t: Theme, st: Styles) -> list[Flowable]:
    label_due, due_value = amount_due(v)
    bill = [Paragraph("BILL TO" if v.kind == "invoice" else "PREPARED FOR", st.label), Spacer(1, 1.5 * mm)] + customer_block(v, st)

    if t.key == "classic":
        box = Table([[bill]], colWidths=[CONTENT_W * 0.55])
        box.setStyle(TableStyle([("BOX", (0, 0), (-1, -1), 0.8, INK), ("LEFTPADDING", (0, 0), (-1, -1), 8), ("TOPPADDING", (0, 0), (-1, -1), 6), ("BOTTOMPADDING", (0, 0), (-1, -1), 8)]))
        due = [
            Paragraph(label_due.upper(), ParagraphStyle("cd", parent=st.label, alignment=TA_RIGHT)),
            Paragraph(fmt_money(due_value, v.currency), ParagraphStyle("cdv", parent=st.grand_value, fontSize=16, leading=20)),
        ]
        if v.pricing_mode == "inclusive":
            due.append(Paragraph("Prices are tax inclusive", st.right_small))
        row = Table([[box, due]], colWidths=[CONTENT_W * 0.6, CONTENT_W * 0.4])
        row.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0)]))
        return [row, Spacer(1, 7 * mm)]

    meta = []
    for label, value in meta_rows(v):
        meta.append([Paragraph(label, st.small), Paragraph(txt(value), ParagraphStyle("mv", parent=st.body, fontName=t.bold if t.key != "elegant" else t.body))])
    mt = Table(meta, colWidths=[24 * mm, 36 * mm])
    mt.setStyle(TableStyle([("LEFTPADDING", (0, 0), (-1, -1), 0), ("TOPPADDING", (0, 0), (-1, -1), 1.2), ("BOTTOMPADDING", (0, 0), (-1, -1), 1.2)]))
    details = [Paragraph("DETAILS", st.label), Spacer(1, 1.5 * mm), mt]

    due_style = ParagraphStyle("due", parent=st.grand_value, fontSize=17, leading=21, textColor=t.accent if t.key != "elegant" else t.ink)
    due = [Paragraph(label_due.upper(), ParagraphStyle("dl", parent=st.label, alignment=TA_RIGHT)), Spacer(1, 1.5 * mm), Paragraph(fmt_money(due_value, v.currency), due_style)]
    if v.kind == "invoice":
        due.append(Paragraph(f"Due {fmt_date(v.end_date, v.date_format)}", st.right_small))
    else:
        due.append(Paragraph(f"Valid until {fmt_date(v.end_date, v.date_format)}", st.right_small))

    row = Table([[bill, details, due]], colWidths=[CONTENT_W * 0.38, CONTENT_W * 0.33, CONTENT_W * 0.29])
    style = [("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 6)]
    if t.key == "corporate":
        style += [("BACKGROUND", (2, 0), (2, 0), lighten(t.accent, 0.92)), ("LEFTPADDING", (2, 0), (2, 0), 8), ("RIGHTPADDING", (2, 0), (2, 0), 8), ("TOPPADDING", (2, 0), (2, 0), 7), ("BOTTOMPADDING", (2, 0), (2, 0), 8)]
    row.setStyle(TableStyle(style))
    return [row, Spacer(1, 8 * mm)]


# ---------------------------------------------------------------------------- items

def items_table(v: DocView, t: Theme, st: Styles) -> Table:
    has_discount = any(i.discount_amount > 0 for i in v.items)
    has_tax = any(i.tax_rate > 0 for i in v.items)
    cols: list[tuple[str, float, bool]] = [("#", 8 * mm, False), ("Description", 0, False), ("Qty", 15 * mm, True), ("Unit price", 25 * mm, True)]
    if has_discount:
        cols.append(("Discount", 19 * mm, True))
    if has_tax:
        cols.append(("Tax" if v.pricing_mode == "exclusive" else "Tax incl.", 17 * mm, True))
    cols.append((f"Amount ({v.currency})", 28 * mm, True))
    fixed = sum(w for _, w, _ in cols)
    widths = [w if w else CONTENT_W - fixed for _, w, _ in cols]

    head_style_l, head_style_r = st.th, st.th_r
    if t.key == "corporate":
        head_style_l = ParagraphStyle("thc", parent=st.th, textColor=colors.white)
        head_style_r = ParagraphStyle("thcr", parent=head_style_l, alignment=TA_RIGHT)
    header = [Paragraph(name.upper() if t.key != "elegant" else name, head_style_r if right else head_style_l) for name, _, right in cols]
    data = [header]
    for n, it in enumerate(v.items, start=1):
        row = [
            Paragraph(str(n), ParagraphStyle("idx", parent=st.cell, textColor=t.muted)),
            Paragraph(txt(it.description), st.cell),
            Paragraph(fmt_qty(it.quantity), st.cell_r),
            Paragraph(fmt_amount(it.unit_price), st.cell_r),
        ]
        if has_discount:
            if it.discount_amount > 0:
                d = fmt_rate(it.discount_value) if it.discount_type == "percent" else fmt_amount(it.discount_amount)
            else:
                d = "—"
            row.append(Paragraph(d, st.cell_r))
        if has_tax:
            row.append(Paragraph(fmt_rate(it.tax_rate) if it.tax_rate > 0 else "—", st.cell_r))
        row.append(Paragraph(fmt_amount(it.total), ParagraphStyle("amt", parent=st.cell_r, fontName=t.bold if t.key != "elegant" else t.body)))
        data.append(row)
    if not v.items:
        data.append([""] + [Paragraph("No items", st.small)] + [""] * (len(cols) - 2))

    tbl = Table(data, colWidths=widths, repeatRows=1, splitInRow=1, splitByRow=1)
    style = [
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 5.5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5.5),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
    ]
    if t.key == "modern":
        style += [("LINEBELOW", (0, 0), (-1, 0), 0.8, t.ink), ("LINEBELOW", (0, 1), (-1, -1), 0.4, LINE)]
    elif t.key == "corporate":
        style += [("BACKGROUND", (0, 0), (-1, 0), t.accent), ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, lighten(t.accent, 0.95)]), ("LINEBELOW", (0, -1), (-1, -1), 0.8, t.accent)]
    elif t.key == "elegant":
        style += [("LINEABOVE", (0, 0), (-1, 0), 0.8, t.accent), ("LINEBELOW", (0, 0), (-1, 0), 0.4, t.accent), ("LINEBELOW", (0, 1), (-1, -1), 0.25, LINE), ("LINEBELOW", (0, -1), (-1, -1), 0.8, t.accent)]
    else:  # classic
        style += [("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#6B7280")), ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#E5E7EB")), ("BOX", (0, 0), (-1, -1), 0.9, INK)]
    tbl.setStyle(TableStyle(style))
    return tbl


# ---------------------------------------------------------------------------- totals

def totals_block(v: DocView, t: Theme, st: Styles) -> Flowable:
    rows: list[tuple[str, str, str]] = [("Subtotal", fmt_money(v.subtotal, v.currency), "normal")]
    if v.discount_total > 0:
        rows.append(("Discount", fmt_money(-v.discount_total, v.currency), "normal"))
    if v.pricing_mode == "exclusive":
        for name, rate, amount in v.tax_summary:
            rows.append((f"{name} ({fmt_rate(rate)})", fmt_money(amount, v.currency), "normal"))
    if v.shipping > 0:
        rows.append(("Shipping & charges", fmt_money(v.shipping, v.currency), "normal"))
    rows.append(("Total", fmt_money(v.total, v.currency), "grand"))
    if v.pricing_mode == "inclusive":
        for name, rate, amount in v.tax_summary:
            rows.append((f"Includes {name} ({fmt_rate(rate)})", fmt_money(amount, v.currency), "muted"))
    if v.kind == "invoice":
        if v.amount_paid > 0:
            rows.append(("Amount paid", fmt_money(-v.amount_paid, v.currency), "normal"))
        rows.append(("Balance due", fmt_money(v.balance_due, v.currency), "due"))

    data, style = [], [
        ("LEFTPADDING", (0, 0), (-1, -1), 6), ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 3), ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ]
    for idx, (label, value, kind) in enumerate(rows):
        if kind == "grand":
            data.append([Paragraph(label, st.grand_label), Paragraph(value, st.grand_value)])
            style += [("LINEABOVE", (0, idx), (-1, idx), 0.8, t.ink if t.key != "elegant" else t.accent), ("TOPPADDING", (0, idx), (-1, idx), 6), ("BOTTOMPADDING", (0, idx), (-1, idx), 6)]
        elif kind == "due":
            fg = colors.white if t.key in ("corporate", "modern") else t.ink
            bg = t.accent if t.key in ("corporate", "modern") else (colors.HexColor("#F3F4F6") if t.key == "classic" else lighten(t.accent, 0.9))
            data.append([
                Paragraph(label, ParagraphStyle("dl2", parent=st.grand_label, textColor=fg)),
                Paragraph(value, ParagraphStyle("dv2", parent=st.grand_value, textColor=fg)),
            ])
            style += [("BACKGROUND", (0, idx), (-1, idx), bg), ("TOPPADDING", (0, idx), (-1, idx), 6), ("BOTTOMPADDING", (0, idx), (-1, idx), 6)]
            if t.key == "classic":
                style.append(("BOX", (0, idx), (-1, idx), 0.9, INK))
        elif kind == "muted":
            data.append([Paragraph(label, st.small), Paragraph(value, st.right_small)])
        else:
            data.append([Paragraph(label, st.total_label), Paragraph(value, st.total_value)])
    tbl = Table(data, colWidths=[44 * mm, 38 * mm])
    tbl.setStyle(TableStyle(style))
    return tbl


def payment_block(v: DocView, t: Theme, st: Styles) -> list[Flowable]:
    if not v.payment_instructions:
        return []
    return [Paragraph("PAYMENT INSTRUCTIONS", st.section), Paragraph(txt(v.payment_instructions), st.body)]


def summary_section(v: DocView, t: Theme, st: Styles) -> Flowable:
    left = payment_block(v, t, st)
    if v.kind == "invoice" and v.payment_instructions:
        left.append(Spacer(1, 2 * mm))
        left.append(Paragraph(f"Please quote <b>{txt(v.number)}</b> as your payment reference.", st.small))
    right = totals_block(v, t, st)
    tbl = Table([[left or "", right]], colWidths=[CONTENT_W - 84 * mm, 84 * mm])
    tbl.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (0, 0), 8 * mm), ("RIGHTPADDING", (1, 0), (1, 0), 0)]))
    return KeepTogether([Spacer(1, 5 * mm), tbl])


def notes_terms(v: DocView, t: Theme, st: Styles) -> list[Flowable]:
    out: list[Flowable] = []
    if v.notes:
        out += [Spacer(1, 6 * mm), KeepTogether([Paragraph("NOTES", st.section), Paragraph(txt(v.notes), st.body)])]
    if v.terms:
        out += [Spacer(1, 5 * mm), Paragraph("TERMS & CONDITIONS", st.section), Paragraph(txt(v.terms), st.small)]
    return out


def signature(v: DocView, t: Theme, st: Styles) -> list[Flowable]:
    if not v.show_signature:
        return []
    line = HRFlowable(width=62 * mm, thickness=0.6, color=t.ink, hAlign="LEFT", spaceBefore=12 * mm, spaceAfter=2)
    date_line = HRFlowable(width=40 * mm, thickness=0.6, color=t.ink, hAlign="LEFT", spaceBefore=12 * mm, spaceAfter=2)
    left = [line, Paragraph(f"Authorised signature — {txt(v.business.get('name'))}", st.small)]
    right = [date_line, Paragraph("Date", st.small)]
    if v.kind == "quotation":
        left = [line, Paragraph("Accepted by (name & signature)", st.small)]
    tbl = Table([[left, right]], colWidths=[CONTENT_W * 0.6, CONTENT_W * 0.4])
    tbl.setStyle(TableStyle([("LEFTPADDING", (0, 0), (-1, -1), 0), ("VALIGN", (0, 0), (-1, -1), "BOTTOM")]))
    return [KeepTogether([Spacer(1, 4 * mm), tbl])]


# ---------------------------------------------------------------------------- page furniture

def _canvas_factory(v: DocView, t: Theme):
    status = v.status
    stamp = {"paid": "PAID", "cancelled": "CANCELLED", "draft": "DRAFT"}.get(status)

    class NumberedCanvas(rl_canvas.Canvas):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, **kwargs)
            self._saved: list[dict] = []

        def showPage(self):  # noqa: N802 - ReportLab API
            self._saved.append(dict(self.__dict__))
            self._startPage()

        def save(self):
            total = len(self._saved)
            for state in self._saved:
                self.__dict__.update(state)
                self._decorate(total)
                super().showPage()
            super().save()

        def _decorate(self, total: int):
            self.saveState()
            self.setFont(t.body, 7.5)
            self.setFillColor(MUTED)
            self.setStrokeColor(LINE)
            self.setLineWidth(0.5)
            self.line(MARGIN_X, 13 * mm, PAGE_W - MARGIN_X, 13 * mm)
            self.drawString(MARGIN_X, 9 * mm, f"{v.business.get('name') or ''} · {v.title} {v.number}")
            self.drawRightString(PAGE_W - MARGIN_X, 9 * mm, f"Page {self._pageNumber} of {total}")
            if stamp:
                self.setFont(t.bold, 54 if stamp != "CANCELLED" else 44)
                color = {"PAID": colors.HexColor("#059669"), "CANCELLED": colors.HexColor("#DC2626"), "DRAFT": colors.HexColor("#9CA3AF")}[stamp]
                self.setFillColor(color)
                self.setFillAlpha(0.08 if stamp == "DRAFT" else 0.11)
                self.translate(PAGE_W / 2, PAGE_H / 2)
                self.rotate(32)
                self.drawCentredString(0, 0, stamp)
            self.restoreState()

    return NumberedCanvas


# ---------------------------------------------------------------------------- entry point

HEADERS = {"modern": header_modern, "corporate": header_corporate, "elegant": header_elegant, "classic": header_classic}


def render_document(v: DocView, template: str, logo: bytes | None = None) -> bytes:
    register_fonts()
    t = make_theme(template if template in HEADERS else "modern", v.accent)
    st = Styles(t)
    buf = io.BytesIO()
    doc = BaseDocTemplate(
        buf, pagesize=A4, leftMargin=MARGIN_X, rightMargin=MARGIN_X, topMargin=MARGIN_TOP,
        bottomMargin=MARGIN_BOTTOM, title=f"{v.title} {v.number}", author=v.business.get("name") or "",
        subject=f"{v.title} {v.number}", creator="InvoiceFlow",
    )
    frame = Frame(MARGIN_X, MARGIN_BOTTOM, CONTENT_W, PAGE_H - MARGIN_TOP - MARGIN_BOTTOM, id="body", leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
    doc.addPageTemplates([PageTemplate(id="page", frames=[frame])])

    story: list[Flowable] = []
    story += HEADERS[t.key](v, t, st, logo)
    story += parties(v, t, st)
    story.append(items_table(v, t, st))
    story.append(summary_section(v, t, st))
    story += notes_terms(v, t, st)
    story += signature(v, t, st)
    if v.status in STATUS_LABELS and v.kind == "quotation" and v.status in ("accepted", "declined", "expired", "converted"):
        story.append(Spacer(1, 4 * mm))
        story.append(Paragraph(f"Status: {STATUS_LABELS[v.status]}", st.small))
    doc.build(story, canvasmaker=_canvas_factory(v, t))
    return buf.getvalue()


__all__ = ["render_document", "fmt_money", "fmt_date", "fmt_amount", "ZERO"]
