/**
 * useAnalisisInformes.ts
 *
 * Hook que orquesta el flujo completo de análisis:
 *   1. Recibe File[] (los informes Excel del parte)
 *   2. Parsea cada uno con parseInforme()
 *   3. Calcula KPIs y alertas con computeAnalisisDesdeInformes()
 *   4. Guarda el JSON en partes_diarios.resumen_analisis
 *   5. Guarda lotes/palets/calibres/producto en sus tablas
 *   6. Devuelve el AnalisisDia para que el componente lo renderice
 */
import { useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { parseInforme, type ParsedInforme } from "@/lib/parsers";
import {
  computeAnalisisDesdeInformes,
  type AnalisisDia,
} from "@/lib/analisis";
import { toast } from "@/hooks/use-toast";

export type EstadoAnalisis = "idle" | "parseando" | "calculando" | "guardando" | "listo" | "error";

interface UseAnalisisReturn {
  estado: EstadoAnalisis;
  analisis: AnalisisDia | null;
  /** Paso a paso: qué archivo se está procesando */
  progreso: string;
  /** Lanzar análisis completo */
  analizar: (files: File[], partId: string, userId: string) => Promise<void>;
  /** Resetear */
  reset: () => void;
}

export function useAnalisisInformes(): UseAnalisisReturn {
  const [estado, setEstado] = useState<EstadoAnalisis>("idle");
  const [analisis, setAnalisis] = useState<AnalisisDia | null>(null);
  const [progreso, setProgreso] = useState("");

  const reset = useCallback(() => {
    setEstado("idle");
    setAnalisis(null);
    setProgreso("");
  }, []);

  const analizar = useCallback(async (
    files: File[],
    partId: string,
    userId: string,
  ) => {
    if (files.length === 0) {
      toast({
        title: "Sin archivos",
        description: "Sube los informes Excel en el tab 'Importar' antes de analizar",
        variant: "destructive",
      });
      return;
    }

    setEstado("parseando");
    setAnalisis(null);

    // ── Paso 1: parsear todos los archivos ──────────────────────────────
    const informes: ParsedInforme[] = [];

    for (const file of files) {
      setProgreso(`Parseando ${file.name}…`);
      try {
        const result = await parseInforme(file);
        if (result) {
          informes.push(result);
        } else {
          toast({
            title: `No se reconoció: ${file.name}`,
            description: "Se omite — continúa con el resto",
          });
        }
      } catch (err) {
        console.error("Error parseando", file.name, err);
        toast({
          title: `Error en ${file.name}`,
          description: String(err),
          variant: "destructive",
        });
      }
    }

    if (informes.length === 0) {
      toast({
        title: "Sin informes válidos",
        description: "Ningún archivo pudo parsearse correctamente",
        variant: "destructive",
      });
      setEstado("error");
      setProgreso("");
      return;
    }

    // ── Paso 2: calcular KPIs y alertas ────────────────────────────────
    setEstado("calculando");
    setProgreso("Calculando KPIs y alertas…");

    let resultado: AnalisisDia;
    try {
      resultado = computeAnalisisDesdeInformes(informes);
    } catch (err) {
      console.error("Error en computeAnalisis:", err);
      toast({ title: "Error al calcular KPIs", description: String(err), variant: "destructive" });
      setEstado("error");
      setProgreso("");
      return;
    }

    // ── Paso 3: guardar en Supabase ────────────────────────────────────
    setEstado("guardando");
    setProgreso("Guardando en base de datos…");

    try {
      await guardarEnSupabase(informes, resultado, partId, userId);
    } catch (err) {
      // No es fatal — el análisis ya está calculado, solo no se guardó
      console.error("Error guardando en Supabase:", err);
      toast({
        title: "Análisis listo (guardado parcial)",
        description: "Los KPIs se calcularon pero hubo un error al guardar en BD",
        variant: "destructive",
      });
    }

    // ── Paso 4: exponer resultado ───────────────────────────────────────
    setAnalisis(resultado);
    setEstado("listo");
    setProgreso("");

    toast({
      title: "✅ Análisis completado",
      description: `${resultado.alertas.length} alertas · ${resultado.kpis.pct_exportacion}% exportación`,
    });
  }, []);

  return { estado, analisis, progreso, analizar, reset };
}

// ─────────────────────────────────────────────────────────────────────────────
// Lógica de persistencia en Supabase
// ─────────────────────────────────────────────────────────────────────────────

async function guardarEnSupabase(
  informes: ParsedInforme[],
  analisis: AnalisisDia,
  partId: string,
  userId: string,
) {
  const ops: Promise<any>[] = [];

  // 1. resumen_analisis en partes_diarios
  ops.push(
    supabase
      .from("partes_diarios")
      .update({
        resumen_analisis: analisis as any,
        // también actualizar campos numéricos del parte si tenemos los datos
        ...(analisis.kpis.kg_calibrador > 0 && {
          kg_produccion_calibrador: analisis.kpis.kg_calibrador,
        }),
      })
      .eq("id", partId)
  );

  // 2. lotes_dia  (del informe produccion)
  const prodInforme = informes.find((i) => i.tipo === "produccion") as import("@/lib/parsers").ParsedProduccion | undefined;
  if (prodInforme && prodInforme.lotes.length > 0) {
    await supabase.from("lotes_dia").delete().eq("part_id", partId);
    ops.push(
      supabase.from("lotes_dia").insert(
        prodInforme.lotes.map((l) => ({
          part_id: partId,
          user_id: userId,
          lote_codigo: l.lote_codigo,
          productor: l.productor,
          producto: l.producto,
          kg_peso_total: l.kg_peso_total,
          toneladas_hora: l.toneladas_hora,
          duracion_min: l.duracion_min,
          peso_fruta_promedio_g: l.peso_fruta_promedio_g,
          hora_inicio: l.hora_inicio,
          source: "manual",
        })) as any
      )
    );
  }

  // 3. palets_dia
  const paletsInforme = informes.find((i) => i.tipo === "palets") as import("@/lib/parsers").ParsedPalets | undefined;
  if (paletsInforme && paletsInforme.palets.length > 0) {
    await (supabase as any).from("palets_dia").delete().eq("part_id", partId);
    ops.push(
      (supabase as any).from("palets_dia").insert(
        paletsInforme.palets.map((p) => ({
          part_id: partId,
          user_id: userId,
          palet_id: p.palet_id,
          producto: p.producto,
          cliente: p.cliente,
          destino: p.destino,
          kg_neto: p.kg_neto,
          situacion: p.situacion,
          n_cajas: p.n_cajas,
          source: "manual",
        }))
      )
    );
  }

  // 4. calibres_dia
  const calibresInforme = informes.find((i) => i.tipo === "calibres") as import("@/lib/parsers").ParsedCalibres | undefined;
  if (calibresInforme && calibresInforme.calibres.length > 0) {
    await (supabase as any).from("calibres_dia").delete().eq("part_id", partId);
    ops.push(
      (supabase as any).from("calibres_dia").insert(
        calibresInforme.calibres.map((c) => ({
          part_id: partId,
          user_id: userId,
          calibre: c.calibre,
          piezas: c.piezas,
          kg: c.kg,
          pct: c.pct,
          clase: c.clase,
          grupo_destino: c.grupo_destino,
          source: "manual",
        }))
      )
    );
  }

  // 5. producto_dia
  const productoInforme = informes.find((i) => i.tipo === "producto") as import("@/lib/parsers").ParsedProducto | undefined;
  if (productoInforme && productoInforme.lineas.length > 0) {
    await (supabase as any).from("producto_dia").delete().eq("part_id", partId);
    ops.push(
      (supabase as any).from("producto_dia").insert(
        productoInforme.lineas.map((l) => ({
          part_id: partId,
          user_id: userId,
          linea: l.linea,
          producto: l.producto,
          formato_caja: l.formato_caja,
          kg: l.kg,
          n_cajas: l.cajas,
          grupo_destino: l.grupo_destino,
          source: "manual",
        }))
      )
    );
  }

  await Promise.all(ops);
}
