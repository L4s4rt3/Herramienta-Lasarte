/**
 * reparto-pasadas — Edge Function que calcula el reparto CANÓNICO de las
 * pasadas compuestas del calibrador y lo deja en dos tablas que lee la vista
 * clasificacion_lote (pg_cron `reparto-pasadas-horario`, '10 5-20 * * *' UTC:
 * cada hora en horario de trabajo, diez minutos antes del refresco de las
 * materializadas de las :20).
 *
 * POR QUÉ. El Sizer atribuye TODA una pasada al primer código de su nombre,
 * pero el operario escribe lo que echó de verdad ("26013107+26012608",
 * "26050707+4 BOX 26043009"). El reparto ya existía como funciones puras con
 * tests (_shared/calibradorReparto.ts) pero solo se aplicaba en el navegador,
 * en una pantalla; la vista canónica, sus materializadas, el dossier de
 * productores, la campaña y la merma seguían dando el 100 % al primer código.
 * Aquí se calcula UNA vez y todo lo demás lo hereda.
 *
 * QUÉ HACE, en orden:
 *   1. Lee los HECHOS: las pasadas candidatas del volcado SQL (RPC
 *      calibrador_pasadas_con_desglose: nombre con dos códigos o con box/prec/
 *      reciclaje/fecha) y los informes Word (calibrador_informe, batch_id < 0)
 *      que la vista usa de verdad (no superados por el volcado SQL ni por un
 *      Excel de parte del mismo lote-día: la MISMA regla de frescura que la
 *      vista), la capacidad pendiente de cada lote (RPC calibrador_capacidad_lotes,
 *      completada con las pasadas simples del Word, que esa RPC no ve) y los
 *      desgloses que una persona tecleó (pasada_box_lineas → lotes_dia →
 *      partes_diarios, casados con su pasada por primer código y fecha).
 *   2. Decide con `calcularRepartoPasadas`: manual > box del nombre > capacidad > cola.
 *   3. Escribe calibrador_pasada_reparto y calibrador_pasada_sin_repartir de
 *      forma IDEMPOTENTE: solo las filas nuevas o que cambian (así `calculado_en`
 *      dice desde cuándo está así cada una) y borra lo que ya no sale. La vista
 *      clasificacion_lote lo ve al instante.
 *   4. Deja rastro: sistema_ejecuciones + latido "reparto-pasadas" (ok, o
 *      aviso si algún desglose manual no casó con su pasada).
 *
 * LAS MATERIALIZADAS (mix, detalle) NO SE REFRESCAN DESDE AQUÍ, a propósito.
 * `refrescar_clasificacion_lote_mix()` tarda ~32 s (medido 07-09-2026) y la API
 * entra por el rol authenticator con statement_timeout = 8 s: la llamada se
 * cancelaba siempre, y mientras corría tenía las materializadas bloqueadas
 * (REFRESH toma ACCESS EXCLUSIVE) para luego deshacerse. Las refresca el cron
 * `clasificacion-mix-refresco` a los :20 como postgres, sin tope: este trabajo
 * corre a los :10 justo para eso, así que el reparto llega a las materializadas
 * diez minutos después, y a la vista en el momento.
 *
 * Entrada (POST, JSON, todo opcional):
 * - dry_run: true calcula y devuelve el resultado SIN escribir.
 *
 * Seguridad: verify_jwt activo (el cron llama con la anon key); escribe con la
 * service role. Sin parámetros que cambien QUÉ se reparte: los hechos mandan.
 */
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.57.0";
import { fetchTodas, toNum } from "../_shared/campanaEdge.ts";
import { registrarLatido } from "../_shared/latido.ts";
import { normalizarLoteCodigo } from "../_shared/loteCodigo.ts";
import {
  agruparLineasBoxPorLoteDia,
  lineaDesdeRow,
  type PasadaBoxLineaRow,
} from "../_shared/desgloseBox.ts";
import {
  calcularRepartoPasadas,
  esNombreCompuesto,
  type CapacidadLote,
  type DesgloseManual,
  type FilaReparto,
  type PasadaReparto,
  type PasadaSinRepartir,
} from "../_shared/calibradorReparto.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Sin tipos generados (patrón cierre-mensual): con Database = any las filas son
// `any`, que es lo que este código asume al mapearlas a mano.
// deno-lint-ignore no-explicit-any
type Db = SupabaseClient<any, "public", any>;

