/**
 * cicloVidaLote.cinturonYTirantes.test.ts — FASE 3b de la refundación de
 * trazabilidad (ver docs/TRAZABILIDAD_REFUNDACION.md): prueba de intersección
 * de AMBOS motores sobre el banco dorado (src/lib/__fixtures__/campana2026/).
 *
 * Decisión de diseño central del encargo (no negociable): un lote solo es
 * candidato a cierre automático (normal o compuesto) si el motor VIEJO
 * (esCandidatoCierreAutomatico/esCandidatoCierreCompuesto, entradasBascula.ts)
 * Y el motor NUEVO (cicloVidaLote.ts: estado "completo_pendiente_cierre")
 * están de acuerdo. `aplicarCinturonYTirantes` (cicloVidaLoteAdapter.ts) es
 * la función real que aplica esa intersección — la MISMA que usa
 * useEntradasBascula.ts, no una reimplementación para el test.
 *
 * HALLAZGO EMPÍRICO (documentado explícitamente, no maquillado): sobre el
 * banco dorado, a HOY = "2026-08-04" (fecha del propio snapshot),
 * `esCandidatoCierreAutomatico`/`esCandidatoCierreCompuesto` (el motor viejo)
 * NO devuelven NINGÚN candidato real hoy mismo — así que la intersección
 * literal de "candidatos actuales" está vacía (ver el primer test). Esto NO
 * significa que el cinturón sea un no-op: existe un patrón real de 19 lotes
 * en el propio banco (`kg_ajuste_stock` sembrado EXACTAMENTE igual a
 * `kg_entrada`, CERO pasadas de calibrador) donde el motor viejo SÍ marca
 * `completoConEvidencia=true` — y hoy no llegan a ser "candidatos" solo
 * porque `esCandidatoCierreAutomatico` exige además una `ultima_fecha_procesado`
 * no nula (una guarda YA existente, pensada para otra cosa: "sin fecha no se
 * puede demostrar inactividad reciente"). El segundo test demuestra, con
 * datos REALES del banco (no fabricados), que si esa guarda no existiera —o
 * si algún día cambia la forma de sembrar datos y esos 19 lotes consiguen una
 * fecha— el CINTURÓN los vetaría en el acto: es la razón de ser de esta
 * fase, cinturón Y tirantes, cada red de seguridad cubre a la otra.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  construirEventosLote,
  type EntradaBasculaEventoInput,
} from "@/lib/eventosLote";
import { derivarCicloVidaLote, type LoteCiclo } from "@/lib/cicloVidaLote";
import {
  capacidadFraccionEstimada,
  conciliarKgProcesados,
  detectarLotesEnPasadaCompuesta,
  type EntradaConciliacion,
  type PasadaConciliacion,
} from "@/lib/conciliacionKg";
import { codigosEnCamaraExterna, type CamionCamaraExterna, type SenalesRecepcion } from "@/lib/camarasExternas";
import { normalizarLoteCodigo } from "@/lib/loteCodigo";
import {
  buildStockEntradas,
  esCandidatoCierreAutomatico,
  esCandidatoCierreCompuesto,
} from "@/lib/entradasBascula";
import { esEntradaCampoCit } from "@/lib/productoresCanonicos";
import { aplicarCinturonYTirantes, motivoDiscrepancia } from "@/lib/cicloVidaLoteAdapter";

// ─── Carga del banco dorado (mismo patrón que cicloVidaLote.golden.test.ts) ─
const dir = path.join(__dirname, "__fixtures__/campana2026");
function cargar<T>(nombre: string): T {
  return JSON.parse(fs.readFileSync(path.join(dir, nombre), "utf8")) as T;
}

interface EntradaFixture {
  lote: string;
  fecha: string;
  agricultor: string | null;
  finca: string | null;
  articulo: string | null;
  kg_entrada: number;
  kg_ajuste_stock: number;
  merma_camara_kg: number | null;
  cerrado_at: string | null;
  cierre_modo: "con_analisis" | "sin_registro" | null;
}
interface PasadaFixture {
  lote_codigo: string | null;
  kg_peso_total: number;
  part_id: string;
}
interface ParteFixture {
  id: string;
  date: string;
  kg_reciclado_malla_z1: number;
  kg_reciclado_malla_z2: number;
  box_reciclaje: number | null;
}

const entradasFixture = cargar<EntradaFixture[]>("entradas_bascula.json");
const pasadasFixture = cargar<PasadaFixture[]>("pasadas_calibrador.json");
const partesFixture = cargar<ParteFixture[]>("partes_diarios.json");
const camaraExternaFixture = cargar<CamionCamaraExterna[]>("camara_externa_camiones.json");

const HOY = "2026-08-04"; // misma fecha que el resto del banco dorado (snapshot)

const partePorId = new Map(partesFixture.map((p) => [p.id, p]));
const pasadas: PasadaConciliacion[] = pasadasFixture.map((p) => ({
  lote_codigo: p.lote_codigo,
  kg_peso_total: p.kg_peso_total,
  date: partePorId.get(p.part_id)?.date ?? null,
}));
const reciclajePorDia = partesFixture
  .map((p) => ({
    fecha: p.date,
    kgBruto: (Number(p.kg_reciclado_malla_z1) || 0) + (Number(p.kg_reciclado_malla_z2) || 0),
    nBox: Number(p.box_reciclaje) || 0,
  }))
  .filter((r) => r.kgBruto > 0);

/** Misma detección de PRECALIBRADO que el resto del banco dorado (el fixture no trae más columnas que agricultor/finca). */
function esPrecalibrado(e: EntradaFixture): boolean {
  return /LASARTE ALMACEN PRECALIBRADO/i.test(e.agricultor ?? "") || /PREC\s*\d+\s*ALMACEN/i.test(e.finca ?? "");
}

