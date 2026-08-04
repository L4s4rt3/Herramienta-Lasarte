/**
 * useCicloVidaLoteEvidencia — hook FINO (mismo patrón que useAsentamientoDia.ts)
 * que alimenta el motor NUEVO (eventosLote.ts + cicloVidaLote.ts, FASE 3a de
 * la refundación de trazabilidad, ver docs/TRAZABILIDAD_REFUNDACION.md) con
 * los datos que useEntradasBascula()/useCamarasExternas() YA cargan — sin
 * ningún fetch nuevo, React Query dedupea por queryKey. Para UN lote
 * concreto devuelve su ciclo de vida derivado, sus eventos (línea de tiempo)
 * y si discrepa del motor VIEJO (buildStockEntradas) que sigue mandando en
 * stock/cierres en esta fase.
 *
 * IMPORTANTE (regla del repo, ver la cabecera de useAsentamientoDia.ts): este
 * hook NUNCA debe disparar el efecto de cierre automático de
 * EntradasBascula.tsx — SOLO lee, nunca muta nada; no importa esa página ni
 * sus mutaciones de escritura, y no debe usarse para decidir stock/cierres
 * (el motor viejo sigue mandando ahí).
 */
import { useMemo } from "react";
import { useEntradasBascula } from "@/hooks/useEntradasBascula";
import { useCamarasExternas } from "@/hooks/useCamarasExternas";
import { normalizarLoteCodigo } from "@/lib/loteCodigo";
import { today } from "@/lib/format";
import {
  compararConMotorViejo,
  construirCicloVidaCampana,
  type DiscrepanciaMotor,
  type EntradaParaEventos,
} from "@/lib/cicloVidaLoteAdapter";
import { eventosPorLote, type EventoLote } from "@/lib/eventosLote";
import type { LoteCiclo } from "@/lib/cicloVidaLote";
import type { SenalesRecepcion } from "@/lib/camarasExternas";
import type { EntradaBasculaRow } from "@/hooks/useEntradasBascula";

export interface CicloVidaLoteEvidencia {
  /** null: el lote no existe en las fuentes crudas (sin entrada de báscula) — el motor nuevo, igual que el viejo, no tiene nada que derivar. */
  ciclo: LoteCiclo | null;
  /** Eventos del lote, en el orden en que los devuelve eventosLote.ts (la UI los ordena cronológicamente). */
  eventos: EventoLote[];
  /** Solo no-null cuando el motor nuevo y el viejo discrepan en si el lote está resuelto o no (ver cicloVidaLoteAdapter.ts). */
  discrepancia: DiscrepanciaMotor | null;
  isLoading: boolean;
  error: unknown;
}

/** Adapta una fila cruda de entradas_bascula (o su equivalente de precalibrado/CAMPO-CIT) al shape mínimo que pide el adaptador — mismos campos que usa useEntradasBascula.ts para construir EntradaConciliacion/senales, sin duplicar el cálculo. */
function aEntradaParaEventos(e: EntradaBasculaRow): EntradaParaEventos {
  return {
    lote: e.lote,
    fecha: e.fecha,
    finca: e.finca,
    articulo: e.articulo,
    agricultor: e.agricultor,
    kg_entrada: Number(e.kg_entrada) || 0,
    kg_ajuste_stock: Number(e.kg_ajuste_stock) || 0,
    merma_camara_kg: (e as { merma_camara_kg?: number | null }).merma_camara_kg ?? null,
    cerrado_at: e.cerrado_at ?? null,
    cierre_modo: e.cierre_modo ?? null,
    camara_confirmada_nombre: e.camara_confirmada_nombre ?? null,
    camara_confirmada_fecha: e.camara_confirmada_fecha ?? null,
  };
}

