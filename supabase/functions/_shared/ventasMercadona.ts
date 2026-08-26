// Ventas semanales a Mercadona: cálculo puro + render del correo (compartida
// frontend/Deno, patrón fotoLotesCoherencia).
//
// POR QUÉ EXISTE (19-08-2026, encargo del dueño): "envíame cada lunes las
// ventas de la semana de Mercadona" — kg, cajas y palets. El dato ya vive en
// la Herramienta (erp_palet, sincronizado del ERP a diario); esto solo lo
// agrega por semana, lo compara con la anterior y lo deja listo para enviar.
//
// La fuente es erp_palet con cliente = "MERCADONA S.A." — la MISMA que ve la
// pestaña Expediciones de /mercadona y la que usa el aviso diario para los
// palets. Nada de números nuevos que puedan contradecir a los de la pantalla.

export const CLIENTE_MERCADONA = "MERCADONA S.A.";

// ── Semanas ISO ──────────────────────────────────────────────────────────────
// Copia de los helpers de informeSemanal.ts: se replican aquí (tres funciones
// de pura aritmética de fechas) para que la edge function NO tenga que importar
// informeSemanal.ts, que arrastra todo el árbol de rentabilidad y merma.

export interface SemanaIso {
  anio: number;
  semana: number;
}

const DIA_MS = 86_400_000;