const entradasEvento: EntradaBasculaEventoInput[] = entradasFixture.map((e) => ({
  lote: e.lote,
  fecha: e.fecha,
  kg_entrada: e.kg_entrada,
  finca: e.finca,
  articulo: e.articulo,
  agricultor: e.agricultor,
  kg_ajuste_stock: e.kg_ajuste_stock,
  merma_camara_kg: e.merma_camara_kg,
  cerrado_at: e.cerrado_at,
  cierre_modo: e.cierre_modo,
}));

const entradasConciliacion: EntradaConciliacion[] = entradasFixture.map((e) => ({
  lote: e.lote,
  fecha: e.fecha,
  finca: e.finca,
  articulo: e.articulo,
  kg_entrada: e.kg_entrada,
  kg_preasignado: Math.max(0, Number(e.kg_ajuste_stock) || 0),
  esPrecalibrado: esPrecalibrado(e),
  cerrado: Boolean(e.cerrado_at),
  kg_merma_camara: e.merma_camara_kg,
}));

const senalesCamaraExterna: SenalesRecepcion = {
  salidaPorLote: new Map(),
  lotesProcesados: new Set(
    pasadas.flatMap((p) => (String(p.lote_codigo ?? "").match(/\d{8}/g) ?? []).map((c) => normalizarLoteCodigo(c)!)),
  ),
};
const lotesConfirmadosEnCamara = codigosEnCamaraExterna(camaraExternaFixture, senalesCamaraExterna, HOY);

// ─── Motor NUEVO: exactamente igual que cicloVidaLote.golden.test.ts ───────
const eventos = construirEventosLote({
  entradas: entradasEvento,
  entradasConciliacion,
  pasadas,
  reciclajePorDia,
  lotesConfirmadosEnCamara,
  camionesCamaraExterna: camaraExternaFixture,
  senalesCamaraExterna,
  hoy: HOY,
});
const ciclo = derivarCicloVidaLote(eventos, HOY);
const cicloPorLote = new Map<string, LoteCiclo>(ciclo.map((c) => [c.lote, c]));