export function useCicloVidaLoteEvidencia(loteInput: string | null): CicloVidaLoteEvidencia {
  const lote = normalizarLoteCodigo(loteInput);
  const {
    entradas,
    entradasPrecalibrado,
    derivadosCampoCit,
    procesados,
    reciclajePorDia,
    anotacionesPorLoteDia,
    stock,
    isLoading,
    error,
  } = useEntradasBascula();
  const { camiones: camionesCamaraExterna } = useCamarasExternas();

  // Mismo cálculo que el inline de useEntradasBascula.ts (líneas de
  // "Señal de cámara EXTERNA confirmada"): reconstruido aquí porque el hook
  // no expone las señales crudas, solo la unión ya vigente (camaraConfirmadaPorLote)
  // — ningún fetch nuevo, solo reordenar datos ya cargados.
  const senalesCamaraExterna = useMemo((): SenalesRecepcion => {
    const salidaPorLote = new Map<string, string | null>();
    for (const e of entradas) {
      const salida = (e as { fecha_salida_camara?: string | null }).fecha_salida_camara ?? null;
      const merma = (e as { merma_camara_kg?: number | null }).merma_camara_kg ?? null;
      if (salida == null && merma == null) continue;
      const lote8 = normalizarLoteCodigo(e.lote);
      if (lote8) salidaPorLote.set(lote8, salida);
    }
    const lotesProcesados = new Set<string>();
    for (const p of procesados) {
      const lote8 = normalizarLoteCodigo(p.lote_codigo);
      if (lote8) lotesProcesados.add(lote8);
    }
    return { salidaPorLote, lotesProcesados };
  }, [entradas, procesados]);

  // Unión (externa + confirmación física) ya vigente: se reconstruye desde
  // `stock.filas` (mismo patrón que useAsentamientoDia.ts) en vez de
  // recalcularla — es el propio useEntradasBascula.ts quien la inyectó al
  // construir `stock`.
  const lotesConfirmadosEnCamara = useMemo(
    () => new Set(stock.filas.filter((f) => f.enCamaraConfirmada).map((f) => normalizarLoteCodigo(f.lote) ?? f.lote)),
    [stock.filas],
  );

  const anotaciones = useMemo(
    () => Array.from(anotacionesPorLoteDia.values()).flat().map((a) => ({
      lote_dia_id: a.lote_dia_id,
      codigo_extra: a.codigo_extra,
      nota: a.nota,
    })),
    [anotacionesPorLoteDia],
  );

  const hoy = today();

  const { eventos, ciclo } = useMemo(() => construirCicloVidaCampana({
    // Las tres fuentes juntas (reales + precalibrado + CAMPO/CIT): cada una
    // se clasifica sola dentro de eventosDeEntradaBascula (esEntradaPrecalibrado/
    // esEntradaCampoCit), igual que hace el banco dorado.
    entradas: [...entradas, ...entradasPrecalibrado, ...derivadosCampoCit.filas].map(aEntradaParaEventos),
    entradasConciliacionReales: entradas.map(aEntradaParaEventos),
    entradasConciliacionPrecalibrado: entradasPrecalibrado.map(aEntradaParaEventos),
    pasadas: procesados.map((p) => ({ id: p.id, lote_codigo: p.lote_codigo, kg_peso_total: p.kg_peso_total, date: p.date ?? null })),
    reciclajePorDia,
    anotaciones,
    camionesCamaraExterna,
    lotesConfirmadosEnCamara,
    senalesCamaraExterna,
    hoy,
  }), [entradas, entradasPrecalibrado, derivadosCampoCit.filas, procesados, reciclajePorDia, anotaciones, camionesCamaraExterna, lotesConfirmadosEnCamara, senalesCamaraExterna, hoy]);

  const cicloDelLote = useMemo(() => (lote ? ciclo.find((c) => c.lote === lote) ?? null : null), [ciclo, lote]);
  const eventosDelLote = useMemo(() => (lote ? eventosPorLote(eventos).get(lote) ?? [] : []), [eventos, lote]);
  const filaStock = useMemo(
    () => (lote ? stock.filas.find((f) => normalizarLoteCodigo(f.lote) === lote) ?? null : null),
    [stock.filas, lote],
  );
  const discrepancia = useMemo(
    () => (cicloDelLote ? compararConMotorViejo(filaStock, cicloDelLote) : null),
    [filaStock, cicloDelLote],
  );

  return { ciclo: cicloDelLote, eventos: eventosDelLote, discrepancia, isLoading, error };
}