function aFechaUtc(fechaISO: string): Date {
  const [y, m, d] = fechaISO.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
function aISO(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Semana ISO-8601 de una fecha YYYY-MM-DD. */
export function semanaIsoDe(fechaISO: string): SemanaIso {
  const d = aFechaUtc(fechaISO);
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const anio = d.getUTCFullYear();
  const inicioAnio = new Date(Date.UTC(anio, 0, 1));
  const semana = Math.ceil(((d.getTime() - inicioAnio.getTime()) / DIA_MS + 1) / 7);
  return { anio, semana };
}

/** Las 7 fechas (lunes..domingo) de una semana ISO. */
export function fechasSemanaIso(anio: number, semana: number): string[] {
  const enero4 = new Date(Date.UTC(anio, 0, 4));
  const lunesSemana1 = new Date(enero4.getTime() - ((enero4.getUTCDay() || 7) - 1) * DIA_MS);
  const lunes = new Date(lunesSemana1.getTime() + (semana - 1) * 7 * DIA_MS);
  return Array.from({ length: 7 }, (_, i) => aISO(new Date(lunes.getTime() + i * DIA_MS)));
}

/** Semana ISO anterior a la de la fecha dada. */
export function semanaIsoAnterior(hoyISO: string): SemanaIso {
  const hoy = aFechaUtc(hoyISO);
  const lunes = new Date(hoy.getTime() - ((hoy.getUTCDay() || 7) - 1) * DIA_MS);
  return semanaIsoDe(aISO(new Date(lunes.getTime() - 7 * DIA_MS)));
}

/** Una línea de palet de erp_palet con lo que necesita el recuento. */
export interface PaletVenta {
  numero: string | null;
  num_cajas: number | null;
  kg_netos: number | null;
  fecha: string | null;
}

export interface ResumenSemana {
  palets: number;
  cajas: number;
  kg: number;
}

const num = (v: unknown): number => Number(v) || 0;

/**
 * Recuento de una semana: palets (números DISTINTOS, por si una línea se
 * repartiera en varias filas), cajas y kg. Ignora filas sin número de palet.
 */
export function resumirVentasSemana(filas: PaletVenta[]): ResumenSemana {
  const palets = new Set<string>();
  let cajas = 0;
  let kg = 0;
  for (const f of filas) {
    if (f.numero) palets.add(f.numero);
    cajas += num(f.num_cajas);
    kg += num(f.kg_netos);
  }
  return { palets: palets.size, cajas: Math.round(cajas), kg: Math.round(kg) };
}

/** Parte las filas de un rango de dos semanas en [semana objetivo, anterior]. */
export function partirEnSemanas(
  filas: PaletVenta[],
  lunesObjetivo: string,
): { objetivo: PaletVenta[]; anterior: PaletVenta[] } {
  const objetivo: PaletVenta[] = [];
  const anterior: PaletVenta[] = [];
  for (const f of filas) {
    if (!f.fecha) continue;
    (f.fecha >= lunesObjetivo ? objetivo : anterior).push(f);
  }
  return { objetivo, anterior };
}

const miles = (n: number) => Math.round(n).toLocaleString("es-ES");

const DIAS_MES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
/** "10 ago" a partir de "2026-08-10". */
function diaCorto(iso: string): string {
  return `${Number(iso.slice(8, 10))} ${DIAS_MES[Number(iso.slice(5, 7)) - 1]}`;
}

/** "+4%" / "−12%" comparando con la semana anterior; null si no hay con qué. */
function variacion(actual: number, anterior: number): string | null {
  if (!(anterior > 0)) return null;
  const p = Math.round(((actual - anterior) / anterior) * 100);
  if (p === 0) return "igual que la semana pasada";
  return `${p > 0 ? "+" : "−"}${Math.abs(p)}% sobre la semana pasada`;
}

export interface DatosCorreoMercadona {
  anio: number;
  semana: number;
  /** [lunes, ..., domingo] de la semana objetivo. */
  fechas: string[];
  actual: ResumenSemana;
  anterior: ResumenSemana;
}

/** El asunto: lo esencial se lee sin abrir el correo. */
export function asuntoVentasMercadona(d: DatosCorreoMercadona): string {
  return `Ventas Mercadona semana ${d.semana}/${d.anio} · ${miles(d.actual.palets)} palets · ${miles(d.actual.kg)} kg`;
}

/** El correo en texto plano (respaldo y clientes antiguos). */
export function renderVentasMercadonaTexto(d: DatosCorreoMercadona): string {
  const rango = `${diaCorto(d.fechas[0])} a ${diaCorto(d.fechas[6])}`;
  const linea = (etiqueta: string, actual: number, anterior: number) => {
    const v = variacion(actual, anterior);
    return `  ${etiqueta.padEnd(8, ".")} ${miles(actual).padStart(10)}${v ? `   (${v})` : ""}`;
  };
  return [
    `Ventas a Mercadona · semana ${d.semana}/${d.anio} (${rango})`,
    "",
    linea("Palets", d.actual.palets, d.anterior.palets),
    linea("Cajas", d.actual.cajas, d.anterior.cajas),
    linea("Kg", d.actual.kg, d.anterior.kg),
    "",
    "El detalle por dia y producto esta en la Herramienta:",
    "https://controlproduccion.vercel.app/mercadona (pestaña Expediciones).",
    "",
    "--",
    "Correo automatico de los lunes. Sale de los palets del ERP (cliente",
    "MERCADONA S.A.) de la semana que acaba de cerrar.",
  ].join("\n");
}

const TINTA = "#1f2937";
const GRIS = "#6b7280";
const VERDE = "#047857";
const ROJO = "#b91c1c";
const AZUL = "#0369a1";

function celdaMetrica(etiqueta: string, actual: number, anterior: number): string {
  const v = variacion(actual, anterior);
  const p = anterior > 0 ? Math.round(((actual - anterior) / anterior) * 100) : null;
  const color = p == null || p === 0 ? GRIS : p > 0 ? VERDE : ROJO;
  return `<td style="padding:14px 10px;text-align:center;vertical-align:top;border:1px solid #e5e7eb;border-radius:10px;">
    <div style="font-size:11px;font-weight:700;letter-spacing:1px;color:${GRIS};text-transform:uppercase;">${etiqueta}</div>
    <div style="font-size:26px;font-weight:700;color:${TINTA};margin-top:4px;">${miles(actual)}</div>
    ${v ? `<div style="font-size:12px;color:${color};margin-top:2px;">${v}</div>` : ""}
  </td>`;
}

/** El correo en HTML (lo que se lee de verdad). */
export function renderVentasMercadonaHtml(d: DatosCorreoMercadona): string {
  const rango = `${diaCorto(d.fechas[0])} a ${diaCorto(d.fechas[6])}`;
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f3f4f6;">
<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;background:#f3f4f6;border-collapse:collapse;"><tr><td align="center" style="padding:16px 8px;">
<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;max-width:560px;background:#ffffff;border-radius:12px;border-collapse:collapse;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<tr><td style="padding:22px 22px 8px;">
  <p style="margin:0 0 4px;font-size:11px;font-weight:700;letter-spacing:1px;color:${GRIS};">LASARTE C&Iacute;TRICOS S.L. &middot; VENTAS MERCADONA</p>
  <p style="margin:0;font-size:20px;font-weight:700;color:${TINTA};">Semana ${d.semana}/${d.anio}</p>
  <p style="margin:2px 0 0;font-size:13px;color:${GRIS};">${rango}</p>
</td></tr>
<tr><td style="padding:12px 16px 8px;">
  <table role="presentation" cellpadding="0" cellspacing="6" style="width:100%;border-collapse:separate;"><tr>
    ${celdaMetrica("Palets", d.actual.palets, d.anterior.palets)}
    ${celdaMetrica("Cajas", d.actual.cajas, d.anterior.cajas)}
    ${celdaMetrica("Kg", d.actual.kg, d.anterior.kg)}
  </tr></table>
</td></tr>
<tr><td style="padding:4px 22px 22px;">
  <p style="margin:12px 0 0;"><a href="https://controlproduccion.vercel.app/mercadona" style="display:inline-block;background:${AZUL};color:#ffffff;font-size:13px;font-weight:600;padding:9px 16px;border-radius:8px;text-decoration:none;">Ver el detalle por día y producto</a></p>
  <p style="margin:16px 0 0;padding-top:12px;border-top:1px solid #e5e7eb;font-size:11px;color:${GRIS};line-height:1.5;">
    Correo automático de los lunes. Sale de los palets del ERP (cliente MERCADONA S.A.) de la
    semana que acaba de cerrar — la misma fuente que la pestaña Expediciones de la Herramienta.
  </p>
</td></tr>
</table>
</td></tr></table>
</body></html>`;
}