const TRABAJO = "reparto-pasadas";
const PAGINA = 1000;
/** Cuántos ids caben con holgura en un `.in()` de PostgREST (va en la URL). */
const LOTE_IN = 100;
/** Filas por upsert. */
const LOTE_UPSERT = 500;

/**
 * Espejo del filtro de la RPC calibrador_pasadas_con_desglose: un nombre "con
 * desglose" lleva box, PREC, reciclaje, un "+" o una fecha DD/MM. Se aplica a
 * los informes Word, que la RPC (solo volcado SQL) no cubre.
 */
const PATRON_DESGLOSE = /box|prec|recicl|\+|[0-9]{1,2}\/[0-9]{1,2}/i;
const RE_LOTE8 = /^\d{8}$/;

/**
 * Tolerancia para casar un desglose manual con su pasada cuando el mismo lote
 * pasó varias veces el mismo día: la fila de lotes_dia nace del propio informe,
 * así que su kg debe coincidir casi al gramo; 1 % (mínimo 50 kg) absorbe
 * redondeos sin confundir dos pasadas distintas.
 */
const TOLERANCIA_KG_MANUAL = (kg: number) => Math.max(50, kg * 0.01);

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/** La fecha de una pasada es la de su comienzo en hora de Madrid (misma regla que la vista). */
function fechaMadrid(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid" }).format(new Date(iso));
}

function trocear<T>(items: T[], tamano: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += tamano) out.push(items.slice(i, i + tamano));
  return out;
}

/** Una RPC que devuelve tabla, paginada: PostgREST recorta a 1.000 en silencio también en las RPC. */
async function rpcTodas<T>(db: Db, nombre: string, args: Record<string, unknown> = {}): Promise<T[]> {
  const out: T[] = [];
  for (let desde = 0; ; desde += PAGINA) {
    const { data, error } = await db.rpc(nombre, args).range(desde, desde + PAGINA - 1);
    if (error) throw new Error(`${nombre}: ${error.message}`);
    const filas = (data ?? []) as T[];
    out.push(...filas);
    if (filas.length < PAGINA) return out;
  }
}

// ─── Filas crudas que se leen ────────────────────────────────────────────────
interface BatchRow { batch_id: number; batch_name: string | null; lote: string; inicio: string | null }
interface PasadaRpcRow { batch_id: number; batch_name: string | null; lote: string; fecha: string; kg_total: number | string | null }
interface KgPorDiaRow { lote: string; dia: string }
interface InformeRow { batch_id: number | null; lote: string; fecha: string | null; comienzo: string; recibido_at: string | null }
interface KgRow { batch_id: number; peso_kg: number | string | null }
interface CapacidadRow { lote: string; kg_entrada: number | string | null; kg_atribuido_simple: number | string | null }
interface LoteDiaRow { id: string; lote_codigo: string | null; part_id: string; kg_peso_total: number | string | null }
interface ParteRow { id: string; date: string }
interface LoteClasifRow { fecha: string; lote_codigo: string | null }

/** Un informe Word que la vista usa (fresco), con sus kg ya sumados. */
interface InformeFresco { batch_id: number; nombre: string; base8: string | null; fecha: string; kg: number }

/** Suma de peso_kg por batch_id de un conjunto de ids (para lo que la RPC no trae). */
async function kgPorBatch(db: Db, ids: number[]): Promise<Map<number, number>> {
  const kg = new Map<number, number>();
  for (const grupo of trocear(ids, LOTE_IN)) {
    const filas = await fetchTodas<KgRow>((from, to) =>
      db.from("calibrador_clasificacion").select("batch_id, peso_kg").in("batch_id", grupo)
        // Orden por la clave primaria completa: sin él la paginación puede repetir o saltar filas.
        .order("batch_id").order("producto").order("calidad").order("clase").order("tamano").range(from, to)
    );
    for (const f of filas) kg.set(f.batch_id, (kg.get(f.batch_id) ?? 0) + toNum(f.peso_kg));
  }
  return kg;
}

/**
 * Los informes Word que la vista usa DE VERDAD. Misma regla de frescura que la
 * rama docx_inf de clasificacion_lote: fuera los que el volcado SQL ya cubre
 * (mismo lote-día con filas) y los que un Excel de parte ya cubre; y de los
 * repetidos por (código o nombre, fecha, comienzo) se queda el último recibido.
 */
