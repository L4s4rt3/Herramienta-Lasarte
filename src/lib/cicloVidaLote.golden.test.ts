/**
 * cicloVidaLote.golden.test.ts — BANCO DORADO (docs/TRAZABILIDAD_REFUNDACION.md).
 *
 * Carga el snapshot real de la campaña 2026 (src/lib/__fixtures__/campana2026/)
 * y comprueba, LOTE A LOTE, que el motor nuevo (eventosLote.ts + cicloVidaLote.ts)
 * reproduce el destino auditado (destinos_auditados.json) o discrepa A MEJOR
 * con su explicación registrada aquí mismo — nunca un umbral de "% de acierto"
 * (prohibido explícitamente por el documento rector).
 *
 * NOTA DEL SNAPSHOT (ver docs/TRAZABILIDAD_REFUNDACION.md): es ANTERIOR a la
 * confirmación física (la columna no existía todavía), así que el Set de
 * "lotes confirmados en cámara" que se inyecta al motor SOLO trae la señal de
 * cámara EXTERNA (los 4 Guadex reales) — camaraConfirmadaVigentePorLote no
 * aporta nada (se llama con un array vacío de entradas, tal como haría un
 * caller real sin esa columna todavía).
 *
 * ── EL MAPEO (destino auditado → estados de MI motor aceptados) ────────────
 * Los 14 destinos de la auditoría no son una taxonomía 1:1 con mis 9 estados:
 * varias etiquetas de la auditoría (p. ej. "Sin empezar" y "SIN RASTRO") no
 * son distinguibles con los datos de las 5 fuentes crudas (ver el análisis en
 * el informe de esta tarea) y se agrupan aquí en el mismo estado. Fuera de
 * las discrepancias EXPLÍCITAS de la sección siguiente, cualquier lote cuyo
 * estado no esté en el set aceptado de su destino hace FALLAR el test.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  construirEventosLote,
  type EntradaBasculaEventoInput,
} from "@/lib/eventosLote";
import { derivarCicloVidaLote, type EstadoLote } from "@/lib/cicloVidaLote";
import type { EntradaConciliacion, PasadaConciliacion } from "@/lib/conciliacionKg";
import { codigosEnCamaraExterna, type CamionCamaraExterna, type SenalesRecepcion } from "@/lib/camarasExternas";
import { normalizarLoteCodigo } from "@/lib/loteCodigo";

// ─── Carga del banco dorado ──────────────────────────────────────────────
// NOTA: `new URL("./ruta", import.meta.url)` (la forma "canónica" con fs)
// no sirve aquí — Vite reconoce ese patrón como una referencia a un ASSET
// del bundle y lo reescribe a una URL http://localhost del dev server
// (verificado: rompe con "The URL must be of scheme file" en este repo bajo
// vitest). `path.join(__dirname, ...)` es el equivalente fiable para leer un
// fixture del disco en este proyecto.
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
  kg_industria: number;
  notas: string | null;
}
interface ParteFixture {
  id: string;
  date: string;
  kg_reciclado_malla_z1: number;
  kg_reciclado_malla_z2: number;
  box_reciclaje: number | null;
}
interface DestinoAuditado {
  destino: string;
  evidencia: "dura" | "derivada" | "ninguna";
}

const entradasFixture = cargar<EntradaFixture[]>("entradas_bascula.json");
const pasadasFixture = cargar<PasadaFixture[]>("pasadas_calibrador.json");
const partesFixture = cargar<ParteFixture[]>("partes_diarios.json");
const camaraExternaFixture = cargar<CamionCamaraExterna[]>("camara_externa_camiones.json");
const destinosAuditados = cargar<Record<string, DestinoAuditado>>("destinos_auditados.json");

const HOY = "2026-08-04"; // fecha del propio snapshot (ver cabecera del módulo)

// partes_diarios no trae `lote_codigo`; las pasadas se unen a su parte por
// part_id para heredar la fecha (mismo join que hace useEntradasBascula.ts).
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

/** Misma detección de PRECALIBRADO que esEntradaPrecalibrado (productoresCanonicos.ts) — el fixture no trae más columnas que agricultor/finca. */
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

