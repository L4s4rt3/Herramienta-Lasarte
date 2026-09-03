/**
 * analisis-tipo-dia — el análisis económico por TIPO DE DÍA (plantilla
 * completa/reducida × día bueno/medio/malo) que pidió el dueño en la reunión
 * del 27-08-2026, en Excel.
 *
 *   node node_modules/vite-node/vite-node.mjs scripts/analisis-tipo-dia.ts [--desde=2026-05-01] [--hasta=YYYY-MM-DD] [--fuente=vista|tabla]
 *
 * DESDE EL 03-09-2026 ESTO MISMO ESTÁ EN LA APP: Económico → Rentabilidad →
 * «Por tipo de día». Las funciones que hacen los números son LAS MISMAS
 * (src/lib/tipoDia.ts = supabase/functions/_shared/tipoDia.ts, sobre
 * computeRentabilidadDia): misma cifra aquí y en pantalla. El script queda para
 * quien quiera el Excel. Las reglas (régimen y listón del dueño, euros de venta
 * solo con tarifa Mercadona real, mínimo de kg, días sin asistencia aparte)
 * están explicadas en la cabecera de esa librería y en estandarRendimiento.ts.
 *
 * FUENTE DE LOS KG: por defecto la vista canónica del calibrador (la máquina,
 * todas las pasadas), vía la RPC rentabilidad_filas_dias, igual que la
 * pantalla. Con --fuente=tabla lee lote_clasificacion (el Informe LOTE en
 * Excel, solo la última pasada del día), que es lo que leía la versión
 * anterior de este análisis (tmp/analisis-tipo-dia.ts, 27-08): sirve para
 * comparar, no para decidir.
 */
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import {
  agregarDias,
  construirDiasTipo,
  EUR_KG_MINIMO_FIABLE,
  filasPorDiaDesde,
  frutaPorLoteDesdeEntradas,
  KG_MINIMO_DIA,
  presentesPorDiaDesde,
  resumenPorTipo,
  semanasPrecio,
  type DiaTipo,
} from "../src/lib/tipoDia";
import { ESTANDAR_RENDIMIENTO } from "../src/lib/estandarRendimiento";
import type { FilaClasifRentabilidad } from "../src/lib/rentabilidadDia";
import {
  añadirHojaTabla,
  crearLibroLasarte,
  FMT_EUR,
  FMT_INT,
  FMT_KG,
  type ColumnaTabla,
} from "../src/lib/exportKit";

process.loadEnvFile(".env");

const arg = (nombre: string): string | undefined =>
  process.argv.find((a) => a.startsWith(`--${nombre}=`))?.slice(nombre.length + 3);
const DESDE = arg("desde") ?? "2026-05-01";
const HASTA = arg("hasta") ?? new Date().toISOString().slice(0, 10);
const FUENTE = (arg("fuente") ?? "vista") as "vista" | "tabla";
if (FUENTE !== "vista" && FUENTE !== "tabla") throw new Error("--fuente debe ser vista o tabla");
const SALIDA = path.resolve("outputs", arg("salida") ?? "Analisis_Economico_Tipo_de_Dia.xlsx");
const EST = ESTANDAR_RENDIMIENTO;

const num = (v: unknown): number => Number(v) || 0;
const eurCol = (header: string, key: string, width = 14): ColumnaTabla => ({ header, key, tipo: "numero", numFmt: FMT_EUR, width });
const kgCol = (header: string, key: string, width = 13): ColumnaTabla => ({ header, key, tipo: "numero", numFmt: FMT_KG, width });
const intCol = (header: string, key: string, width = 9): ColumnaTabla => ({ header, key, tipo: "numero", numFmt: FMT_INT, width });

async function fetchTodas<T>(
  etiqueta: string,
  consulta: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await consulta(from, from + 999);
    if (error) throw new Error(`${etiqueta}: ${error.message}`);
    const filas = data ?? [];
    out.push(...filas);
    if (filas.length < 1000) { console.log(`  ${etiqueta}: ${out.length} filas`); return out; }
  }
}

type FilaConFecha = FilaClasifRentabilidad & { fecha: string | null };

/** Filas POSICIONALES de la RPC (contrato con la migración rentabilidad_filas_dias). */
type FilaPosicional = [string, string | null, string | null, string | null, string | null, number | string | null, number | string | null, number | string | null];

