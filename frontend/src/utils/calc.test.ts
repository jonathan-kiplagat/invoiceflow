import { describe, expect, it } from "vitest";
import fixtures from "../../../tests/fixtures/calc_cases.json";
import { computeDocument, isValidAmount } from "./calc";
import { fmtDate, money } from "./format";
import { formatPhone, normalizePhone } from "./phone";
import type { PricingMode } from "@/types";

interface Case {
  name: string;
  pricing_mode: PricingMode;
  shipping: string;
  items: { quantity: string; unit_price: string; discount_type: "percent" | "amount"; discount_value: string; tax_rate: string }[];
  lines: { subtotal: string; discount: string; tax: string; total: string }[];
  totals: { subtotal: string; discount_total: string; tax_total: string; shipping: string; total: string };
}

describe("invoice calculations match the server (shared fixtures)", () => {
  for (const c of (fixtures as { cases: Case[] }).cases) {
    it(c.name, () => {
      const { lines, totals } = computeDocument(c.items, c.shipping, c.pricing_mode);
      lines.forEach((l, i) => {
        expect(l.subtotal.toFixed(2)).toBe(c.lines[i].subtotal);
        expect(l.discount.toFixed(2)).toBe(c.lines[i].discount);
        expect(l.tax.toFixed(2)).toBe(c.lines[i].tax);
        expect(l.total.toFixed(2)).toBe(c.lines[i].total);
      });
      expect(totals.subtotal.toFixed(2)).toBe(c.totals.subtotal);
      expect(totals.discount_total.toFixed(2)).toBe(c.totals.discount_total);
      expect(totals.tax_total.toFixed(2)).toBe(c.totals.tax_total);
      expect(totals.shipping.toFixed(2)).toBe(c.totals.shipping);
      expect(totals.total.toFixed(2)).toBe(c.totals.total);
    });
  }

  it("never drifts like floating point", () => {
    const { totals } = computeDocument(
      Array.from({ length: 3 }, () => ({ quantity: "1", unit_price: "0.10", discount_type: "percent" as const, discount_value: "0", tax_rate: "0" })),
      "0",
      "exclusive",
    );
    expect(totals.total.toFixed(2)).toBe("0.30");
  });

  it("treats empty / junk input as zero instead of NaN", () => {
    const { totals } = computeDocument([{ quantity: "", unit_price: "abc", discount_type: "percent", discount_value: "", tax_rate: "" }], "", "exclusive");
    expect(totals.total.toFixed(2)).toBe("0.00");
  });
});

describe("formatting", () => {
  it("formats KES like the PDF", () => {
    expect(money("1234.5", "KES")).toBe("KSh 1,234.50");
    expect(money("139629618.58", "KES")).toBe("KSh 139,629,618.58");
    expect(money("-10", "USD")).toBe("-$ 10.00");
  });
  it("formats dates without timezone shifts", () => {
    expect(fmtDate("2026-11-03", "DD MMM YYYY")).toBe("03 Nov 2026");
    expect(fmtDate("2026-11-03", "DD/MM/YYYY")).toBe("03/11/2026");
  });
  it("validates amounts", () => {
    expect(isValidAmount("1,000.50")).toBe(true);
    expect(isValidAmount("1.005")).toBe(false);
    expect(isValidAmount("-1")).toBe(false);
  });
  it("normalises Kenyan phone numbers", () => {
    expect(normalizePhone("0712 345 678")).toBe("+254712345678");
    expect(normalizePhone("0110123456")).toBe("+254110123456");
    expect(formatPhone("+254712345678")).toBe("+254 712 345 678");
    expect(() => normalizePhone("12345")).toThrow();
  });
});
