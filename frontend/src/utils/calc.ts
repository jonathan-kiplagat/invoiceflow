/**
 * Invoice arithmetic for live previews. Mirrors backend/app/services/calculations.py exactly
 * (decimal maths, half-up rounding to cents). The server recomputes and stores the real values.
 * Both implementations are tested against tests/fixtures/calc_cases.json.
 */
import Decimal from "decimal.js";
import type { PricingMode } from "@/types";

const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
const HUNDRED = new D(100);
const ZERO = new D(0);

export type DecimalLike = string | number | Decimal;

export function dec(v: DecimalLike | null | undefined): Decimal {
  if (v === null || v === undefined || v === "") return new D(0);
  try {
    const d = new D(typeof v === "string" ? v.replace(/,/g, "").trim() || "0" : v);
    return d.isFinite() ? d : new D(0);
  } catch {
    return new D(0);
  }
}

export const q2 = (v: Decimal) => v.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

export interface LineInput {
  quantity: DecimalLike;
  unit_price: DecimalLike;
  discount_type: "percent" | "amount";
  discount_value: DecimalLike;
  tax_rate: DecimalLike;
}

export interface LineResult {
  subtotal: Decimal;
  discount: Decimal;
  tax: Decimal;
  total: Decimal;
}

export interface Totals {
  subtotal: Decimal;
  discount_total: Decimal;
  tax_total: Decimal;
  shipping: Decimal;
  total: Decimal;
}

export function computeLine(item: LineInput, mode: PricingMode): LineResult {
  const gross = q2(dec(item.quantity).times(dec(item.unit_price)));
  let discount: Decimal;
  if (item.discount_type === "percent") {
    const pct = Decimal.min(Decimal.max(dec(item.discount_value), ZERO), HUNDRED);
    discount = q2(gross.times(pct).div(HUNDRED));
  } else {
    discount = Decimal.min(q2(Decimal.max(dec(item.discount_value), ZERO)), gross);
  }
  const net = gross.minus(discount);
  const rate = dec(item.tax_rate);
  let tax: Decimal;
  let total: Decimal;
  if (mode === "inclusive") {
    tax = rate.gt(0) ? q2(net.times(rate).div(HUNDRED.plus(rate))) : new D(0);
    total = net;
  } else {
    tax = q2(net.times(rate).div(HUNDRED));
    total = net.plus(tax);
  }
  return { subtotal: gross, discount, tax, total: q2(total) };
}

export function computeTotals(lines: LineResult[], shipping: DecimalLike, mode: PricingMode): Totals {
  const sum = (f: (l: LineResult) => Decimal) => lines.reduce((acc, l) => acc.plus(f(l)), new D(0));
  const subtotal = sum((l) => l.subtotal);
  const discount = sum((l) => l.discount);
  const tax = sum((l) => l.tax);
  const ship = q2(dec(shipping));
  const total = mode === "inclusive" ? subtotal.minus(discount).plus(ship) : subtotal.minus(discount).plus(tax).plus(ship);
  return { subtotal: q2(subtotal), discount_total: q2(discount), tax_total: q2(tax), shipping: ship, total: q2(total) };
}

export function computeDocument(items: LineInput[], shipping: DecimalLike, mode: PricingMode) {
  const lines = items.map((i) => computeLine(i, mode));
  return { lines, totals: computeTotals(lines, shipping, mode) };
}

/** Group tax by (name, rate) for a VAT summary. */
export function taxSummary(items: (LineInput & { tax_name?: string | null })[], lines: LineResult[]) {
  const map = new Map<string, { name: string; rate: Decimal; amount: Decimal }>();
  items.forEach((it, i) => {
    const rate = dec(it.tax_rate);
    if (rate.lte(0)) return;
    const name = it.tax_name || "Tax";
    const key = `${name}|${rate.toString()}`;
    const cur = map.get(key) ?? { name, rate, amount: new D(0) };
    cur.amount = cur.amount.plus(lines[i].tax);
    map.set(key, cur);
  });
  return [...map.values()];
}

export function isValidAmount(v: string, maxPlaces = 2): boolean {
  if (!v.trim()) return false;
  const re = new RegExp(`^\\d{1,12}(\\.\\d{0,${maxPlaces}})?$`);
  return re.test(v.replace(/,/g, "").trim());
}
