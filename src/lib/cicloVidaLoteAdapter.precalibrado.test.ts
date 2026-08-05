/**
 * cicloVidaLoteAdapter.precalibrado.test.ts — TAREA 0 (hueco documentado de
 * la 3b, ver docs/TRAZABILIDAD_REFUNDACION.md): el cinturón y tirantes
 * (`aplicarCinturonYTirantes`) cubría los candidatos "completo" y "compuesto"
 * pero NO el TERCER origen del auto-cierre — los candidatos de PRECALIBRADO
 * (`stockPrecalibrado.candidatosCierre`, buildStockPrecalibrado en
 * stockPrecalibrado.ts, consumidos en EntradasBascula.tsx y metidos en el
 * mismo cerrarLotesEnBloque, ver useEntradasBascula.ts).
 *
 * CASO REAL que motivó la tarea (banco dorado, src/lib/__fixtures__/
 * campana2026/): el barrido automático del 04-08-2026 a las 07:28:16 cerró 5
 * re-entradas PREC (cierre_modo "sin_registro") SIN ninguna indicación real
 * en los informes — el fixture ya las trae con `cerrado_at` puesto (ver
 * PREC_SIN_INDICACION_A_CERRADO en cicloVidaLote.golden.test.ts, PATRÓN 2).
 * Este test reconstruye el estado ANTERIOR a ese cierre (cerrado_at/cierre_modo
 * a null SOLO para esos 5 códigos, el resto del banco intacto) para comprobar
 * que, si el cinturón hubiera estado activo ANTES del barrido, habría vetado
 * los 5 en vez de dejarlos pasar.
 *
 * QUÉ EVIDENCIA TENÍAN REALMENTE (verificado contra pasadas_calibrador.json):
 * los 5 códigos SÍ aparecen como código NO-primero de una pasada COMPUESTA
 * del calibrador (p.ej. "26030606-26022409-26030507- 26032309") — evidencia
 * TEXTUAL (mención) pero SIN kg cuantificable bajo su propio código (el
 * reparto por capacidad lo agota en los códigos anteriores). El motor VIEJO
 * (buildStockPrecalibrado, vía `huerfanosCompuesta`/detectarLotesEnPasadaCompuesta)
 * toma esa mención como "consumido" (motivo "compuesto") y los da por
 * cerrables sin más. El motor NUEVO (cicloVidaLote.ts) SÍ registra la mención
 * (evento `pasada_nombrada` con kg:null, ver eventosLote.ts) pero, al no
 * haber ningún kg cuantificable ni cierre_manual todavía, el lote se queda en
 * "sin_rastro" — ni "completo_pendiente_cierre" ni "cerrado" — así que el
 * cinturón (esCandidatoSegunMotorNuevo) lo veta: exactamente el
 * comportamiento que habría evitado el cierre indebido del 04-08.
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
  conciliarKgProcesados,
  detectarLotesEnPasadaCompuesta,
  type EntradaConciliacion,
  type PasadaConciliacion,
} from "@/lib/conciliacionKg";
import { codigosEnCamaraExterna, type CamionCamaraExterna, type SenalesRecepcion } from "@/lib/camarasExternas";
import { normalizarLoteCodigo } from "@/lib/loteCodigo";
import { buildStockPrecalibrado } from "@/lib/stockPrecalibrado";
import { aplicarCinturonYTirantes, motivoDiscrepancia } from "@/lib/cicloVidaLoteAdapter";

// ─── Carga del banco dorado (mismo patrón que cicloVidaLote.cinturonYTirantes.test.ts) ─
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

const entradasFixtureCruda = cargar<EntradaFixture[]>("entradas_bascula.json");
const pasadasFixture = cargar<PasadaFixture[]>("pasadas_calibrador.json");
const partesFixture = cargar<ParteFixture[]>("partes_diarios.json");
const camaraExternaFixture = cargar<CamionCamaraExterna[]>("camara_externa_camiones.json");

const HOY = "2026-08-04"; // misma fecha que el resto del banco dorado (snapshot)

/**
 * Los 5 códigos reales cerrados en bloque el 04-08 a las 07:28:16 sin
 * ninguna indicación real (ver cabecera del archivo y cicloVidaLote.golden.test.ts,
 * PREC_SIN_INDICACION_A_CERRADO).
 */
const PREC_SIN_INDICACION = ["26030507", "26031908", "26032309", "26070801", "26070802"];

// Reconstruye el estado ANTERIOR al barrido: cerrado_at/cierre_modo a null
// SOLO para los 5 códigos del caso — el resto del banco (incluidos otros
// cierres legítimos ajenos a este bug) se deja intacto para no falsear el
// resto de la campaña.
const entradasFixture: EntradaFixture[] = entradasFixtureCruda.map((e) =>
  PREC_SIN_INDICACION.includes(e.lote) ? { ...e, cerrado_at: null, cierre_modo: null } : e,
);

