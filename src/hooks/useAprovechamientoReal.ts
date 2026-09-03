// Aprovechamiento REAL (medido, no estimado) de las parcelas de una finca.
//
// POR QUÉ EXISTE (03-09-2026). Era scripts/informe-aprovechamiento-invermarmelo.ts,
// un Excel clavado a las parcelas 2 y 4 de un productor que dirección quería
// para cualquier finca. Los números los hace _shared/aprovechamientoReal.ts,
// que también usa el script: misma cifra en pantalla y en el Excel.
//
// DE DÓNDE SALE CADA COSA
// - Los lotes de la finca y su parcela, kg de báscula, ajuste, cierre y
//   confirmación de cámara: las entradas de báscula de useEntradasBascula()
//   (React Query las comparte con el resto de la app).
// - El desglose del calibrador por pasada × producto × clase × calibre: la
//   RPC clasificacion_detalle_lotes(lotes) sobre la materializada
//   clasificacion_lote_detalle_mv (la vista canónica clasificacion_lote, que ya
//   aplica la prioridad volcado SQL > Word > Excel POR LOTE Y DÍA). La misma
//   RPC dice hasta qué día llega cada fuente.
// - Las pasadas del parte diario (lotes_dia + partes_diarios): la señal de
//   "esto ya pasó por línea" que llega antes que el volcado del Sizer.
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthProvider";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/fetchAllRows";
import { useEntradasBascula, type EntradaBasculaRow } from "@/hooks/useEntradasBascula";
import {
  acumularDetalleReal,
  acumuladoRealVacio,
  calibresReal,
  clasesReal,
  coberturaReal,
  etiquetaParcela,
  frescuraFuentes,
  lote8De,
  pasadasCompuestas,
  pasadasDelPartePorLote,
  resumenReal,
  type AcumuladoReal,
  type EntradaReal,
  type FilaCalibreReal,
  type FilaClaseReal,
  type FilaCoberturaReal,
  type FilaDetalleReal,
  type FrescuraFuentes,
  type PasadaCompuesta,
  type ResumenReal,
} from "@/lib/aprovechamientoReal";

// ─── El árbol finca → parcelas, sacado de las entradas ──────────────────────

export interface OpcionParcela {
  /** Texto tal y como está en la báscula; "" = sin parcela. */
  parcela: string;
  etiqueta: string;
  lotes: number;
  kgEntrada: number;
}

export interface OpcionFinca {
  finca: string;
  /** El agricultor más frecuente de la finca, para enseñarlo al lado. */
  productor: string;
  lotes: number;
  kgEntrada: number;
  parcelas: OpcionParcela[];
}

const SIN_PARCELA = "";

function parcelaDe(e: EntradaBasculaRow): string {
  return String((e as { parcela?: string | null }).parcela ?? "").trim();
}