async function cargarInformesFrescos(db: Db, sqlLoteDia: Set<string>): Promise<InformeFresco[]> {
  const [informes, filasKg] = await Promise.all([
    fetchTodas<InformeRow>((from, to) =>
      db.from("calibrador_informe").select("batch_id, lote, fecha, comienzo, recibido_at")
        .lt("batch_id", 0).order("lote").order("comienzo").range(from, to)
    ),
    fetchTodas<KgRow>((from, to) =>
      db.from("calibrador_clasificacion").select("batch_id, peso_kg").lt("batch_id", 0)
        .order("batch_id").order("producto").order("calidad").order("clase").order("tamano").range(from, to)
    ),
  ]);
  const kgPorInforme = new Map<number, number>();
  for (const f of filasKg) kgPorInforme.set(f.batch_id, (kgPorInforme.get(f.batch_id) ?? 0) + toNum(f.peso_kg));

  // Solo los que tienen filas de clasificación y fecha: el resto no entra en la vista.
  const conKg = informes.filter((i) => i.batch_id != null && i.fecha && (kgPorInforme.get(i.batch_id) ?? 0) > 0);

  // Frescura frente a los Excel de parte: solo se consulta lote_clasificacion
  // en las fechas que importan (cero filas en la era del Word, y así se queda
  // barato si algún día vuelven a convivir).
  const fechas = [...new Set(conKg.map((i) => i.fecha as string))];
  const parteLoteDia = new Set<string>();
  for (const grupo of trocear(fechas, LOTE_IN)) {
    const filas = await fetchTodas<LoteClasifRow>((from, to) =>
      db.from("lote_clasificacion").select("fecha, lote_codigo").in("fecha", grupo)
        .order("fecha").order("id").range(from, to)
    );
    for (const f of filas) {
      parteLoteDia.add(`${f.fecha}|${f.lote_codigo ?? ""}`);
      const base8 = normalizarLoteCodigo(f.lote_codigo);
      if (base8) parteLoteDia.add(`${f.fecha}|${base8}`);
    }
  }

  const porClave = new Map<string, InformeRow>();
  for (const i of conKg) {
    const fecha = i.fecha as string;
    const base8 = normalizarLoteCodigo(i.lote);
    if (sqlLoteDia.has(`${fecha}|${i.lote}`) || (base8 && sqlLoteDia.has(`${fecha}|${base8}`))) continue;
    if (parteLoteDia.has(`${fecha}|${i.lote}`) || (base8 && parteLoteDia.has(`${fecha}|${base8}`))) continue;
    const clave = `${base8 ?? i.lote.trim().toUpperCase()}|${fecha}|${i.comienzo}`;
    const previo = porClave.get(clave);
    if (!previo || String(i.recibido_at ?? "") > String(previo.recibido_at ?? "")) porClave.set(clave, i);
  }

  return [...porClave.values()].map((i) => ({
    batch_id: i.batch_id as number,
    nombre: i.lote,
    base8: normalizarLoteCodigo(i.lote),
    fecha: i.fecha as string,
    kg: kgPorInforme.get(i.batch_id as number) ?? 0,
  }));
}

/** Una pasada (SQL o Word) con lo que hace falta para casarle un desglose manual. */
interface PasadaCasable { batch_id: number; nombre: string; lote: string | null; fecha: string; kg: number | null }

/**
 * Casa cada desglose manual (pasada_box_lineas) con su pasada del calibrador:
 * mismo primer código de 8 dígitos y misma fecha. Si ese lote pasó varias veces
 * ese día, gana la pasada cuyo kg más se parece al de la fila de lotes_dia
 * (que nació del propio informe), dentro de la tolerancia; si ninguna se
 * parece, el desglose queda sin casar y se avisa en vez de adivinar.
 */