// ─── Motor VIEJO: exactamente igual que useEntradasBascula.ts ───────────────
// (buildStockEntradas SOLO recibe entradas REALES — ni precalibrado ni
// CAMPO/CIT, igual que useEntradasBascula.ts separa `entradas` de
// `entradasPrecalibrado`/`derivadosCampoCit` antes de construir el stock).
const entradasRealesFixture = entradasFixture.filter(
  (e) => !esPrecalibrado(e) && !esEntradaCampoCit({ articulo: e.articulo }),
);
const conciliacionViejo = conciliarKgProcesados(entradasConciliacion, pasadas, reciclajePorDia, lotesConfirmadosEnCamara);
const lotesEnPasadaCompuesta = detectarLotesEnPasadaCompuesta(pasadas);
const kgDerramePorLote = new Map<string, number>();
for (const m of conciliacionViejo.movimientos) {
  if (m.motivo !== "exceso_misma_finca" && m.motivo !== "exceso_misma_variedad") continue;
  const clave = normalizarLoteCodigo(m.a) ?? m.a;
  kgDerramePorLote.set(clave, (kgDerramePorLote.get(clave) ?? 0) + (Number(m.kg) || 0));
}
const stockViejo = buildStockEntradas(
  entradasRealesFixture.map((e) => ({
    lote: e.lote,
    fecha: e.fecha,
    kg_entrada: e.kg_entrada,
    kg_ajuste_stock: e.kg_ajuste_stock,
    finca: e.finca,
    articulo: e.articulo,
    agricultor: e.agricultor,
    cerrado_at: e.cerrado_at,
    cierre_modo: e.cierre_modo,
  })),
  conciliacionViejo.procesados,
  HOY,
  lotesEnPasadaCompuesta,
  capacidadFraccionEstimada,
  lotesConfirmadosEnCamara,
  undefined, // confirmación FÍSICA: el snapshot es anterior a esa señal (ver golden test)
  kgDerramePorLote,
);

const candidatosCierreAutomaticoDelViejo = stockViejo.filas
  .filter((f) => esCandidatoCierreAutomatico(f, HOY))
  .map((f) => ({ lote: f.lote }));
const candidatosCierreCompuestoDelViejo = stockViejo.filas
  .filter((f) => esCandidatoCierreCompuesto(f, HOY))
  .map((f) => ({ lote: f.lote }));

