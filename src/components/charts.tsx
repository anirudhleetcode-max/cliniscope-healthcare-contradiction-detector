// Lightweight, dependency-free charts. Every chart renders from real counts,
// exposes an accessible summary, and includes a visually hidden data table.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { cx } from './ui';

export interface Datum { key: string; label: string; value: number; color: string; to?: string }

export function ChartLegend({ data, total }: { data: Datum[]; total: number }) {
  return (
    <ul className="grid gap-1.5 text-[13px]" aria-hidden>
      {data.map((d) => (
        <li key={d.key} className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: d.color }} />
          <span className="min-w-0 flex-1 truncate text-muted">{d.label}</span>
          <span className="tabular-nums font-medium text-ink">{d.value}</span>
          <span className="w-10 text-right tabular-nums text-xs text-faint">{total ? Math.round((d.value / total) * 100) : 0}%</span>
        </li>
      ))}
    </ul>
  );
}

function DataTable({ caption, data }: { caption: string; data: Datum[] }) {
  return (
    <table className="sr-only">
      <caption>{caption}</caption>
      <thead><tr><th scope="col">Item</th><th scope="col">Count</th></tr></thead>
      <tbody>{data.map((d) => <tr key={d.key}><td>{d.label}</td><td>{d.value}</td></tr>)}</tbody>
    </table>
  );
}

/** Horizontal bar chart (category distribution). Bars link to filtered views when `to` is given. */
export function BarList({ data, caption, testId }: { data: Datum[]; caption: string; testId?: string }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const total = data.reduce((s, d) => s + d.value, 0);
  const [hover, setHover] = useState<string | null>(null);
  return (
    <figure className="m-0" data-testid={testId}>
      <ul className="space-y-3" role="list" aria-label={caption}>
        {data.map((d) => {
          const pct = Math.round((d.value / Math.max(total, 1)) * 100);
          const inner = (
            <>
              <div className="mb-1 flex items-baseline justify-between gap-2 text-[13px]">
                <span className="font-medium text-ink">{d.label}</span>
                <span className="tabular-nums text-muted"><span className="font-semibold text-ink">{d.value}</span> · {pct}%</span>
              </div>
              <div className="relative h-2 overflow-hidden rounded-full bg-line/70">
                <div className={cx('absolute inset-y-0 left-0 rounded-full transition-[width,opacity] duration-300', hover && hover !== d.key && 'opacity-50')} style={{ width: `${(d.value / max) * 100}%`, background: d.color }} />
              </div>
            </>
          );
          return (
            <li key={d.key} onMouseEnter={() => setHover(d.key)} onMouseLeave={() => setHover(null)} title={`${d.label}: ${d.value} finding(s), ${pct}% of total`}>
              {d.to ? <Link to={d.to} className="block rounded-md outline-offset-4 hover:opacity-90" aria-label={`${d.label}: ${d.value} findings. Open filtered list.`}>{inner}</Link> : inner}
            </li>
          );
        })}
      </ul>
      <DataTable caption={caption} data={data} />
    </figure>
  );
}

/** Donut chart for review-status distribution, with legend and centre total. */
export function Donut({ data, caption, centerLabel, testId }: { data: Datum[]; caption: string; centerLabel: string; testId?: string }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  const [hover, setHover] = useState<string | null>(null);
  const r = 42;
  const c = 2 * Math.PI * r;
  let offset = 0;
  const shown = data.filter((d) => d.value > 0);
  const focus = hover ? data.find((d) => d.key === hover) : null;
  return (
    <figure className="m-0 flex flex-col items-center gap-5 sm:flex-row sm:items-center" data-testid={testId}>
      <div className="relative h-[132px] w-[132px] shrink-0">
        <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90" role="img" aria-label={`${caption}: ${shown.map((d) => `${d.label} ${d.value}`).join(', ') || 'no data'}`}>
          <circle cx="50" cy="50" r={r} fill="none" stroke="rgb(var(--border))" strokeWidth="12" />
          {shown.map((d) => {
            const len = (d.value / Math.max(total, 1)) * c;
            const el = (
              <circle key={d.key} cx="50" cy="50" r={r} fill="none" stroke={d.color} strokeWidth={hover === d.key ? 14 : 12}
                strokeDasharray={`${len} ${c - len}`} strokeDashoffset={-offset} className="transition-[stroke-width] duration-150"
                onMouseEnter={() => setHover(d.key)} onMouseLeave={() => setHover(null)}>
                <title>{`${d.label}: ${d.value}`}</title>
              </circle>
            );
            offset += len;
            return el;
          })}
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="text-[24px] font-semibold leading-none tabular-nums">{focus ? focus.value : total}</span>
          <span className="mt-1 max-w-[90px] text-[11px] leading-tight text-muted">{focus ? focus.label : centerLabel}</span>
        </div>
      </div>
      <div className="w-full min-w-0"><ChartLegend data={data} total={total} /></div>
      <DataTable caption={caption} data={data} />
    </figure>
  );
}

/** Single stacked bar (e.g. review progress for one case). */
export function StackedBar({ data, label }: { data: Datum[]; label: string }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  return (
    <div>
      <div className="flex h-2 w-full overflow-hidden rounded-full bg-line/70" role="img" aria-label={`${label}: ${data.map((d) => `${d.label} ${d.value}`).join(', ')}`}>
        {data.filter((d) => d.value).map((d) => <div key={d.key} style={{ width: `${(d.value / Math.max(total, 1)) * 100}%`, background: d.color }} title={`${d.label}: ${d.value}`} />)}
      </div>
    </div>
  );
}

/** Token-based chart palette (kept in sync with src/index.css). */
export const CHART = {
  brand: 'rgb(var(--brand))',
  brandLight: 'rgb(23 107 103 / 0.55)',
  info: 'rgb(var(--info))',
  warn: 'rgb(183 121 31)',
  crit: 'rgb(var(--danger))',
  ok: 'rgb(var(--success))',
  neutral: 'rgb(var(--border-strong))',
  slate: 'rgb(var(--text-muted))',
};