// Señales de cámara externa: el Set que conciliarKgProcesados/eventosDePasadasCalibrador
// usan para excluir del derrame a los lotes que siguen fuera (ver camaraConfirmada.ts:
// unirLotesConfirmadosEnCamara). Sin fecha_salida_camara en el fixture, salidaPorLote
// va vacío (mismo comportamiento que useEntradasBascula.ts cuando no hay ese dato).
const senalesCamaraExterna: SenalesRecepcion = {
  salidaPorLote: new Map(),
  lotesProcesados: new Set(
    pasadas.flatMap((p) => (String(p.lote_codigo ?? "").match(/\d{8}/g) ?? []).map((c) => normalizarLoteCodigo(c)!)),
  ),
};
const lotesConfirmadosEnCamara = codigosEnCamaraExterna(camaraExternaFixture, senalesCamaraExterna, HOY);

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
const cicloPorLote = new Map(ciclo.map((c) => [c.lote, c]));

// ─── El mapeo: destino auditado → estados de MI motor aceptados sin más ────
// explicación que la de esta tabla. Los que no encajen aquí deben estar en
// `DISCREPANCIAS_ACEPTADAS` (más abajo) o el test falla.
const ESTADOS_ACEPTADOS: Record<string, EstadoLote[]> = {
  "Sin empezar": ["sin_rastro"],
  "Procesado con su código — cerrado": ["cerrado"],
  "Precalibrado sin indicación (cola manual)": ["sin_rastro"],
  "Derivado a Cítrica (CAMPO/CIT)": ["derivado_citrica"],
  // "usado (indicado en informes)": cualquier estado con evidencia NOMBRADA
  // real de por medio vale — la auditoría no distingue completo/parcial/cerrado
  // dentro de "usado", solo que HAY indicación (ver stockPrecalibrado.ts:
  // resueltasPorCompuesta no diferencia completitud tampoco).
  "Precalibrado usado (indicado en informes)": ["cerrado", "completo_pendiente_cierre", "parcial"],
  // "Procesado vía reparto (derrame)": la propia REGLA DE ORO prohíbe que mi
  // motor reproduzca este destino tal cual (el derrame nunca cierra ni
  // completa) — los 39 lotes están en DISCREPANCIAS_ACEPTADAS, ninguno aquí.
  "Procesado vía reparto (derrame misma finca/variedad)": [],
  "Cerrado sin registro (la fruta salió sin dejar rastro)": ["cerrado"],
  "Procesado dentro de pasada compuesta": ["cerrado"],
  "Procesado con su código — completo (cierre pendiente)": ["completo_pendiente_cierre"],
  "SIN RASTRO (abierto, sin ninguna evidencia)": ["sin_rastro"],
  // "CONTRADICCIÓN...": se verifica por la PRESENCIA del flag de contradicción
  // (ver el bloque dedicado más abajo), no por el estado — el estado que le
  // toque de forma natural (cerrado/completo/sin_rastro/sin_evidencia) es
  // correcto siempre que la contradicción quede visible.
  "CONTRADICCIÓN pasada ↔ foto de stock (revisar)": ["cerrado", "completo_pendiente_cierre", "parcial", "sin_rastro", "sin_evidencia_suficiente"],
  "A medias — cola pendiente": ["parcial"],
  "En cámara externa (GUADEX)": ["en_camara_externa"],
  "Venta directa": ["venta_directa"],
};

// ─── Discrepancias aceptadas, UNA A UNA (con su patrón y su porqué) ────────
// Prohibido un umbral de "% de acierto": cada lote de aquí abajo es una
// excepción nominal explícita, verificada contra los datos crudos del propio
// banco (ver el informe de esta tarea para el detalle numérico de cada uno).

/**
 * PATRÓN 1 — "Procesado vía reparto (derrame)" (39 lotes, evidencia
 * "derivada" en la propia auditoría): la REGLA DE ORO dice textualmente que
 * el derrame "nunca cierra lotes, aunque eso signifique más lotes en cola
 * manual". Mi motor JAMÁS puede reproducir este destino tal cual — degrada
 * cada uno de los 39 según lo que el resto de evidencia (ya sin el derrame)
 * permite decir, en tres sub-patrones verificados uno a uno:
 */