async function casarDesglosesManuales(
  db: Db,
  pasadas: PasadaCasable[],
): Promise<{ desgloses: DesgloseManual[]; sinCasar: string[] }> {
  const lineas = await fetchTodas<PasadaBoxLineaRow>((from, to) =>
    db.from("pasada_box_lineas")
      .select("id, user_id, lote_dia_id, posicion, tipo, lote_codigo, prec_fecha, box, box_tamano, nota")
      .order("lote_dia_id").order("posicion").range(from, to)
  );
  if (lineas.length === 0) return { desgloses: [], sinCasar: [] };
  const porLoteDia = agruparLineasBoxPorLoteDia(lineas);

  const lotesDia: LoteDiaRow[] = [];
  for (const grupo of trocear([...porLoteDia.keys()], LOTE_IN)) {
    const { data, error } = await db.from("lotes_dia").select("id, lote_codigo, part_id, kg_peso_total").in("id", grupo);
    if (error) throw new Error(`lotes_dia: ${error.message}`);
    lotesDia.push(...((data ?? []) as LoteDiaRow[]));
  }
  const fechaPorParte = new Map<string, string>();
  for (const grupo of trocear([...new Set(lotesDia.map((l) => l.part_id))], LOTE_IN)) {
    const { data, error } = await db.from("partes_diarios").select("id, date").in("id", grupo);
    if (error) throw new Error(`partes_diarios: ${error.message}`);
    for (const p of (data ?? []) as ParteRow[]) fechaPorParte.set(p.id, p.date);
  }

  const porClave = new Map<string, PasadaCasable[]>();
  for (const p of pasadas) {
    if (!p.lote) continue;
    const clave = `${p.fecha}|${p.lote}`;
    porClave.set(clave, [...(porClave.get(clave) ?? []), p]);
  }

  const desgloses: DesgloseManual[] = [];
  const sinCasar: string[] = [];
  for (const ld of lotesDia) {
    const filas = porLoteDia.get(ld.id) ?? [];
    const codigo = normalizarLoteCodigo(ld.lote_codigo);
    const fecha = fechaPorParte.get(ld.part_id);
    const etiqueta = `${ld.lote_codigo ?? "(sin nombre)"} (${fecha ?? "sin fecha"})`;
    if (!codigo || !fecha) { sinCasar.push(etiqueta); continue; }

    const candidatas = porClave.get(`${fecha}|${codigo}`) ?? [];
    let elegida: PasadaCasable | undefined;
    if (candidatas.length === 1) elegida = candidatas[0];
    else if (candidatas.length > 1) {
      const kgLd = toNum(ld.kg_peso_total);
      const cerca = candidatas
        .filter((c) => c.kg != null && Math.abs(c.kg - kgLd) <= TOLERANCIA_KG_MANUAL(kgLd))
        .sort((a, b) => Math.abs((a.kg ?? 0) - kgLd) - Math.abs((b.kg ?? 0) - kgLd));
      elegida = cerca[0];
    }
    if (!elegida) { sinCasar.push(etiqueta); continue; }
    desgloses.push({ batch_id: elegida.batch_id, lineas: filas.map(lineaDesdeRow) });
  }
  return { desgloses, sinCasar };
}

/** Qué cambió en las tablas en esta ejecución (0 en todo = la hora anterior ya lo dejó así). */
interface Cambios { nuevas: number; cambiadas: number; borradas: number; colaNuevas: number; colaCambiadas: number; colaBorradas: number }

/** Lo que se compara para decidir si una fila ya está como tiene que estar. `numeric` llega como texto. */
const huellaFila = (f: { fraccion: number | string; kg: number | string; metodo: string; orden: number | string }) =>
  `${Number(f.fraccion).toFixed(12)}|${Number(f.kg).toFixed(4)}|${f.metodo}|${Number(f.orden)}`;
const huellaCola = (s: { batch_name: string | null; fecha: string | null; kg_total: number | string | null; motivo: string | null }) =>
  `${s.batch_name ?? ""}|${s.fecha ?? ""}|${Number(s.kg_total ?? 0).toFixed(4)}|${s.motivo ?? ""}`;

/**
 * Escribe el resultado de forma idempotente: solo las filas nuevas o distintas
 * (upsert por clave) y borrado de lo que ya no sale. No reescribir lo que no
 * cambia deja `calculado_en` con sentido ("desde cuándo está así") y evita
 * remover la tabla cada hora para nada.
 */
