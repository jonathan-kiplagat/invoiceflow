import { dec, type DecimalLike } from "@/utils/calc";

export const CURRENCY_SYMBOLS: Record<string, string> = {
  KES: "KSh", USD: "$", EUR: "€", GBP: "£", TZS: "TSh", ZAR: "R", NGN: "NGN", AED: "AED",
  INR: "INR", CNY: "CNY", CAD: "CA$", AUD: "A$", CHF: "CHF",
};

const numberFmt = new Intl.NumberFormat("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const compactFmt = new Intl.NumberFormat("en-KE", { notation: "compact", maximumFractionDigits: 1 });

/** "KSh 1,234.50" — matches the PDF and the server's format_money(). */
export function money(value: DecimalLike | null | undefined, currency = "KES"): string {
  const d = dec(value ?? 0).toDecimalPlaces(2);
  const sym = CURRENCY_SYMBOLS[currency] ?? currency;
  const sign = d.isNegative() && !d.isZero() ? "-" : "";
  // Format via string to avoid float rounding on large numbers.
  return `${sign}${sym} ${groupDigits(d.abs().toFixed(2))}`;
}

export function amount(value: DecimalLike | null | undefined): string {
  return groupDigits(dec(value ?? 0).toDecimalPlaces(2).toFixed(2));
}

function groupDigits(fixed: string): string {
  const [int, frac] = fixed.split(".");
  return `${int.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${frac}`;
}

export function compactMoney(value: DecimalLike, currency = "KES"): string {
  const sym = CURRENCY_SYMBOLS[currency] ?? currency;
  return `${sym} ${compactFmt.format(dec(value).toNumber())}`;
}

export function plainNumber(value: DecimalLike): string {
  return numberFmt.format(dec(value).toNumber());
}

export function quantity(value: DecimalLike): string {
  const s = dec(value).toFixed(3).replace(/\.?0+$/, "");
  return s || "0";
}

export function rate(value: DecimalLike): string {
  return `${dec(value).toFixed(3).replace(/\.?0+$/, "")}%`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export type DateFormat = "DD MMM YYYY" | "DD/MM/YYYY" | "YYYY-MM-DD";
let preferredDateFormat: DateFormat = "DD MMM YYYY";
export function setDateFormat(f: DateFormat) {
  preferredDateFormat = f;
}

/** Formats an ISO date (YYYY-MM-DD) without timezone shifts. */
export function fmtDate(iso: string | null | undefined, format: DateFormat = preferredDateFormat): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return iso;
  const dd = String(d).padStart(2, "0");
  if (format === "DD/MM/YYYY") return `${dd}/${String(m).padStart(2, "0")}/${y}`;
  if (format === "YYYY-MM-DD") return iso.slice(0, 10);
  return `${dd} ${MONTHS[m - 1]} ${y}`;
}

export function fmtMonth(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return `${MONTHS[m - 1]} ${String(y).slice(2)}`;
}

export const NAIROBI = "Africa/Nairobi";

/** Today's date in Nairobi as YYYY-MM-DD, regardless of the device's timezone. */
export function todayNairobi(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: NAIROBI, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

function utcMs(iso: string): number {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

export function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((utcMs(toIso) - utcMs(fromIso)) / 86_400_000);
}

export function fmtDateTime(iso: string | number | null | undefined): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-KE", { timeZone: NAIROBI, day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

export function relativeTime(ts: number): string {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return fmtDateTime(ts);
}

export const STATUS_LABEL: Record<string, string> = {
  draft: "Draft", sent: "Sent", partially_paid: "Partially paid", paid: "Paid", overdue: "Overdue",
  cancelled: "Cancelled", accepted: "Accepted", declined: "Declined", expired: "Expired", converted: "Converted",
};

export const METHOD_LABEL: Record<string, string> = {
  mpesa: "M-Pesa", bank_transfer: "Bank transfer", cash: "Cash", card: "Card", cheque: "Cheque", other: "Other",
};
