// Date parsing helpers. Only unambiguous formats are recognised; we never
// guess between DD/MM and MM/DD.

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6,
  jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11,
  november: 11, dec: 12, december: 12,
};

const pad = (n: number) => String(n).padStart(2, '0');

function valid(y: number, m: number, d: number): boolean {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

const MONTH_RE = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';

const PATTERNS: { re: RegExp; parse: (m: RegExpExecArray) => string | null }[] = [
  {
    re: /\b(\d{4})-(\d{2})-(\d{2})\b/g,
    parse: (m) => (valid(+m[1], +m[2], +m[3]) ? `${m[1]}-${m[2]}-${m[3]}` : null),
  },
  {
    re: new RegExp(`\\b(\\d{1,2})\\s+${MONTH_RE}\\.?,?\\s+(\\d{4})\\b`, 'gi'),
    parse: (m) => {
      const mo = MONTHS[m[2].toLowerCase()];
      return mo && valid(+m[3], mo, +m[1]) ? `${m[3]}-${pad(mo)}-${pad(+m[1])}` : null;
    },
  },
  {
    re: new RegExp(`\\b${MONTH_RE}\\.?\\s+(\\d{1,2}),?\\s+(\\d{4})\\b`, 'gi'),
    parse: (m) => {
      const mo = MONTHS[m[1].toLowerCase()];
      return mo && valid(+m[3], mo, +m[2]) ? `${m[3]}-${pad(mo)}-${pad(+m[2])}` : null;
    },
  },
  {
    // Month-precision only, e.g. "December 2025".
    re: new RegExp(`\\b${MONTH_RE}\\.?\\s+(\\d{4})\\b`, 'gi'),
    parse: (m) => {
      const mo = MONTHS[m[1].toLowerCase()];
      return mo ? `${m[2]}-${pad(mo)}` : null;
    },
  },
];

/** Returns the first unambiguous date found in text (YYYY-MM-DD, or YYYY-MM for month precision). */
export function findDate(text: string): string | null {
  let best: { idx: number; val: string } | null = null;
  for (const p of PATTERNS) {
    p.re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = p.re.exec(text))) {
      const v = p.parse(m);
      if (v && (!best || m.index < best.idx || (m.index === best.idx && v.length > best.val.length))) {
        best = { idx: m.index, val: v };
      }
    }
  }
  return best?.val ?? null;
}

/** Validates a user-entered YYYY-MM-DD document date. */
export function isValidIsoDate(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  return !!m && valid(+m[1], +m[2], +m[3]) && +m[1] >= 1900 && +m[1] <= 2100;
}

export function daysBetween(a: string, b: string): number | null {
  if (!isValidIsoDate(a) || !isValidIsoDate(b)) return null;
  return Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return 'Date not recorded';
  const full = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  if (full) return `${+full[3]} ${names[+full[2] - 1]} ${full[1]}`;
  const mo = /^(\d{4})-(\d{2})$/.exec(iso);
  if (mo) return `${names[+mo[2] - 1]} ${mo[1]}`;
  return iso;
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

/** Every unambiguous date in the text (YYYY-MM-DD or YYYY-MM), in order of appearance, de-duplicated. */
export function findAllDates(text: string): string[] {
  const hits: { idx: number; val: string }[] = [];
  for (const p of PATTERNS) {
    p.re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = p.re.exec(text))) {
      const v = p.parse(m);
      if (v) hits.push({ idx: m.index, val: v });
    }
  }
  // Drop month-precision matches that are part of a full date found at the same position.
  const full = hits.filter((h) => h.val.length === 10);
  const kept = hits.filter((h) => h.val.length === 10 || !full.some((f) => f.val.startsWith(h.val) && Math.abs(f.idx - h.idx) < 12));
  return [...new Set(kept.sort((a, b) => a.idx - b.idx).map((h) => h.val))];
}
