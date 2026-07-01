const _nf = new Intl.NumberFormat("es-ES", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const _nfPct = new Intl.NumberFormat("es-ES", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const _nfCustom = (digits: number) =>
  new Intl.NumberFormat("es-ES", { minimumFractionDigits: digits, maximumFractionDigits: digits });
const _df = new Intl.DateTimeFormat("es-ES", { day: "2-digit", month: "short", year: "numeric" });

export const formatKg = (v: number | null | undefined, digits = 0) =>
  (digits === 0 ? _nf : _nfCustom(digits)).format(Number(v || 0)) + " kg";

export const formatPct = (v: number | null | undefined, digits = 1) =>
  (digits === 1 ? _nfPct : _nfCustom(digits)).format(Number(v || 0)) + " %";

export const formatNumber = (v: number | null | undefined, digits = 0) =>
  (digits === 0 ? _nf : _nfCustom(digits)).format(Number(v || 0));

// Parsea una fecha sin desplazamiento de zona horaria: "YYYY-MM-DD" se ancla al
// mediodía local en vez de a medianoche UTC (que en España adelantaría/atrasaría el día).
const parseLocalDate = (value: string): Date => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0);
  return new Date(value);
};

// Fecha "YYYY-MM-DD" a partir de los componentes LOCALES (no UTC).
export const toISODateLocal = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

export const formatDate = (d: string | Date) => {
  const date = typeof d === "string" ? parseLocalDate(d) : d;
  if (!date || Number.isNaN(date.getTime())) return "";
  return _df.format(date);
};

export const today = () => toISODateLocal(new Date());
