"""Customer statement PDF: invoices and payments with a running balance."""

from __future__ import annotations

import io
from dataclasses import dataclass
from datetime import date
from decimal import Decimal

from reportlab.lib import colors
from reportlab.lib.enums import TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import BaseDocTemplate, Frame, PageTemplate, Paragraph, Spacer, Table, TableStyle

from app.services.pdf.fonts import register_fonts
from app.services.pdf.render import (
    CONTENT_W,
    INK,
    LINE,
    MARGIN_BOTTOM,
    MARGIN_TOP,
    MARGIN_X,
    MUTED,
    PAGE_H,
    business_lines,
    fmt_amount,
    fmt_date,
    fmt_money,
    logo_flowable,
    txt,
)


@dataclass
class StatementLine:
    on: date
    kind: str  # invoice | payment
    reference: str
    description: str
    debit: Decimal
    credit: Decimal


def render_statement(
    business: dict, customer: dict, currency: str, lines: list[StatementLine], date_from: date | None,
    date_to: date, opening_balance: Decimal, accent: str, date_format: str, logo: bytes | None,
) -> bytes:
    register_fonts()
    accent_c = colors.HexColor(accent)
    body = ParagraphStyle("b", fontName="Sans", fontSize=8.8, leading=12, textColor=INK)
    small = ParagraphStyle("s", parent=body, fontSize=7.8, leading=10.5, textColor=MUTED)
    right = ParagraphStyle("r", parent=body, alignment=TA_RIGHT)
    bold = ParagraphStyle("bb", parent=body, fontName="Sans-Bold")
    title = ParagraphStyle("t", parent=body, fontName="Sans-Bold", fontSize=20, leading=24, alignment=TA_RIGHT)
    th = ParagraphStyle("th", parent=body, fontName="Sans-Bold", fontSize=7.4, textColor=MUTED)
    th_r = ParagraphStyle("thr", parent=th, alignment=TA_RIGHT)

    buf = io.BytesIO()
    doc = BaseDocTemplate(buf, pagesize=A4, leftMargin=MARGIN_X, rightMargin=MARGIN_X, topMargin=MARGIN_TOP,
                          bottomMargin=MARGIN_BOTTOM, title=f"Statement - {customer.get('name')}", creator="InvoiceFlow")

    def footer(canvas, d):
        canvas.saveState()
        canvas.setFont("Sans", 7.5)
        canvas.setFillColor(MUTED)
        canvas.drawString(MARGIN_X, 9 * mm, f"{business.get('name') or ''} · Statement for {customer.get('name')}")
        canvas.drawRightString(A4[0] - MARGIN_X, 9 * mm, f"Page {d.page}")
        canvas.restoreState()

    frame = Frame(MARGIN_X, MARGIN_BOTTOM, CONTENT_W, PAGE_H - MARGIN_TOP - MARGIN_BOTTOM, leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
    doc.addPageTemplates([PageTemplate(frames=[frame], onPage=footer)])

    left = []
    lf = logo_flowable(logo, 40 * mm, 16 * mm)
    if lf:
        left += [lf, Spacer(1, 2 * mm)]
    left += [Paragraph(txt(business.get("name")), ParagraphStyle("bn", parent=bold, fontSize=13, leading=16))]
    left += [Paragraph(x, small) for x in business_lines(business)]
    period = f"{fmt_date(date_from, date_format)} – {fmt_date(date_to, date_format)}" if date_from else f"Up to {fmt_date(date_to, date_format)}"
    rightcol = [Paragraph("Statement", title), Paragraph(period, ParagraphStyle("p", parent=right, textColor=MUTED)), Paragraph(f"Currency: {currency}", ParagraphStyle("p2", parent=right, textColor=MUTED))]
    head = Table([[left, rightcol]], colWidths=[CONTENT_W * 0.6, CONTENT_W * 0.4])
    head.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0), ("LINEBELOW", (0, 0), (-1, 0), 1.2, accent_c), ("BOTTOMPADDING", (0, 0), (-1, -1), 8)]))

    cust = [Paragraph("CUSTOMER", th), Paragraph(txt(customer.get("name")), bold)]
    for k in ("company", "billing_address", "email", "phone"):
        if customer.get(k):
            cust.append(Paragraph(txt(customer[k]), body))

    balance = opening_balance
    data = [[Paragraph(h, th) for h in ("Date", "Reference", "Details")] + [Paragraph(h, th_r) for h in ("Charges", "Payments", "Balance")]]
    data.append([Paragraph(fmt_date(date_from, date_format) if date_from else "", body), Paragraph("", body), Paragraph("Opening balance", body), "", "", Paragraph(fmt_amount(balance), right)])
    total_debit = total_credit = Decimal("0")
    for ln in lines:
        balance = balance + ln.debit - ln.credit
        total_debit += ln.debit
        total_credit += ln.credit
        data.append([
            Paragraph(fmt_date(ln.on, date_format), body), Paragraph(txt(ln.reference), body), Paragraph(txt(ln.description), body),
            Paragraph(fmt_amount(ln.debit) if ln.debit else "", right), Paragraph(fmt_amount(ln.credit) if ln.credit else "", right),
            Paragraph(fmt_amount(balance), right),
        ])
    data.append(["", "", Paragraph("Totals", bold), Paragraph(fmt_amount(total_debit), ParagraphStyle("x", parent=right, fontName="Sans-Bold")), Paragraph(fmt_amount(total_credit), ParagraphStyle("y", parent=right, fontName="Sans-Bold")), ""])
    tbl = Table(data, colWidths=[22 * mm, 28 * mm, CONTENT_W - 22 * mm - 28 * mm - 3 * 26 * mm, 26 * mm, 26 * mm, 26 * mm], repeatRows=1)
    tbl.setStyle(TableStyle([
        ("LINEBELOW", (0, 0), (-1, 0), 0.8, INK), ("LINEBELOW", (0, 1), (-1, -2), 0.3, LINE),
        ("LINEABOVE", (0, -1), (-1, -1), 0.8, INK), ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    due = Table([[Paragraph("Balance due", ParagraphStyle("bd", parent=bold, fontSize=11, textColor=colors.white)),
                  Paragraph(fmt_money(balance, currency), ParagraphStyle("bdv", parent=right, fontName="Sans-Bold", fontSize=11, textColor=colors.white))]],
                colWidths=[40 * mm, 42 * mm], hAlign="RIGHT")
    due.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), accent_c), ("TOPPADDING", (0, 0), (-1, -1), 7), ("BOTTOMPADDING", (0, 0), (-1, -1), 7)]))

    story = [head, Spacer(1, 6 * mm)] + cust + [Spacer(1, 6 * mm), tbl, Spacer(1, 6 * mm), due]
    doc.build(story)
    return buf.getvalue()