async function persistir(db: Db, filas: FilaReparto[], sinRepartir: PasadaSinRepartir[]): Promise<Cambios> {
  const ahora = new Date().toISOString();
  const cambios: Cambios = { nuevas: 0, cambiadas: 0, borradas: 0, colaNuevas: 0, colaCambiadas: 0, colaBorradas: 0 };

  // ── calibrador_pasada_reparto ──
  const existentes = await fetchTodas<{ batch_id: number; lote8: string; fraccion: string; kg: string; metodo: string; orden: number }>((from, to) =>
    db.from("calibrador_pasada_reparto").select("batch_id, lote8, fraccion, kg, metodo, orden").order("batch_id").order("lote8").range(from, to)
  );
  const previas = new Map(existentes.map((e) => [`${e.batch_id}|${e.lote8}`, huellaFila(e)]));
  const aEscribir = filas.filter((f) => {
    const previa = previas.get(`${f.batch_id}|${f.lote8}`);
    if (previa === undefined) { cambios.nuevas += 1; return true; }
    if (previa !== huellaFila(f)) { cambios.cambiadas += 1; return true; }
    return false;
  });
  for (const grupo of trocear(aEscribir, LOTE_UPSERT)) {
    const { error } = await db.from("calibrador_pasada_reparto").upsert(
      grupo.map((f) => ({ ...f, calculado_en: ahora })),
      { onConflict: "batch_id,lote8" },
    );
    if (error) throw new Error(`upsert calibrador_pasada_reparto: ${error.message}`);
  }
  const vigentes = new Set(filas.map((f) => `${f.batch_id}|${f.lote8}`));
  const sobrantes = new Map<number, string[]>();
  for (const e of existentes) {
    if (vigentes.has(`${e.batch_id}|${e.lote8}`)) continue;
    sobrantes.set(e.batch_id, [...(sobrantes.get(e.batch_id) ?? []), e.lote8]);
    cambios.borradas += 1;
  }
  for (const [batch_id, lotes] of sobrantes) {
    const { error } = await db.from("calibrador_pasada_reparto").delete().eq("batch_id", batch_id).in("lote8", lotes);
    if (error) throw new Error(`delete calibrador_pasada_reparto: ${error.message}`);
  }

  // ── calibrador_pasada_sin_repartir ──
  const enCola = await fetchTodas<{ batch_id: number; batch_name: string | null; fecha: string | null; kg_total: string | null; motivo: string | null }>((from, to) =>
    db.from("calibrador_pasada_sin_repartir").select("batch_id, batch_name, fecha, kg_total, motivo").order("batch_id").range(from, to)
  );
  const colaPrevia = new Map(enCola.map((e) => [e.batch_id, huellaCola(e)]));
  const colaAEscribir = sinRepartir.filter((s) => {
    const previa = colaPrevia.get(s.batch_id);
    if (previa === undefined) { cambios.colaNuevas += 1; return true; }
    if (previa !== huellaCola(s)) { cambios.colaCambiadas += 1; return true; }
    return false;
  });
  for (const grupo of trocear(colaAEscribir, LOTE_UPSERT)) {
    const { error } = await db.from("calibrador_pasada_sin_repartir").upsert(
      grupo.map((s) => ({ ...s, calculado_en: ahora })),
      { onConflict: "batch_id" },
    );
    if (error) throw new Error(`upsert calibrador_pasada_sin_repartir: ${error.message}`);
  }
  const colaVigente = new Set(sinRepartir.map((s) => s.batch_id));
  const fueraDeCola = enCola.map((e) => e.batch_id).filter((id) => !colaVigente.has(id));
  cambios.colaBorradas = fueraDeCola.length;
  for (const grupo of trocear(fueraDeCola, LOTE_IN)) {
    const { error } = await db.from("calibrador_pasada_sin_repartir").delete().in("batch_id", grupo);
    if (error) throw new Error(`delete calibrador_pasada_sin_repartir: ${error.message}`);
  }
  return cambios;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = (await req.json().catch(() => ({}))) as { dry_run?: boolean };
    const dryRun = body.dry_run === true;
    const db: Db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const inicio = new Date();

    // ── 1. Hechos ─────────────────────────────────────────────────────────────
    const [pasadasRpc, batches, kgPorDia, capacidadRpc] = await Promise.all([
      rpcTodas<PasadaRpcRow>(db, "calibrador_pasadas_con_desglose"),
      fetchTodas<BatchRow>((from, to) =>
        db.from("calibrador_batch").select("batch_id, batch_name, lote, inicio").order("batch_id").range(from, to)
      ),
      // Los lote-día que el volcado SQL cubre con filas: es lo que decide qué
      // informe Word está superado (misma regla que la vista).
      rpcTodas<KgPorDiaRow>(db, "calibrador_kg_por_pasada"),
      rpcTodas<CapacidadRow>(db, "calibrador_capacidad_lotes"),
    ]);

    const sqlLoteDia = new Set<string>();
    for (const f of kgPorDia) {
      sqlLoteDia.add(`${f.dia}|${f.lote}`);
      const base8 = normalizarLoteCodigo(f.lote);
      if (base8) sqlLoteDia.add(`${f.dia}|${base8}`);
    }
    const informes = await cargarInformesFrescos(db, sqlLoteDia);

    // Las pasadas candidatas: las de la RPC (volcado SQL) más los informes Word
    // frescos con nombre compuesto o con desglose.
    const pasadas = new Map<number, PasadaReparto>();
    for (const p of pasadasRpc) {
      pasadas.set(p.batch_id, {
        batch_id: p.batch_id, batch_name: p.batch_name ?? p.lote, lote: p.lote, fecha: p.fecha, kg_total: toNum(p.kg_total),
      });
    }
    for (const i of informes) {
      if (!i.base8) continue;                                  // sin código receptor no hay reparto posible
      if (!esNombreCompuesto(i.nombre) && !PATRON_DESGLOSE.test(i.nombre)) continue;
      pasadas.set(i.batch_id, { batch_id: i.batch_id, batch_name: i.nombre, lote: i.base8, fecha: i.fecha, kg_total: i.kg });
    }

    // Capacidad: la RPC solo cuenta como "simple" lo del volcado SQL. En la era
    // del Word (desde agosto de 2026 todo llega así) las pasadas simples del
    // Word no restan pendiente, y un lote parecería tener hueco que ya gastó.
    // Se completa aquí con el MISMO criterio que la RPC (compuesto = dos
    // códigos en el nombre; lo demás es simple).
    const capacidad = new Map<string, CapacidadLote>();
    for (const c of capacidadRpc) {
      capacidad.set(c.lote, { kgEntrada: toNum(c.kg_entrada), kgAtribuidoSimple: toNum(c.kg_atribuido_simple) });
    }
    let kgDocxSimple = 0;
    for (const i of informes) {
      if (!i.base8 || esNombreCompuesto(i.nombre)) continue;
      const c = capacidad.get(i.base8);
      if (!c) continue;                                        // sin entrada de báscula: no absorbe nada de todos modos
      c.kgAtribuidoSimple += i.kg;
      kgDocxSimple += i.kg;
    }

    // Desgloses manuales, casados con su pasada. Una pasada con desglose que no
    // fuera candidata (nombre "simple" al que una persona añadió otro lote)
    // también entra: la decisión humana manda.
    const casables: PasadaCasable[] = [
      ...batches.filter((b) => b.inicio).map((b) => ({
        batch_id: b.batch_id, nombre: b.batch_name ?? b.lote, lote: RE_LOTE8.test(b.lote) ? b.lote : normalizarLoteCodigo(b.batch_name),
        fecha: fechaMadrid(b.inicio as string), kg: pasadas.get(b.batch_id)?.kg_total ?? null,
      })),
      ...informes.map((i) => ({ batch_id: i.batch_id, nombre: i.nombre, lote: i.base8, fecha: i.fecha, kg: i.kg })),
    ];
    const { desgloses, sinCasar } = await casarDesglosesManuales(db, casables);
    const faltanKg = desgloses.map((d) => d.batch_id).filter((id) => id > 0 && !pasadas.has(id));
    if (faltanKg.length > 0) {
      const kg = await kgPorBatch(db, faltanKg);
      for (const b of batches) {
        if (!faltanKg.includes(b.batch_id) || !b.inicio) continue;
        const lote = RE_LOTE8.test(b.lote) ? b.lote : normalizarLoteCodigo(b.batch_name);
        if (!lote) continue;
        pasadas.set(b.batch_id, {
          batch_id: b.batch_id, batch_name: b.batch_name ?? b.lote, lote, fecha: fechaMadrid(b.inicio), kg_total: kg.get(b.batch_id) ?? 0,
        });
      }
    }
    for (const d of desgloses) {
      const i = informes.find((x) => x.batch_id === d.batch_id);
      if (i && i.base8 && !pasadas.has(d.batch_id)) {
        pasadas.set(i.batch_id, { batch_id: i.batch_id, batch_name: i.nombre, lote: i.base8, fecha: i.fecha, kg_total: i.kg });
      }
    }

    // ── 2. Decisión (lib pura, testeada) ─────────────────────────────────────
    const resultado = calcularRepartoPasadas({ pasadas: [...pasadas.values()], capacidad, desglosesManuales: desgloses });

    // ── 3. Persistencia (las materializadas las refresca el cron de las :20, ver cabecera) ──
    const cambios = dryRun ? null : await persistir(db, resultado.filas, resultado.sinRepartir);
    const nCambios = cambios ? Object.values(cambios).reduce((s, n) => s + n, 0) : 0;

    // ── 4. Rastro ────────────────────────────────────────────────────────────
    const { repartidas, kgMovidos, enCola } = resultado.resumen;
    const nRepartidas = repartidas.manual + repartidas.box + repartidas.capacidad;
    const avisos: string[] = [];
    if (sinCasar.length > 0) avisos.push(`${sinCasar.length} desglose(s) manual(es) sin pasada que casar: ${sinCasar.slice(0, 3).join("; ")}`);
    const estado = avisos.length > 0 ? "aviso" : "ok";
    const detalle =
      `${nRepartidas} pasada(s) repartida(s) (manual ${repartidas.manual}, box ${repartidas.box}, capacidad ${repartidas.capacidad}), ` +
      `${Math.round(kgMovidos).toLocaleString("es-ES")} kg movidos del primer codigo a otros lotes, ${enCola} en cola` +
      (dryRun ? " (simulacion, sin escribir)" : nCambios === 0 ? " · sin cambios desde la ultima vez" : ` · ${nCambios} fila(s) nuevas, cambiadas o borradas`) +
      (avisos.length > 0 ? ` · ${avisos.join(" · ")}` : "");

    if (!dryRun) {
      const { error: errReg } = await db.from("sistema_ejecuciones").insert({
        trabajo: TRABAJO,
        inicio: inicio.toISOString(),
        fin: new Date().toISOString(),
        estado,
        detalle,
        equipo: "supabase-edge",
        datos: {
          candidatas: resultado.resumen.pasadas,
          repartidas,
          kg_movidos: Math.round(kgMovidos),
          en_cola: enCola,
          informes_docx_frescos: informes.length,
          kg_docx_simple_en_capacidad: Math.round(kgDocxSimple),
          desgloses_manuales: desgloses.length,
          desgloses_sin_casar: sinCasar,
          cambios,
        },
      });
      if (errReg) console.error(`[${TRABAJO}] no se pudo registrar la ejecución: ${errReg.message}`);
      await registrarLatido(db, TRABAJO, estado, detalle);
    }

    console.log(`[${TRABAJO}] ${detalle} (${Date.now() - inicio.getTime()} ms)`);
    return json({
      dry_run: dryRun,
      candidatas: resultado.resumen.pasadas,
      repartidas,
      kg_movidos: Math.round(kgMovidos * 100) / 100,
      en_cola: enCola,
      filas: resultado.filas.length,
      cola: resultado.sinRepartir.map((s) => ({ batch_id: s.batch_id, batch_name: s.batch_name, fecha: s.fecha, kg_total: s.kg_total, motivo: s.motivo })),
      desgloses_manuales: desgloses.length,
      desgloses_sin_casar: sinCasar,
      informes_docx_frescos: informes.length,
      kg_docx_simple_en_capacidad: Math.round(kgDocxSimple),
      cambios,
      materializadas: "las refresca el cron clasificacion-mix-refresco (a los :20, como postgres)",
      detalle,
      duracion_ms: Date.now() - inicio.getTime(),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[${TRABAJO}] error: ${msg}`);
    // Latido de error también aquí: un reparto que muere en silencio deja la
    // vista con el último cálculo bueno, pero nadie sabría que se ha parado.
    try {
      const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
      await registrarLatido(db, TRABAJO, "error", msg);
    } catch { /* best-effort */ }
    return json({ error: "No se pudo calcular el reparto de pasadas.", detalle: msg }, 500);
  }
});
