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

// Personas del rendimiento por zonas: siempre enteras (una persona no se
// parte — decisión del dueño). El fallback a un decimal es solo defensivo por
// si algún cálculo devolviera fracción; no debería verse en pantalla.
export const formatPersonas = (v: number | null | undefined): string => {
  const n = Number(v || 0);
  return Number.isInteger(n) ? _nf.format(n) : _nfCustom(1).format(n);
};

// Euros con "—" para null/NaN (en vez de "0,00 €", que sugeriría un dato real
// de cero en vez de "sin dato"). Única fuente: antes había 6 copias locales
// idénticas en EconomicoPanel/Cmv/Costes/Fruta/Facturacion/DireccionDashboard
// — cada copia respeta su propio digits por defecto en la llamada (la de
// DireccionDashboard usaba digits=0, el resto digits=2).
export const formatEuro = (value: number | null | undefined, digits = 2): string => {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${formatNumber(value, digits)} €`;
};

// €/kg con 3 decimales por defecto: en cítricos los céntimos por kg son la
// diferencia entre ganar y perder (ver Económico → CMV).
export const formatEurKg = (value: number | null | undefined, digits = 3): string => {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${formatNumber(value, digits)} €/kg`;
};

// Kg compactos para tablas y paneles densos (Análisis diario, Productores…):
// a partir de 1 t se muestra en toneladas con un decimal ("45,7 t"); por
// debajo, kg enteros ("980 kg"). Única fuente: antes había 5 copias locales.
export const formatKgCompact = (v: number | null | undefined) => {
  const n = Number(v || 0);
  return n >= 1000 ? _nfCustom(1).format(n / 1000) + " t" : _nf.format(n) + " kg";
};

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

// Fecha y hora legibles; devuelve "" si el valor no es una fecha válida
// (evita imprimir "Invalid Date" en pantalla o en reportes).
export const formatDateTime = (d: string | Date | null | undefined) => {
  if (!d) return "";
  const date = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("es-ES");
};

export const today = () => toISODateLocal(new Date());

// Normaliza texto para comparar/buscar sin distinguir mayúsculas ni tildes:
// minúsculas + NFD + elimina las marcas diacríticas combinantes. Única
// fuente: antes había 4 copias locales (EntradasBascula, TrazabilidadLote,
// Productores, useProductores.normalizeNombre).
// `trim: true` además recorta espacios al principio/final — necesario cuando
// el resultado se usa como clave de igualdad (p. ej. nombre de productor
// como clave de Map); no hace falta para búsquedas con `.includes()`, donde
// los espacios de borde no cambian el resultado.
//
// ESPEJO: normalizarTexto(valor, {trim:true}) tiene una réplica en SQL,
// public.normalizar_nombre_productor(text) (ver supabase/migrations/
// 20260714090000_productores_canonicos.sql), usada por los triggers y el
// backfill de productor_id/productor_finca_id. Esa réplica aproxima el NFD
// de aquí con translate() sobre los diacríticos españoles habituales (no es
// un NFD genérico) — si esta función cambia de forma que afecte a nombres de
// productor, replicar el cambio también en esa función SQL.
export function normalizarTexto(value: string | null | undefined, opts?: { trim?: boolean }): string {
  const out = String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
  // Modo clave de igualdad: además de recortar bordes, colapsa espacios
  // internos múltiples — igual que normalizar_nombre_productor en SQL, que
  // hace regexp_replace('\s+', ' '). Sin esto, "Juan  García" (doble espacio)
  // generaría claves distintas en JS y en los triggers de la base de datos.
  return opts?.trim ? out.replace(/\s+/g, " ").trim() : out;
}