async function cargarFilas(db: SupabaseClient): Promise<FilaConFecha[]> {
  if (FUENTE === "tabla") {
    return fetchTodas<FilaConFecha>("lote_clasificacion", (f, t) =>
      db.from("lote_clasificacion")
        .select("fecha, lote_codigo, productor, producto, clase, peso_kg, toneladas_hora, duracion_min")
        .gte("fecha", DESDE).lte("fecha", HASTA).order("id").range(f, t));
  }
  const { data, error } = await db.rpc("rentabilidad_filas_dias", { desde: DESDE, hasta: HASTA });
  if (error) throw new Error(`rentabilidad_filas_dias: ${error.message}`);
  const r = data as unknown as { refrescado_en: string | null; filas: FilaPosicional[] } | null;
  const filas = (r?.filas ?? []).map((f): FilaConFecha => ({
    fecha: f[0], lote_codigo: f[1], productor: f[2], producto: f[3], clase: f[4],
    peso_kg: f[5] == null ? null : Number(f[5]), toneladas_hora: f[7] == null ? null : Number(f[7]), duracion_min: f[6] == null ? null : Number(f[6]),
  }));
  console.log(`  rentabilidad_filas_dias (vista canónica): ${filas.length} filas · detalle refrescado ${r?.refrescado_en ?? "?"}`);
  return filas;
}