/** Fincas con sus parcelas, de más a menos kg entrados. Solo entradas externas (sin precalibrado ni CAMPO/CIT). */
export function arbolFincas(entradas: EntradaBasculaRow[]): OpcionFinca[] {
  const porFinca = new Map<string, { lotes: number; kg: number; agricultores: Map<string, number>; parcelas: Map<string, { lotes: number; kg: number }> }>();
  for (const e of entradas) {
    const finca = String(e.finca ?? "").trim();
    if (!finca) continue;
    const f = porFinca.get(finca) ?? { lotes: 0, kg: 0, agricultores: new Map(), parcelas: new Map() };
    const kg = Number(e.kg_entrada) || 0;
    f.lotes += 1;
    f.kg += kg;
    const ag = String(e.agricultor ?? "").trim();
    if (ag) f.agricultores.set(ag, (f.agricultores.get(ag) ?? 0) + 1);
    const p = parcelaDe(e);
    const pp = f.parcelas.get(p) ?? { lotes: 0, kg: 0 };
    pp.lotes += 1;
    pp.kg += kg;
    f.parcelas.set(p, pp);
    porFinca.set(finca, f);
  }
  return [...porFinca.entries()]
    .map(([finca, f]) => ({
      finca,
      productor: [...f.agricultores.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "",
      lotes: f.lotes,
      kgEntrada: f.kg,
      parcelas: [...f.parcelas.entries()]
        .map(([parcela, v]) => ({ parcela, etiqueta: etiquetaParcela(parcela || null), lotes: v.lotes, kgEntrada: v.kg }))
        .sort((a, b) => a.etiqueta.localeCompare(b.etiqueta, "es", { numeric: true })),
    }))
    .sort((a, b) => b.kgEntrada - a.kgEntrada);
}

// ─── La RPC del detalle ─────────────────────────────────────────────────────

/**
 * Filas POSICIONALES (contrato con la migración 20260903110937):
 * 0 lote8, 1 fecha, 2 batch_id, 3 fuente, 4 lote_codigo, 5 producto, 6 clase,
 * 7 letra, 8 destino, 9 tamano, 10 kg, 11 piezas.
 */
type FilaDetallePosicional = [string, string | null, number | null, string | null, string | null, string | null, string | null, string | null, string | null, string | null, number | string | null, number | string | null];

interface RespuestaDetalle {
  refrescado_en: string | null;
  ultima_pasada_sql: string | null;
  ultima_sincronizacion: string | null;
  ultimo_docx: string | null;
  ultimo_parte: string | null;
  filas: FilaDetallePosicional[];
}

function aFilaDetalle(f: FilaDetallePosicional): FilaDetalleReal {
  return { lote8: f[0], fecha: f[1], batchId: f[2], fuente: f[3], nombrePasada: f[4], producto: f[5], clase: f[6], destino: f[8], tamano: f[9], kg: f[10] };
}

// ─── Resultado ──────────────────────────────────────────────────────────────

export interface ParcelaReal {
  parcela: string;
  etiqueta: string;
  acumulado: AcumuladoReal;
  resumen: ResumenReal;
  clases: FilaClaseReal[];
  calibres: FilaCalibreReal[];
  nLotes: number;
  nConDato: number;
  kgEntradaTotal: number;
  kgEntradaConDato: number;
  /** Kg de báscula analizados / kg de báscula de la parcela. */
  cobertura: number | null;
}

export interface LoteReal extends FilaCoberturaReal {
  resumen: ResumenReal | null;
}

export interface AprovechamientoReal {
  parcelas: ParcelaReal[];
  /** Todas las parcelas elegidas juntas. */
  total: ParcelaReal;
  lotes: LoteReal[];
  compuestas: PasadaCompuesta[];
  frescura: FrescuraFuentes;
  refrescadoEn: string | null;
  pendientesVolcado: LoteReal[];
}

function parcelaReal(parcela: string, acumulado: AcumuladoReal, entradas: EntradaReal[], porLote: Map<string, AcumuladoReal>): ParcelaReal {
  const conDato = entradas.filter((e) => porLote.has(lote8De(e.lote) ?? ""));
  const kgEntradaTotal = entradas.reduce((s, e) => s + e.kgEntrada, 0);
  const kgEntradaConDato = conDato.reduce((s, e) => s + e.kgEntrada, 0);
  return {
    parcela,
    etiqueta: etiquetaParcela(parcela || null),
    acumulado,
    resumen: resumenReal(acumulado),
    clases: clasesReal(acumulado),
    calibres: calibresReal(acumulado),
    nLotes: entradas.length,
    nConDato: conDato.length,
    kgEntradaTotal,
    kgEntradaConDato,
    cobertura: kgEntradaTotal > 0 ? (kgEntradaConDato / kgEntradaTotal) * 100 : null,
  };
}

export interface AprovechamientoRealOpciones {
  finca: string | null;
  /** Parcelas elegidas ("" = sin parcela). Vacío = ninguna. */
  parcelas: string[];
}

export function useAprovechamientoReal({ finca, parcelas }: AprovechamientoRealOpciones) {
  const { user } = useAuth();
  const { entradas, isLoading: entradasLoading } = useEntradasBascula();

  const arbol = useMemo(() => arbolFincas(entradas), [entradas]);

  const entradasElegidas = useMemo(() => {
    if (!finca) return [];
    const set = new Set(parcelas);
    return entradas.filter((e) => String(e.finca ?? "").trim() === finca && set.has(parcelaDe(e)));
  }, [entradas, finca, parcelas]);

  const lotes8 = useMemo(
    () => [...new Set(entradasElegidas.map((e) => lote8De(e.lote)).filter((l): l is string => Boolean(l)))].sort(),
    [entradasElegidas],
  );

  const detalleQuery = useQuery({
    queryKey: ["aprovechamiento-real", "detalle", lotes8.join(",")],
    queryFn: async (): Promise<RespuestaDetalle> => {
      const { data, error } = await supabase.rpc("clasificacion_detalle_lotes", { lotes: lotes8 });
      if (error) throw new Error(error.message);
      const r = data as unknown as RespuestaDetalle | null;
      return r ?? { refrescado_en: null, ultima_pasada_sql: null, ultima_sincronizacion: null, ultimo_docx: null, ultimo_parte: null, filas: [] };
    },
    enabled: Boolean(user) && lotes8.length > 0,
    staleTime: 15 * 60_000,
  });

  const parteQuery = useQuery({
    queryKey: ["aprovechamiento-real", "pasadas-parte"],
    queryFn: async () => {
      const [lotesDia, partes] = await Promise.all([
        fetchAllRows<{ lote_codigo: string | null; kg_peso_total: number | null; part_id: string }>((from, to) =>
          supabase.from("lotes_dia").select("lote_codigo, kg_peso_total, part_id").order("id").range(from, to)),
        fetchAllRows<{ id: string; date: string | null }>((from, to) =>
          supabase.from("partes_diarios").select("id, date").order("id").range(from, to)),
      ]);
      return { lotesDia, fechaPorParte: new Map(partes.map((p) => [p.id, p.date ?? null])) };
    },
    enabled: Boolean(user),
    staleTime: 15 * 60_000,
  });

  const data: AprovechamientoReal | null = useMemo(() => {
    if (!finca || lotes8.length === 0 || !detalleQuery.data || !parteQuery.data) return null;
    const entradasReal: EntradaReal[] = entradasElegidas.map((e) => ({
      lote: e.lote,
      fecha: e.fecha,
      parcela: parcelaDe(e),
      kgEntrada: Number(e.kg_entrada) || 0,
      kgAjuste: Number(e.kg_ajuste_stock) || 0,
      cerradoAt: e.cerrado_at ?? null,
      camaraConfirmadaNombre: e.camara_confirmada_nombre ?? null,
      camaraConfirmadaFecha: e.camara_confirmada_fecha ?? null,
    }));
    const parcelaPorLote = new Map<string, string>();
    for (const e of entradasReal) {
      const l = lote8De(e.lote);
      if (l) parcelaPorLote.set(l, e.parcela ?? SIN_PARCELA);
    }
    // La RPC devuelve los lotes pedidos; el filtro por parcela es doble seguro.
    const filas = detalleQuery.data.filas.map(aFilaDetalle).filter((f) => parcelaPorLote.has(f.lote8));

    const porParcela = acumularDetalleReal(filas, (f) => parcelaPorLote.get(f.lote8));
    const porLote = acumularDetalleReal(filas, (f) => f.lote8);
    const todo = acumularDetalleReal(filas, () => "total").get("total") ?? acumuladoRealVacio();

    const frescura = frescuraFuentes({
      ultimaPasadaSql: detalleQuery.data.ultima_pasada_sql,
      ultimaSincronizacion: detalleQuery.data.ultima_sincronizacion,
      ultimoDocx: detalleQuery.data.ultimo_docx,
      ultimoParte: detalleQuery.data.ultimo_parte,
    });
    const pasadasParte = pasadasDelPartePorLote(parteQuery.data.lotesDia, parteQuery.data.fechaPorParte, new Set(parcelaPorLote.keys()));
    const cobertura = coberturaReal(entradasReal, porLote, pasadasParte, frescura);
    const lotes: LoteReal[] = cobertura.map((c) => {
      const acc = porLote.get(c.lote8);
      return { ...c, resumen: acc ? resumenReal(acc) : null };
    });

    const parcelasOrdenadas = [...new Set(entradasReal.map((e) => e.parcela ?? SIN_PARCELA))]
      .sort((a, b) => etiquetaParcela(a || null).localeCompare(etiquetaParcela(b || null), "es", { numeric: true }));
    return {
      parcelas: parcelasOrdenadas.map((p) =>
        parcelaReal(p, porParcela.get(p) ?? acumuladoRealVacio(), entradasReal.filter((e) => (e.parcela ?? SIN_PARCELA) === p), porLote)),
      total: parcelaReal("__total__", todo, entradasReal, porLote),
      lotes,
      compuestas: pasadasCompuestas(filas),
      frescura,
      refrescadoEn: detalleQuery.data.refrescado_en,
      pendientesVolcado: lotes.filter((l) => l.estado === "pendiente_volcado"),
    };
  }, [finca, lotes8, entradasElegidas, detalleQuery.data, parteQuery.data]);

  return {
    arbol,
    data,
    isLoading: entradasLoading || (lotes8.length > 0 && detalleQuery.isLoading) || parteQuery.isLoading,
    error: detalleQuery.error ?? parteQuery.error,
  };
}
