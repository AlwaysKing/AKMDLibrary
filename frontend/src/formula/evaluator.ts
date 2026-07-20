export function evalFormula(expr: string, props: Record<string, any>): any {
  const safeProp = (name: string) => props[name] ?? '';
  const fns = {
    prop: safeProp,
    length: (v: any) => Array.isArray(v) || typeof v === 'string' ? v.length : String(v ?? '').length,
    concat: (...args: any[]) => args.map((a) => a ?? '').join(''),
    substr: (s: any, start: any, len?: any) => String(s ?? '').substr(Number(start) || 0, len == null ? undefined : Number(len)),
    lower: (s: any) => String(s ?? '').toLowerCase(),
    upper: (s: any) => String(s ?? '').toUpperCase(),
    replace: (s: any, p: any, r: any) => String(s ?? '').split(String(p ?? '')).join(String(r ?? '')),
    contains: (s: any, sub: any) => String(s ?? '').includes(String(sub ?? '')),
    now: () => new Date().toISOString(),
    dateDiff: (a: any, b: any, unit: string) => {
      const ms = new Date(a).getTime() - new Date(b).getTime();
      const div = unit === 'hours' ? 3600000 : unit === 'minutes' ? 60000 : 86400000;
      return Math.round(ms / div);
    },
    dateAdd: (d: any, n: any, unit: string) => {
      const date = new Date(d);
      const ms = (Number(n) || 0) * (unit === 'hours' ? 3600000 : unit === 'minutes' ? 60000 : 86400000);
      date.setTime(date.getTime() + ms);
      return date.toISOString();
    },
    year: (d: any) => new Date(d).getFullYear(),
    month: (d: any) => new Date(d).getMonth() + 1,
    day: (d: any) => new Date(d).getDate(),
    abs: Math.abs,
    round: Math.round,
    floor: Math.floor,
    ceil: Math.ceil,
    max: Math.max,
    min: Math.min,
    iff: (cond: any, a: any, b: any) => cond ? a : b,
    coalesce: (...args: any[]) => args.find((a) => a !== null && a !== undefined && a !== '') ?? null,
    isEmpty: (v: any) => v == null || v === '' || (Array.isArray(v) && v.length === 0),
  };
  const transformed = expr
    .replace(/\band\b/g, '&&')
    .replace(/\bor\b/g, '||')
    .replace(/\bnot\b/g, '!')
    .replace(/\bif\s*\(/g, 'iff(');
  const keys = Object.keys(fns);
  try {
    // Formula strings are page content, not arbitrary web input; keep the
    // evaluation scope explicit and small.
    // eslint-disable-next-line no-new-func
    return Function(...keys, `"use strict"; return (${transformed});`)(...keys.map((k) => (fns as any)[k]));
  } catch {
    return '#ERROR';
  }
}
