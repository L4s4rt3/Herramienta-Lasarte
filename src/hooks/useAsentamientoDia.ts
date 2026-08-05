/**
 * useAsentamientoDia — cobertura del "asentamiento" de toda la campaña
 * (src/lib/asentamientoDia.ts) para la card de Análisis diario (eje TIEMPO:
 * "¿qué pasó cada día?"). Hook FINO: no hace ningún fetch propio, reutiliza
 * los datos que useEntradasBascula ya carga con fetchAllRows (entradas,
 * precalibrado, pasadas crudas de lotes_dia, reciclaje diario) para no
 * duplicar ninguna consulta — React Query dedupea por queryKey, así que
 * visitar Análisis diario sin haber abierto /entradas antes solo dispara el
 * mismo fetch una vez.
 *
 * FASE 3c (docs/TRAZABILIDAD_REFUNDACION.md, "mismo número ⇒ misma función
 * pura"): la CLASIFICACIÓN de evidencia (dura/derivada/sin rastro) de
 * asentamientoDia.ts ya no es un cálculo propio — sale de `cicloPorLote`
 * (motor único, cicloVidaLote.ts vía cicloVidaLoteAdapter.ts), que
 * useEntradasBascula() YA calcula para el badge de discrepancia y el
 * cinturón y tirantes (fase 3b). Se reutiliza AQUÍ tal cual (mismo patrón que
 * useCicloVidaLoteEvidencia.ts): cero cálculos duplicados, este hook nunca
 * vuelve a construir eventos ni a derivar el ciclo por su cuenta — solo lo
 * pasa a construirAsentamientoCampana.
 *
 * IMPORTANTE (regla del repo): este hook NUNCA debe reproducir el efecto de
 * cierre automático de EntradasBascula.tsx (ese vive SOLO en esa página,
 * gatillado por un useEffect propio) — aquí solo se LEE, nunca se muta nada.
 */
import { useMemo } from "react";
import { useEntradasBascula } from "@/hooks/useEntradasBascula";
import { normalizarLoteCodigo } from "@/lib/loteCodigo";
import { today } from "@/lib/format";
import {
  construirAsentamientoCampana,
  type CoberturaCampana,
  type EntradaPrecalibradoAsentamiento,
  type EntradaRealAsentamiento,
} from "@/lib/asentamientoDia";
import type { PasadaConciliacion } from "@/lib/conciliacionKg";

export function useAsentamientoDia(): { cobertura: CoberturaCampana; isLoading: boolean; error: unknown } {
  const { entradas, entradasPrecalibrado, procesados, reciclajePorDia, stock, cicloPorLote, isLoading, error } = useEntradasBascula();

  const cobertura = useMemo(() => {
    const entradasReales: EntradaRealAsentamiento[] = entradas.map((e) => ({
      lote: e.lote,
      fecha: e.fecha,
      finca: e.finca,
      articulo: e.articulo,
      agricultor: e.agricultor,
      kg_entrada: Number(e.kg_entrada) || 0,
      kg_ajuste_stock: Number(e.kg_ajuste_stock) || 0,
      cerrado_at: e.cerrado_at ?? null,
      cierre_modo: e.cierre_modo ?? null,
      // Merma real de cámara (migración 20260721150000, sin tipos generados):
      // mismo acceso que hace useEntradasBascula al montar la conciliación.
      kg_merma_camara: (e as { merma_camara_kg?: number | null }).merma_camara_kg ?? null,
    }));

    const entradasPrec: EntradaPrecalibradoAsentamiento[] = entradasPrecalibrado.map((e) => ({
      lote: e.lote,
      fecha: e.fecha,
      finca: e.finca,
      kg_entrada: Number(e.kg_entrada) || 0,
      id: e.id,
      cerrado_at: e.cerrado_at ?? null,
    }));

    const pasadas: PasadaConciliacion[] = procesados.map((p) => ({
      lote_codigo: p.lote_codigo,
      kg_peso_total: p.kg_peso_total,
      date: p.date,
    }));

    // Códigos con señal VIGENTE de "sigue en cámara" (externa o confirmación
    // física): se reconstruye del propio `stock` (StockLoteRow.enCamaraConfirmada)
    // en vez de recalcular camarasExternas.ts/camaraConfirmada.ts por su
    // cuenta — useEntradasBascula ya inyectó la UNIÓN de ambas señales al
    // construirlo.
    const lotesConfirmadosEnCamara = new Set(
      stock.filas.filter((f) => f.enCamaraConfirmada).map((f) => normalizarLoteCodigo(f.lote) ?? f.lote),
    );

    return construirAsentamientoCampana({
      entradas: entradasReales,
      entradasPrecalibrado: entradasPrec,
      pasadas,
      reciclajePorDia,
      lotesConfirmadosEnCamara,
      cicloPorLote,
      hoy: today(),
    });
  }, [entradas, entradasPrecalibrado, procesados, reciclajePorDia, stock.filas, cicloPorLote]);

  return { cobertura, isLoading, error };
}