describe("cinturón y tirantes — intersección de los dos motores sobre el banco dorado", () => {
  it("HOY del snapshot (2026-08-04): el motor viejo no tiene NINGÚN candidato real vivo, así que la intersección literal está vacía", () => {
    // Hallazgo explícito, no un umbral: a esta fecha exacta, tras excluir
    // precalibrado/CAMPO-CIT (igual que useEntradasBascula.ts), NINGÚN lote
    // real activo cumple a la vez completoConEvidencia=true Y tiene una
    // ultima_fecha_procesado con ≥2 días de antigüedad (DIAS_SIN_ACTIVIDAD_AUTOCIERRE).
    // No es un fallo del cinturón: es que hoy no hay nada que cerrar todavía.
    expect(candidatosCierreAutomaticoDelViejo).toEqual([]);
    expect(candidatosCierreCompuestoDelViejo).toEqual([]);

    const completo = aplicarCinturonYTirantes(candidatosCierreAutomaticoDelViejo, "completo", cicloPorLote);
    const compuesto = aplicarCinturonYTirantes(candidatosCierreCompuestoDelViejo, "compuesto", cicloPorLote);
    expect(completo.confirmados).toEqual([]);
    expect(completo.discrepancias).toEqual([]);
    expect(compuesto.confirmados).toEqual([]);
    expect(compuesto.discrepancias).toEqual([]);
  });

  /**
   * Universo REAL (sin exigir la guarda de fecha de esCandidatoCierreAutomatico)
   * de lotes donde el motor viejo (`completoConEvidencia`) dice "completo" pero
   * el motor nuevo NO lo ve resuelto. Es la lista literal que demuestra que el
   * cinturón funciona de verdad — 19 lotes REALES del banco, TODOS con el
   * mismo patrón verificado a mano: `kg_ajuste_stock` sembrado EXACTAMENTE
   * igual a `kg_entrada` (0 pasadas de calibrador, ver pasadas_calibrador.json)
   * — el motor viejo lo toma como "100% procesado" sin más, mientras el motor
   * nuevo aplica la REGLA DE ORO ("medido" solo, sin ninguna mención NOMBRADA
   * ni ANOTADA, nunca completa) y los deja en "sin_rastro". Hoy estos 19 no
   * llegan a candidatos reales SOLO porque les falta una `ultima_fecha_procesado`
   * (no tienen ninguna pasada) — la MISMA guarda que ya usa
   * esCandidatoCierreAutomatico por otro motivo. El cinturón es la red de
   * seguridad para el día en que ese patrón de siembra cambie y esos lotes sí
   * consigan una fecha: sin él, se cerrarían solos con 0% de evidencia real.
   */
  it("19 lotes reales con completoConEvidencia=true pero sin NINGUNA pasada de calibrador: el cinturón los vetaría a todos con la misma razón (regla de oro)", () => {
    const LOTES_SEMBRADOS_SIN_PASADA = [
      "26062501", "26062401", "26061902", "26061202", "26061102", "26060404",
      "26052905", "26052802", "26052702", "26051110", "26050708", "26050709",
      "26050612", "26050406", "26050301", "26042807", "26042707", "26042406",
      "26041801",
    ];

    // Verificación 1: es EXACTAMENTE el universo real (completoConEvidencia,
    // sin cerrar, sin señal de cámara vigente, que el motor nuevo NO confirma),
    // sin exigir la guarda de fecha — para que quede explícito que la lista de
    // arriba no es arbitraria, es el resultado de recorrer el banco.
    const universoReal = stockViejo.filas
      .filter((f) => f.completoConEvidencia && !f.cerrado_at && !f.enCamaraConfirmada)
      .filter((f) => {
        const c = cicloPorLote.get(f.lote);
        return c?.estado !== "completo_pendiente_cierre" && c?.estado !== "cerrado";
      })
      .map((f) => f.lote)
      .sort();
    expect(universoReal).toEqual([...LOTES_SEMBRADOS_SIN_PASADA].sort());

    // Verificación 2: TODOS, en efecto, son "kg_ajuste_stock == kg_entrada,
    // cero pasadas" — el patrón de siembra exacto que motiva el cinturón.
    const entradaPorLote = new Map(entradasFixture.map((e) => [e.lote, e]));
    const pasadasPorLote = new Set(
      pasadasFixture.flatMap((p) => (String(p.lote_codigo ?? "").match(/\d{8}/g) ?? []).map((c) => normalizarLoteCodigo(c)!)),
    );
    for (const lote of LOTES_SEMBRADOS_SIN_PASADA) {
      const e = entradaPorLote.get(lote)!;
      expect(e.kg_ajuste_stock, `${lote}: kg_ajuste_stock debería igualar kg_entrada`).toBe(e.kg_entrada);
      expect(pasadasPorLote.has(lote), `${lote}: no debería tener ninguna pasada de calibrador`).toBe(false);
    }

    // Verificación 3 (la prueba central): aplicando el CINTURÓN REAL
    // (aplicarCinturonYTirantes, la misma función que usa useEntradasBascula.ts)
    // a estos 19 como si fueran candidatos del motor viejo, TODOS quedan
    // vetados — ninguno se cuela como "confirmado" — y cada uno lleva la razón
    // textual del motor nuevo.
    const candidatosSimulados = LOTES_SEMBRADOS_SIN_PASADA.map((lote) => ({ lote }));
    const { confirmados, discrepancias } = aplicarCinturonYTirantes(candidatosSimulados, "completo", cicloPorLote);
    expect(confirmados).toEqual([]);
    expect(discrepancias).toHaveLength(LOTES_SEMBRADOS_SIN_PASADA.length);

    const RAZON_REGLA_DE_ORO = "no hay ninguna mención NOMBRADA ni ANOTADA de este lote en los partes — la regla de oro no deja que solo lo medido o el derrame completen o cierren un lote";
    for (const d of discrepancias) {
      expect(LOTES_SEMBRADOS_SIN_PASADA, `${d.lote} inesperado en las discrepancias`).toContain(d.lote);
      expect(d.tipo).toBe("completo");
      expect(d.estadoNuevo).toBe("sin_rastro");
      expect(d.razon).toBe(RAZON_REGLA_DE_ORO);
      // La razón expuesta por el cinturón es la MISMA que produce motivoDiscrepancia
      // directamente sobre el ciclo real del lote — no una redacción paralela.
      expect(d.razon).toBe(motivoDiscrepancia(cicloPorLote.get(d.lote)!));
    }
  });

  it("invariante: la intersección nunca amplía candidatos — confirmados siempre ⊆ candidatos del motor viejo", () => {
    const candidatosGrandes = stockViejo.filas.map((f) => ({ lote: f.lote }));
    const { confirmados } = aplicarCinturonYTirantes(candidatosGrandes, "completo", cicloPorLote);
    const loteSet = new Set(candidatosGrandes.map((c) => c.lote));
    for (const c of confirmados) expect(loteSet.has(c.lote)).toBe(true);
    // Y todo confirmado tiene, en efecto, el estado nuevo "completo_pendiente_cierre".
    for (const c of confirmados) expect(cicloPorLote.get(c.lote)?.estado).toBe("completo_pendiente_cierre");
  });
});