/** Misma detección de PRECALIBRADO que el resto del banco dorado (el fixture no trae más columnas que agricultor/finca). */
function esPrecalibrado(e: EntradaFixture): boolean {
  return /LASARTE ALMACEN PRECALIBRADO/i.test(e.agricultor ?? "") || /PREC\s*\d+\s*ALMACEN/i.test(e.finca ?? "");
}

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

// ─── Motor NUEVO: mismo patrón que cicloVidaLote.cinturonYTirantes.test.ts ──
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

// ─── Motor VIEJO — PRECALIBRADO: mismo cálculo que useEntradasBascula.ts ────
const conciliacionViejo = conciliarKgProcesados(entradasConciliacion, pasadas, reciclajePorDia, lotesConfirmadosEnCamara);
const lotesEnPasadaCompuesta = detectarLotesEnPasadaCompuesta(pasadas);
const entradasPrecalibradoFixture = entradasFixture.filter(esPrecalibrado);
const stockPrecalibrado = buildStockPrecalibrado(
  entradasPrecalibradoFixture.map((e, i) => ({
    lote: e.lote,
    fecha: e.fecha,
    finca: e.finca,
    kg_entrada: e.kg_entrada,
    id: `prec-${i}`, // el fixture no trae id real (no hace falta para este cálculo)
    cerrado_at: e.cerrado_at,
  })),
  conciliacionViejo.procesados,
  HOY,
  lotesEnPasadaCompuesta,
);

describe("cinturón y tirantes — TERCER origen (PRECALIBRADO, TAREA 0)", () => {
  it("evidencia real: los 5 códigos del caso aparecen SOLO como mención en pasada compuesta, sin kg propio", () => {
    for (const codigo of PREC_SIN_INDICACION) {
      const evidencia = lotesEnPasadaCompuesta.get(codigo);
      expect(evidencia, `${codigo}: debería tener evidencia de pasada compuesta`).toBeDefined();
    }
  });

  it("el motor VIEJO (buildStockPrecalibrado) SÍ los da por candidatos a cierre automático (motivo 'compuesto') — así ocurrió el 04-08", () => {
    const candidatosPorLote = new Map(stockPrecalibrado.candidatosCierre.map((c) => [c.lote, c]));
    for (const codigo of PREC_SIN_INDICACION) {
      const candidato = candidatosPorLote.get(codigo);
      expect(candidato, `${codigo}: el motor viejo debería marcarlo candidato`).toBeDefined();
      expect(candidato!.motivo).toBe("compuesto");
    }
  });

  it("el motor NUEVO NO los ve resueltos (ni 'completo_pendiente_cierre' ni 'cerrado') porque la mención no trae kg cuantificable", () => {
    for (const codigo of PREC_SIN_INDICACION) {
      const c = cicloPorLote.get(codigo);
      expect(c, `${codigo}: debería existir en el motor nuevo`).toBeDefined();
      expect(c!.estado).not.toBe("completo_pendiente_cierre");
      expect(c!.estado).not.toBe("cerrado");
      // Documentado explícitamente (no maquillado): sin cierre_manual todavía
      // y con la mención como único rastro, el motor nuevo los deja en
      // "sin_rastro" — evidencia "nombrado" existe (mención) pero sin kg, así
      // que no llega ni a "parcial".
      expect(c!.estado).toBe("sin_rastro");
    }
  });

  it("el CINTURÓN veta los 5: ninguno queda confirmado, todos van a discrepanciasCierre con tipo 'precalibrado'", () => {
    const { confirmados, discrepancias } = aplicarCinturonYTirantes(stockPrecalibrado.candidatosCierre, "precalibrado", cicloPorLote);

    for (const codigo of PREC_SIN_INDICACION) {
      expect(confirmados.some((c) => c.lote === codigo), `${codigo}: NO debería confirmarse`).toBe(false);
    }

    const discrepanciasPorLote = new Map(discrepancias.map((d) => [d.lote, d]));
    for (const codigo of PREC_SIN_INDICACION) {
      const d = discrepanciasPorLote.get(codigo);
      expect(d, `${codigo}: debería estar en discrepanciasCierre`).toBeDefined();
      expect(d!.tipo).toBe("precalibrado");
      expect(d!.estadoNuevo).toBe("sin_rastro");
      // Misma redacción que motivoDiscrepancia sobre el ciclo real — no una
      // frase paralela inventada para el cinturón.
      expect(d!.razon).toBe(motivoDiscrepancia(cicloPorLote.get(codigo)!));
    }
  });
});