// 1a) Sin ningún otro respaldo (nombrado/anotado/medido = 0) — ni siquiera
// una contra-señal de cámara externa vigente: degrada a
// "sin_evidencia_suficiente" con la contradicción "exceso_sin_dueno" — la
// cola de revisión visible que pide el documento rector. Incluye los 4 casos
// nombrados por el dueño (26051408/26051906/26052602 sin evidencia dura, más
// los que además tenían cerrado_at con una contra-señal de cámara externa
// vigente en el momento del cierre: 26051509/26051907/26052005/26052006 —
// mismo criterio que 26051906, ver cicloVidaLote.ts).
const DERRAME_A_SIN_EVIDENCIA = [
  "25112404", "25122705", "25123007", "26021402", "26021409", "26022001", "26030907", "26042812",
  "26051209", "26051408", "26051505", "26051509", "26051802", "26051903", "26051906", "26051907",
  "26052004", "26052005", "26052006", "26052105", "26052205", "26052601", "26052602", "26052701",
  "26052801", "26052804", "26052904", "26060102", "26060104", "26060201", "26060305", "26061901",
  "05260707",
];
// 1b) El único de los 39 con cerrado_at que SÍ conserva un respaldo real
// después de excluir el derrame: 26050408 tiene 520 kg de merma REAL de
// cámara (medido) — un cierre manual con esa merma detrás es "anotado...
// indicación humana explícita" legítima (mismo patrón que "Cerrado sin
// registro", evidencia "ninguna", 7 lotes que SÍ están en ESTADOS_ACEPTADOS).
const DERRAME_A_CERRADO = ["26050408"];
// 1c) El registro de cámara externa muestra a estos 5 TODAVÍA "en_camara"
// (sin cerrado_at, sin ninguna contradicción de cierre): mi motor, con la
// señal vigente inyectada, sabe EXACTAMENTE dónde está la fruta — más preciso
// que la propia etiqueta "derrame" de la auditoría (que no tenía esta lectura
// en cuenta). Discrepar a mejor: en vez de un derrame estadístico, ubicación real.
const DERRAME_A_EN_CAMARA_EXTERNA = ["26051409", "26051410", "26051412", "26051506", "26051507"];

/**
 * PATRÓN 2 — 5 re-entradas de PRECALIBRADO cerradas en bloque (mismo
 * timestamp que el resto de "Precalibrado usado", 2026-08-04T07:28:16) SIN
 * ninguna mención en los informes (evidencia "ninguna" también en la propia
 * auditoría, que sin embargo las cuenta aparte como "sin indicación"). El
 * cierre manual (ANOTADO) es autoridad suficiente por sí sola — mismo
 * argumento que "Cerrado sin registro" — así que mi motor las da por
 * cerradas en vez de mantenerlas en la cola manual.
 */
const PREC_SIN_INDICACION_A_CERRADO = ["26030507", "26031908", "26032309", "26070801", "26070802"];

/**
 * PATRÓN 3 — un único lote, caso aislado y verificado a mano: 26051102 tiene
 * una pasada propia "26051102+ 6 BOX DE RECICLAJE" (21.273,77 kg) pero el
 * descuento de reciclaje del día (reutilizado de conciliarKgProcesados, NO
 * duplicado) resta parte de ese kg antes de atribuirlo al lote — el nombrado
 * resultante (≈20.214 kg, 85,6 % de la entrada) se queda por debajo del
 * umbral relajado por edad (≈92,6 % a 85 días). La auditoría lo dio por
 * completo; mi motor, aplicando el mismo descuento de reciclaje que el resto
 * del motor viejo, es más conservador y lo deja "parcial" — ninguna regla de
 * oro en juego, solo el reparto de una pasada que también nombra reciclaje.
 */
const RECICLAJE_COMPLETO_A_PARCIAL = ["26051102"];

const DISCREPANCIAS_ACEPTADAS = new Map<string, EstadoLote>([
  ...DERRAME_A_SIN_EVIDENCIA.map((l): [string, EstadoLote] => [l, "sin_evidencia_suficiente"]),
  ...DERRAME_A_CERRADO.map((l): [string, EstadoLote] => [l, "cerrado"]),
  ...DERRAME_A_EN_CAMARA_EXTERNA.map((l): [string, EstadoLote] => [l, "en_camara_externa"]),
  ...PREC_SIN_INDICACION_A_CERRADO.map((l): [string, EstadoLote] => [l, "cerrado"]),
  ...RECICLAJE_COMPLETO_A_PARCIAL.map((l): [string, EstadoLote] => [l, "parcial"]),
]);

