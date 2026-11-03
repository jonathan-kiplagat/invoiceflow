import { Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { dec } from "@/utils/calc";
import { compactMoney, fmtMonth, money } from "@/utils/format";

// Restrained palette: one brand hue for money received, a neutral for invoiced, warm for risk.
export const CHART = {
  collected: "#147a71",
  invoiced: "#a1a1aa",
  outstanding: "#f59e0b",
  overdue: "#dc2626",
  grid: "rgba(113,113,122,0.18)",
};

function TooltipBox({ active, payload, label, currency }: { active?: boolean; payload?: { name: string; value: number; color: string }[]; label?: string; currency: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs shadow-pop dark:border-zinc-700 dark:bg-zinc-900">
      {label && <p className="mb-1 font-medium text-zinc-900 dark:text-white">{label.length === 7 ? fmtMonth(label) : label}</p>}
      {payload.map((p) => (
        <p key={p.name} className="tnum flex items-center gap-2 text-zinc-600 dark:text-zinc-300">
          <span className="h-2 w-2 rounded-full" style={{ background: p.color }} />
          {p.name}: <span className="font-medium text-zinc-900 dark:text-white">{money(p.value, currency)}</span>
        </p>
      ))}
    </div>
  );
}

export function RevenueChart({ data, currency, height = 260 }: { data: { month: string; invoiced: string; collected: string }[]; currency: string; height?: number }) {
  const rows = data.map((d) => ({ month: d.month, Invoiced: dec(d.invoiced).toNumber(), Collected: dec(d.collected).toNumber() }));
  return (
    <div style={{ height }} role="img" aria-label="Bar chart of invoiced and collected amounts by month">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 8, right: 4, left: 0, bottom: 0 }} barGap={2}>
          <CartesianGrid vertical={false} stroke={CHART.grid} />
          <XAxis dataKey="month" tickFormatter={fmtMonth} tickLine={false} axisLine={false} fontSize={11} stroke="#a1a1aa" interval="preserveStartEnd" minTickGap={8} />
          <YAxis tickFormatter={(v) => compactMoney(v, currency).replace(/^\S+\s/, "")} tickLine={false} axisLine={false} fontSize={11} stroke="#a1a1aa" width={44} />
          <Tooltip cursor={{ fill: "rgba(113,113,122,0.08)" }} content={<TooltipBox currency={currency} />} />
          <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
          <Bar dataKey="Invoiced" fill={CHART.invoiced} radius={[3, 3, 0, 0]} maxBarSize={22} />
          <Bar dataKey="Collected" fill={CHART.collected} radius={[3, 3, 0, 0]} maxBarSize={22} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function DonutChart({ slices, currency, center }: { slices: { name: string; value: number; color: string }[]; currency?: string; center?: { label: string; value: string } }) {
  const total = slices.reduce((a, s) => a + s.value, 0);
  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row">
      <div className="relative h-40 w-40 shrink-0" role="img" aria-label={slices.map((s) => `${s.name}: ${currency ? money(s.value, currency) : s.value}`).join(", ")}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={total ? slices : [{ name: "None", value: 1, color: "#e4e4e7" }]} dataKey="value" innerRadius={52} outerRadius={72} paddingAngle={total ? 2 : 0} stroke="none" isAnimationActive={false}>
              {(total ? slices : [{ color: "#e4e4e7" }]).map((s, i) => (
                <Cell key={i} fill={s.color} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        {center && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
            <span className="text-[11px] text-zinc-500">{center.label}</span>
            <span className="tnum text-sm font-semibold">{center.value}</span>
          </div>
        )}
      </div>
      <ul className="w-full space-y-2 text-sm">
        {slices.map((s) => (
          <li key={s.name} className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2 text-zinc-600 dark:text-zinc-300">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} />
              {s.name}
            </span>
            <span className="tnum font-medium">{currency ? money(s.value, currency) : s.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function HBarList({ rows, format }: { rows: { label: string; value: number; color?: string; hint?: string }[]; format?: (v: number) => string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="space-y-3">
      {rows.map((r) => (
        <li key={r.label}>
          <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
            <span className="truncate text-zinc-700 dark:text-zinc-300">{r.label}</span>
            <span className="tnum shrink-0 font-medium">{format ? format(r.value) : r.value}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
            <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${(r.value / max) * 100}%`, background: r.color ?? CHART.collected }} />
          </div>
          {r.hint && <p className="mt-1 text-xs text-zinc-500">{r.hint}</p>}
        </li>
      ))}
    </ul>
  );
}
