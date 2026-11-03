import { ChevronDown, ChevronUp, Copy, Plus, Trash2 } from "lucide-react";
import { Button, IconButton, Input, Select, Textarea } from "@/components/ui";
import type { ItemInput, PricingMode, TaxRate } from "@/types";
import { cn } from "@/utils/cn";
import { computeLine, dec, isValidAmount } from "@/utils/calc";
import { amount, money } from "@/utils/format";

export function emptyItem(defaultTax?: TaxRate | null): ItemInput {
  return {
    description: "",
    quantity: "1",
    unit_price: "",
    discount_type: "percent",
    discount_value: "0",
    tax_rate_id: defaultTax?.id ?? null,
    tax_name: defaultTax?.name ?? null,
    tax_rate: defaultTax?.rate ?? "0",
  };
}

export function itemErrors(it: ItemInput): Partial<Record<keyof ItemInput, string>> {
  const e: Partial<Record<keyof ItemInput, string>> = {};
  if (!it.description.trim()) e.description = "Add a description";
  if (!isValidAmount(it.quantity, 3) || dec(it.quantity).lte(0)) e.quantity = "Quantity must be more than 0";
  if (!isValidAmount(it.unit_price, 2)) e.unit_price = "Enter a price";
  if (it.discount_value && !isValidAmount(it.discount_value, 2)) e.discount_value = "Invalid discount";
  else if (it.discount_type === "percent" && dec(it.discount_value).gt(100)) e.discount_value = "Max 100%";
  return e;
}

interface Props {
  items: ItemInput[];
  onChange: (items: ItemInput[]) => void;
  taxRates: TaxRate[];
  pricingMode: PricingMode;
  currency: string;
  showErrors: boolean;
  defaultTax: TaxRate | null;
}