async function main() {
  const db: SupabaseClient = createClient(
    process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? "",
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
    { auth: { persistSession: false } },
  );
  console.log(`Tipo de día · ${DESDE} → ${HASTA} · fuente de kg: ${FUENTE === "vista" ? "vista canónica del calibrador" : "lote_clasificacion (Informe LOTE en Excel)"}`);

  const [filas, asistencia, trabajadores, entradas, semanas] = await Promise.all([
    cargarFilas(db),
    fetchTodas<{ date: string; trabajador_id: string }>("asistencia_detalle", (f, t) =>
      db.from("asistencia_detalle").select("date, trabajador_id")
        .gte("date", DESDE).lte("date", HASTA).eq("presente", true).order("id").range(f, t)),
    fetchTodas<{ id: string; coste_hora: number | null }>("trabajadores", (f, t) =>
      db.from("trabajadores").select("id, coste_hora").order("id").range(f, t)),
    fetchTodas<{ lote: string | null; kg_entrada: number | null; importe_total: number | null }>("entradas_bascula", (f, t) =>
      db.from("entradas_bascula").select("lote, kg_entrada, importe_total").order("lote").range(f, t)),
    fetchTodas<{ anio: number; semana: number; metodos: unknown }>("mercadona semanas+metodos", (f, t) =>
      db.from("mercadona_semanas").select("anio, semana, metodos:mercadona_semana_metodos(metodo, kilos, base_iva)")
        .order("anio").order("semana").range(f, t)),
  ]);

  const semanasP = semanasPrecio(semanas.map((s) => ({
    anio: s.anio, semana: s.semana,
    metodos: (s.metodos ?? []) as Array<{ metodo: string | null; kilos: number | null; base_iva: number | null }>,
  })));
  const r = construirDiasTipo({
    filasPorDia: filasPorDiaDesde(filas),
    presentesPorDia: presentesPorDiaDesde(asistencia),
    costeHoraPorTrabajador: new Map(trabajadores.map((t) => [t.id, t.coste_hora])),
    frutaPorLote: frutaPorLoteDesdeEntradas(entradas),
    semanas: semanasP,
  });
  const dias = r.dias;
  const resumen = resumenPorTipo(dias);
  const diasConCuenta = dias.filter((d) => d.conCuenta);
  const resumenCuenta = resumenPorTipo(diasConCuenta);
  const fiables = semanasP.filter((s) => s.fiable).map((s) => `S${s.semana}`);

  // ─── Excel ─────────────────────────────────────────────────────────────────
  const ctx = crearLibroLasarte({
    titulo: "Análisis económico por tipo de día (plantilla × rendimiento)",
    periodo: `${dias[0]?.fecha} a ${dias.at(-1)?.fecha} · plantilla reducida = ≤${EST.cortePlantillaReducida} presentes (definición del dueño 27-08)`,
    usuario: "Herramienta Lasarte (análisis para dirección)",
    clasificacion: "Dirección",
  });

  const filaAgregado = (f: ReturnType<typeof agregarDias>) => ({ ...f }) as Record<string, unknown>;

  añadirHojaTabla(ctx, {
    nombreHoja: "Por tipo de día",
    titulo: `ESTRUCTURA de los ${dias.length} días · reducida = ≤${EST.cortePlantillaReducida} presentes (media plantilla); 45 con faltas sigue siendo completa · bueno/malo contra el listón de SU régimen: completa ${EST.regimenes.completa.kgPersonaSuelo}/${EST.regimenes.completa.kgPersonaObjetivo} · reducida ${EST.regimenes.reducida.kgPersonaSuelo}/${EST.regimenes.reducida.kgPersonaObjetivo} kg/pers (estándar del dueño 27-08)`,
    autofilter: false,
    columnas: [
      { header: "Tipo de día", key: "tipo", width: 34 },
      intCol("Días", "dias", 8),
      kgCol("Kg/día", "kg"),
      intCol("Personas", "presentes", 10),
      kgCol("Kg/persona", "kgPersona", 12),
      eurCol("Personal/día", "personal"),
      { header: "Personal €/kg", key: "personalKg", tipo: "numero", numFmt: "#,##0.0000", width: 13 },
    ],
    filas: resumen.map(filaAgregado),
    totales: filaAgregado(agregarDias("TODOS LOS DÍAS", dias)),
  });

  añadirHojaTabla(ctx, {
    nombreHoja: "Cuenta completa",
    titulo: `La cuenta ENTERA (metodología v5) solo en los ${diasConCuenta.length} días con clasificación, asistencia en la base y tarifa Mercadona real (${fiables.length ? fiables.join(", ") : "ninguna semana fiable"})`,
    autofilter: false,
    columnas: [
      { header: "Tipo de día", key: "tipo", width: 34 },
      intCol("Días", "dias", 8),
      kgCol("Kg/día", "kg"),
      intCol("Personas", "presentes", 10),
      kgCol("Kg/persona", "kgPersona", 12),
      eurCol("Ingresos/día", "ingresos"),
      eurCol("Personal/día", "personal"),
      eurCol("Envase/día", "envase", 12),
      eurCol("Suministros", "suministros", 12),
      eurCol("MARGEN/día", "margen"),
      eurCol("Fruta/día", "fruta"),
      eurCol("BENEFICIO/día", "beneficio", 15),
      kgCol("Kg sin coste fruta", "kgSinFruta", 15),
    ],
    filas: resumenCuenta.map(filaAgregado),
    totales: diasConCuenta.length ? filaAgregado(agregarDias("TODOS (con tarifa real)", diasConCuenta)) : undefined,
  });

  añadirHojaTabla(ctx, {
    nombreHoja: "Día a día",
    titulo: "Cada día con su tipo, su fuente y su cuenta (euros de venta solo donde la tarifa es real)",
    columnas: [
      { header: "Fecha", key: "fecha", width: 12 },
      { header: "Tipo", key: "tipo", width: 32 },
      { header: "Fuente", key: "fuente", width: 14 },
      intCol("Personas", "presentes", 10),
      kgCol("Kg", "kg"),
      kgCol("Kg/persona", "kgPersona", 12),
      eurCol("Personal", "personal"),
      eurCol("Ingresos", "ingresos"),
      eurCol("Margen", "margen"),
      eurCol("Fruta", "fruta"),
      eurCol("Beneficio", "beneficio"),
    ],
    filas: dias.map((d: DiaTipo) => ({
      fecha: d.fecha, tipo: d.tipo, fuente: "base (v5)", presentes: d.presentes, kg: d.kg,
      kgPersona: d.kgPersona, personal: d.personalEur, ingresos: d.ingresos,
      margen: d.margen, fruta: d.fruta, beneficio: d.beneficio,
    })),
  });

  añadirHojaTabla(ctx, {
    nombreHoja: "Metodología",
    titulo: "Cómo leer este análisis",
    autofilter: false,
    columnas: [{ header: "Nota", key: "a", width: 46 }, { header: "Detalle", key: "b", width: 120 }],
    filas: [
      { a: "Plantilla completa / reducida", b: `Definición del dueño (27-08): reducida = el régimen de media plantilla que empezó en agosto (25-30 presentes); un día de 45 es plantilla completa CON FALTAS. Corte: ≤${EST.cortePlantillaReducida} presentes. En los datos separa limpio los dos regímenes (mayo-julio 45-55; agosto 27-31).` },
      { a: "Bueno / medio / malo", b: `kg/persona contra el estándar DE SU RÉGIMEN (decisión del dueño 27-08): plantilla completa suelo ${EST.regimenes.completa.kgPersonaSuelo} / objetivo ${EST.regimenes.completa.kgPersonaObjetivo}; media plantilla suelo ${EST.regimenes.reducida.kgPersonaSuelo} / objetivo ${EST.regimenes.reducida.kgPersonaObjetivo}. El kg/persona se diluye con plantilla grande, así que cada régimen tiene su listón — el mismo que usa el vigía de negocio, el semáforo del correo diario y los informes de la encargada.` },
      { a: "De dónde salen los kg", b: FUENTE === "vista" ? "La vista canónica del calibrador (volcado SQL del Sizer, TODAS las pasadas; Word de lote como respaldo por lote y día), igual que la pantalla Económico → Rentabilidad → Por tipo de día." : "lote_clasificacion, el Informe LOTE en Excel (solo la última pasada de cada día): la fuente de la versión del 27-08. Solo para comparar." },
      { a: "La cuenta de cada día (donde la hay)", b: "computeRentabilidadDia, la MISMA función pura que /economico/rentabilidad y el informe semanal (v5, validada a mano el 03-08). Ingresos = kg×precio por destino; margen = ingresos − personal − envase − suministros; beneficio = margen − fruta al coste real de báscula. Sin Seguridad Social ni estructura: comparaciones entre días, sí; cuenta de resultados, no." },
      { a: "Precios Mercadona — por qué la cuenta entera solo va con tarifa real", b: `Una semana fija precios si su €/kg medio facturado (base sin IVA / kilos) llega a ${EUR_KG_MINIMO_FIABLE.toFixed(2)}; las que están a medio facturar (0,38-0,47 €/kg frente a 1,02 real) o sin base no valen: usarlas hundiría los ingresos como si fuera verdad. Un día usa su semana fiable o la última fiable anterior. Hoy: ${fiables.length ? fiables.join(", ") : "ninguna"}.` },
      { a: "Lo que se deja fuera", b: `${r.sinAsistencia.length} día(s) con producción sin asistencia en la base (no se pueden clasificar; al volcar la asistencia entran solos) y ${r.descartadosPorKg.length} por debajo de ${KG_MINIMO_DIA} kg (arranques). Un día con 'Kg sin coste fruta' > 0 tiene lotes con báscula sin liquidar: su beneficio es PARCIAL (null ≠ 0).` },
    ],
  });

  await ctx.workbook.xlsx.writeFile(SALIDA);

  // ─── Consola ───────────────────────────────────────────────────────────────
  console.log(`\nDías: ${dias.length} (${dias[0]?.fecha} → ${dias.at(-1)?.fecha}) · sin asistencia en la base: ${r.sinAsistencia.length} · por debajo de ${KG_MINIMO_DIA} kg: ${r.descartadosPorKg.length}`);
  console.log("ESTRUCTURA:");
  for (const t of resumen) {
    console.log(`  ${t.tipo.padEnd(36)} ${String(t.dias).padStart(3)} días · ${Math.round(t.kg ?? 0).toLocaleString("es-ES").padStart(7)} kg/día · ${(t.presentes ?? 0).toFixed(0).padStart(2)} pers · ${Math.round(t.kgPersona ?? 0).toLocaleString("es-ES").padStart(5)} kg/p · personal ${(t.personalKg ?? 0).toFixed(4)} €/kg`);
  }
  console.log(`CUENTA COMPLETA (${diasConCuenta.length} días, tarifa real: ${fiables.join(", ") || "ninguna"}):`);
  for (const t of resumenCuenta) {
    console.log(`  ${t.tipo.padEnd(36)} ${String(t.dias).padStart(3)} días · margen ${Math.round(t.margen ?? 0).toLocaleString("es-ES").padStart(6)} €/día · beneficio ${Math.round(t.beneficio ?? 0).toLocaleString("es-ES").padStart(6)} €/día`);
  }
  if (r.sinAsistencia.length) console.log(`Sin asistencia: ${r.sinAsistencia[0]} → ${r.sinAsistencia.at(-1)} (${r.sinAsistencia.length} días)`);
  console.log(`\nExcel: ${SALIDA}`);
}

main().catch((e) => { console.error("ERROR:", e.message); process.exit(1); });
