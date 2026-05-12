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

export const formatDate = (d: string | Date) => {
  const date = typeof d === "string" ? new Date(d) : d;
  return _df.format(date);
};

export const today = () => new Date().toISOString().slice(0, 10);