export function ItemsEditor({ items, onChange, taxRates, pricingMode, currency, showErrors, defaultTax }: Props) {
  const update = (i: number, patch: Partial<ItemInput>) => onChange(items.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  const remove = (i: number) => onChange(items.filter((_, idx) => idx !== i));
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= items.length) return;
    const next = [...items];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  const duplicate = (i: number) => onChange([...items.slice(0, i + 1), { ...items[i] }, ...items.slice(i + 1)]);
  const activeRates = taxRates.filter((t) => t.is_active);

  const taxSelect = (it: ItemInput, i: number, id: string) => (
    <Select
      id={id}
      aria-label="Tax rate"
      value={it.tax_rate_id != null ? String(it.tax_rate_id) : dec(it.tax_rate).gt(0) ? "custom" : "none"}
      onChange={(e) => {
        const v = e.target.value;
        if (v === "none") update(i, { tax_rate_id: null, tax_name: null, tax_rate: "0" });
        else if (v !== "custom") {
          const t = taxRates.find((x) => String(x.id) === v);
          if (t) update(i, { tax_rate_id: t.id, tax_name: t.name, tax_rate: t.rate });
        }
      }}
    >
      <option value="none">No tax</option>
      {activeRates.map((t) => (
        <option key={t.id} value={t.id}>
          {t.name} ({dec(t.rate).toString()}%)
        </option>
      ))}
      {it.tax_rate_id == null && dec(it.tax_rate).gt(0) && <option value="custom">{it.tax_name ?? "Tax"} ({dec(it.tax_rate).toString()}%)</option>}
    </Select>
  );

  const discountInput = (it: ItemInput, i: number, id: string, err?: string) => (
    <div className="flex">
      <Input
        id={id}
        inputMode="decimal"
        value={it.discount_value}
        onChange={(e) => update(i, { discount_value: e.target.value })}
        className="tnum rounded-r-none"
        invalid={!!err}
        aria-label="Discount"
        placeholder="0"
      />
      <button
        type="button"
        onClick={() => update(i, { discount_type: it.discount_type === "percent" ? "amount" : "percent" })}
        className="h-10 shrink-0 rounded-r-lg border-0 bg-zinc-100 px-2.5 text-[13px] font-medium text-zinc-600 ring-1 ring-inset ring-zinc-200 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:ring-zinc-700"
        aria-label={`Discount type: ${it.discount_type === "percent" ? "percent" : "fixed amount"}. Tap to switch.`}
        title="Switch between % and fixed amount"
      >
        {it.discount_type === "percent" ? "%" : currency}
      </button>
    </div>
  );

  return (
    <div>
      {/* Desktop / tablet: description on its own line, figures aligned underneath */}
      <div className="hidden md:block">
        <ul className="space-y-3">
          {items.map((it, i) => {
            const err = showErrors ? itemErrors(it) : {};
            const line = computeLine(it, pricingMode);
            return (
              <li key={i} className="group rounded-xl border border-zinc-200 p-3 transition-colors focus-within:border-brand-300 dark:border-zinc-800 dark:focus-within:border-brand-700">
                <div className="flex items-start gap-2">
                  <span className="mt-2.5 w-6 shrink-0 text-center text-xs font-semibold text-zinc-400">{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <Textarea
                      rows={1}
                      value={it.description}
                      onChange={(e) => update(i, { description: e.target.value })}
                      placeholder="Product or service description"
                      aria-label={`Item ${i + 1} description`}
                      invalid={!!err.description}
                      className="min-h-[40px] resize-y"
                      maxLength={4000}
                    />
                    {err.description && <p className="mt-1 text-xs text-red-600">{err.description}</p>}
                  </div>
                  <div className="flex shrink-0 items-center">
                    <IconButton label={`Move item ${i + 1} up`} onClick={() => move(i, -1)} disabled={i === 0} className="h-9 w-8 disabled:opacity-30"><ChevronUp className="h-4 w-4" /></IconButton>
                    <IconButton label={`Move item ${i + 1} down`} onClick={() => move(i, 1)} disabled={i === items.length - 1} className="h-9 w-8 disabled:opacity-30"><ChevronDown className="h-4 w-4" /></IconButton>
                    <IconButton label={`Duplicate item ${i + 1}`} onClick={() => duplicate(i)} className="h-9 w-8"><Copy className="h-4 w-4" /></IconButton>
                    <IconButton label={`Remove item ${i + 1}`} onClick={() => remove(i)} className="h-9 w-8 hover:text-red-600 disabled:opacity-30" disabled={items.length === 1}>
                      <Trash2 className="h-4 w-4" />
                    </IconButton>
                  </div>
                </div>
                <div className="mt-2 grid grid-cols-[minmax(64px,0.6fr)_minmax(100px,1fr)_minmax(110px,1fr)_minmax(130px,1.3fr)_minmax(100px,1fr)] items-start gap-2 pl-8">
                  <label className="block min-w-0">
                    <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-zinc-500">Qty</span>
                    <Input inputMode="decimal" value={it.quantity} onChange={(e) => update(i, { quantity: e.target.value })} className="tnum text-right" aria-label={`Item ${i + 1} quantity`} invalid={!!err.quantity} />
                  </label>
                  <label className="block min-w-0">
                    <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-zinc-500">Unit price</span>
                    <Input inputMode="decimal" value={it.unit_price} onChange={(e) => update(i, { unit_price: e.target.value })} className="tnum text-right" placeholder="0.00" aria-label={`Item ${i + 1} unit price`} invalid={!!err.unit_price} />
                  </label>
                  <div className="min-w-0">
                    <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-zinc-500">Discount</span>
                    {discountInput(it, i, `d-${i}`, err.discount_value)}
                  </div>
                  <div className="min-w-0">
                    <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-zinc-500">Tax</span>
                    {taxSelect(it, i, `t-${i}`)}
                  </div>
                  <div className="min-w-0 text-right">
                    <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-zinc-500">Amount</span>
                    <p className="tnum pt-2 text-sm font-semibold">{amount(line.total)}</p>
                    {line.discount.gt(0) && <p className="tnum text-[11px] text-zinc-500">incl. −{amount(line.discount)} discount</p>}
                  </div>
                </div>
                {(err.quantity || err.unit_price || err.discount_value) && <p className="mt-1 pl-8 text-xs text-red-600">{err.quantity ?? err.unit_price ?? err.discount_value}</p>}
              </li>
            );
          })}
        </ul>
      </div>

      {/* Mobile: stacked cards */}
      <ul className="space-y-3 md:hidden">
        {items.map((it, i) => {
          const err = showErrors ? itemErrors(it) : {};
          const line = computeLine(it, pricingMode);
          return (
            <li key={i} className="rounded-xl border border-zinc-200 bg-zinc-50/60 p-3 dark:border-zinc-800 dark:bg-zinc-900/40">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Item {i + 1}</span>
                <div className="-mr-2 flex">
                  <IconButton label="Move up" onClick={() => move(i, -1)} disabled={i === 0} className="h-9 w-9 disabled:opacity-30"><ChevronUp className="h-4 w-4" /></IconButton>
                  <IconButton label="Move down" onClick={() => move(i, 1)} disabled={i === items.length - 1} className="h-9 w-9 disabled:opacity-30"><ChevronDown className="h-4 w-4" /></IconButton>
                  <IconButton label="Duplicate item" onClick={() => duplicate(i)} className="h-9 w-9"><Copy className="h-4 w-4" /></IconButton>
                  <IconButton label={`Remove item ${i + 1}`} onClick={() => remove(i)} disabled={items.length === 1} className="h-9 w-9 hover:text-red-600 disabled:opacity-30"><Trash2 className="h-4 w-4" /></IconButton>
                </div>
              </div>
              <Textarea rows={2} value={it.description} onChange={(e) => update(i, { description: e.target.value })} placeholder="Product or service description" aria-label={`Item ${i + 1} description`} invalid={!!err.description} maxLength={4000} />
              {err.description && <p className="mt-1 text-xs text-red-600">{err.description}</p>}
              <div className="mt-2 grid grid-cols-2 gap-2">
                <label className="block">
                  <span className="mb-1 block text-xs text-zinc-500">Quantity</span>
                  <Input inputMode="decimal" value={it.quantity} onChange={(e) => update(i, { quantity: e.target.value })} className="tnum" invalid={!!err.quantity} />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs text-zinc-500">Unit price ({currency})</span>
                  <Input inputMode="decimal" value={it.unit_price} onChange={(e) => update(i, { unit_price: e.target.value })} className="tnum" placeholder="0.00" invalid={!!err.unit_price} />
                </label>
                <div>
                  <span className="mb-1 block text-xs text-zinc-500">Discount</span>
                  {discountInput(it, i, `md-${i}`, err.discount_value)}
                </div>
                <div>
                  <span className="mb-1 block text-xs text-zinc-500">Tax</span>
                  {taxSelect(it, i, `mt-${i}`)}
                </div>
              </div>
              {(err.quantity || err.unit_price || err.discount_value) && <p className="mt-1 text-xs text-red-600">{err.quantity ?? err.unit_price ?? err.discount_value}</p>}
              <div className="mt-2.5 flex items-center justify-between border-t border-zinc-200 pt-2.5 text-sm dark:border-zinc-800">
                <span className="text-zinc-500">Line total{pricingMode === "inclusive" && dec(it.tax_rate).gt(0) ? " (incl. tax)" : ""}</span>
                <span className="tnum font-semibold">{money(line.total, currency)}</span>
              </div>
            </li>
          );
        })}
      </ul>

      <Button variant="outline" className={cn("mt-3 w-full md:w-auto")} icon={<Plus className="h-4 w-4" />} onClick={() => onChange([...items, emptyItem(defaultTax)])} disabled={items.length >= 500}>
        Add item
      </Button>
    </div>
  );
}