describe("cicloVidaLote — banco dorado (campaña 2026)", () => {
  it("procesa el mismo universo de lotes que la auditoría", () => {
    expect(ciclo.length).toBe(Object.keys(destinosAuditados).length);
  });

  it("reproduce el destino auditado o discrepa según la lista explícita de arriba", () => {
    const noExplicadas: string[] = [];
    for (const [lote, auditado] of Object.entries(destinosAuditados)) {
      const mio = cicloPorLote.get(lote);
      if (!mio) {
        noExplicadas.push(`${lote}: no existe en el motor nuevo`);
        continue;
      }

      if (auditado.destino.startsWith("CONTRADICCIÓN")) {
        // Se verifica en el bloque dedicado más abajo (presencia del flag),
        // no aquí — solo se exige que el estado sea uno de los plausibles.
        if (!ESTADOS_ACEPTADOS[auditado.destino]!.includes(mio.estado)) {
          noExplicadas.push(`${lote}: destino "${auditado.destino}" → estado inesperado "${mio.estado}"`);
        }
        continue;
      }

      const aceptados = ESTADOS_ACEPTADOS[auditado.destino];
      if (aceptados === undefined) {
        noExplicadas.push(`${lote}: destino auditado desconocido "${auditado.destino}" (no está en ESTADOS_ACEPTADOS)`);
        continue;
      }
      if (aceptados.includes(mio.estado)) continue;

      const discrepanciaEsperada = DISCREPANCIAS_ACEPTADAS.get(lote);
      if (discrepanciaEsperada === undefined) {
        noExplicadas.push(`${lote}: destino auditado "${auditado.destino}" → estado "${mio.estado}" (discrepancia SIN registrar)`);
      } else if (discrepanciaEsperada !== mio.estado) {
        noExplicadas.push(`${lote}: se esperaba la discrepancia registrada "${discrepanciaEsperada}" pero salió "${mio.estado}"`);
      }
      // discrepanciaEsperada === mio.estado: discrepancia aceptada, ok.
    }
    expect(noExplicadas).toEqual([]);
  });

  it("las 9 CONTRADICCIÓN pasada↔foto de stock del banco quedan señaladas con el flag", () => {
    const lotesContradiccion = Object.entries(destinosAuditados)
      .filter(([, d]) => d.destino.startsWith("CONTRADICCIÓN"))
      .map(([l]) => l);
    expect(lotesContradiccion.length).toBe(9);
    for (const lote of lotesContradiccion) {
      const mio = cicloPorLote.get(lote)!;
      expect(mio.contradicciones.some((c) => c.tipo === "pasada_vs_foto_stock"), `${lote} debería tener la contradicción pasada_vs_foto_stock`).toBe(true);
    }
  });

  it("invariante de conservación: Σ kg por clase = kg de entrada, lote a lote", () => {
    for (const c of ciclo) {
      const suma = c.kgPorClase.nombrado + c.kgPorClase.anotado + c.kgPorClase.medido + c.kgPorClase.derivado + c.kgPorClase.sinRastro;
      expect(Math.abs(suma - c.kgEntrada), `${c.lote}: Σ kgPorClase (${suma}) != kgEntrada (${c.kgEntrada})`).toBeLessThan(1);
    }
  });

  // ─── Asserts nominales: los inventarios físicos del dueño ────────────────
  it("los 4 lotes de Guadex (inventario físico del dueño) quedan en cámara externa, nunca cerrados/completos", () => {
    for (const lote of ["26050809", "26051106", "26052207", "26052506"]) {
      const mio = cicloPorLote.get(lote)!;
      expect(mio.estado, lote).toBe("en_camara_externa");
    }
  });

  it("26051408/26051906/26052602 (inventario del dueño: sin evidencia dura de procesado) no quedan cerrados ni completos", () => {
    for (const lote of ["26051408", "26051906", "26052602"]) {
      const mio = cicloPorLote.get(lote)!;
      expect(mio.estado).not.toBe("cerrado");
      expect(mio.estado).not.toBe("completo_pendiente_cierre");
      expect(mio.pctConEvidenciaDura).toBe(0);
    }
  });
});
