// src/components/importar/ZonaAutomatica.tsx
// Zona A de la Bandeja de importación ("Se importan solos"): informe-lote,
// informe-produccion, palets-campana, camaras-externas e informe-productor.
// Arranca automáticamente al montar (el padre fuerza un remount por cada
// tanda de clasificación nueva con key={batchId}) y ejecuta los 5 grupos EN
// SECUENCIA (uno espera al anterior): si uno falla, los siguientes igualmente
// se intentan (no se aborta el resto por un error de otro grupo).
import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  useHistoricoImport,
  useHistoricoImportPalets,
  useInformesLoteImport,
  type ArchivoInformeLote,
} from "@/hooks/useHistoricoImport";
import { useCamarasExternas } from "@/hooks/useCamarasExternas";
import { useCalidadReferencias } from "@/hooks/useCalidadReferencias";
import { useProductoresCatalogo } from "@/hooks/useProductoresCatalogo";
import { resolveProductorGroupKey } from "@/lib/productoresCanonicos";
import { errorMessage } from "@/lib/errorMessage";
import { formatKg, formatNumber } from "@/lib/format";
import { TIPO_BANDEJA_LABEL, type ArchivoClasificado, type TipoArchivoBandeja } from "@/lib/importBandeja";
import type { InformeTamanosClases } from "@/lib/calidadReferencias";
import type { CamionCamaraExterna, ParseRegistroCamaraResult } from "@/lib/camarasExternas";
import type { FilaInformePalets, ParseInformePaletsResult } from "@/lib/historicoPalets";
import type { FilaInformeProduccion, ParseInformeProduccionResult } from "@/lib/historicoProduccion";
import type { InformeLote, ParseInformeLoteResult } from "@/lib/informeLote";

/** Orden de ejecución de la zona A (crítico: en secuencia, uno espera al anterior). */
const GRUPOS_ORDEN: TipoArchivoBandeja[] = [
  "informe-lote",
  "informe-produccion",
  "palets-campana",
  "camaras-externas",
  "informe-productor",
];

type EstadoGrupo =
  | { estado: "en-curso" }
  | { estado: "ok"; mensaje: string }
  | { estado: "error"; mensaje: string };

interface Props {
  clasificados: ArchivoClasificado[];
  /**
   * Aviso al padre de que la secuencia automática está en marcha: mientras sea
   * true la página NO debe aceptar otra tanda (soltar más archivos remontaría
   * este componente con imports aún corriendo y podrían solaparse mutaciones).
   */
  onOcupadaChange?: (ocupada: boolean) => void;
}

export function ZonaAutomatica({ clasificados, onOcupadaChange }: Props) {
  const informesLoteImport = useInformesLoteImport();
  const historicoImport = useHistoricoImport();
  const historicoImportPalets = useHistoricoImportPalets();
  const camarasExternas = useCamarasExternas();
  const calidadReferencias = useCalidadReferencias();
  const { aliasPorNombreNormalizado } = useProductoresCatalogo();

  const porTipo = useMemo(() => {
    const map = new Map<TipoArchivoBandeja, ArchivoClasificado[]>();
    for (const c of clasificados) {
      const arr = map.get(c.tipo) ?? [];
      arr.push(c);
      map.set(c.tipo, arr);
    }
    return map;
  }, [clasificados]);

  const [resultados, setResultados] = useState<Partial<Record<TipoArchivoBandeja, EstadoGrupo>>>({});

  useEffect(() => {
    let cancelado = false;
    const marcar = (tipo: TipoArchivoBandeja, estado: EstadoGrupo) => {
      if (cancelado) return;
      setResultados((prev) => ({ ...prev, [tipo]: estado }));
    };

    const hayTrabajo = GRUPOS_ORDEN.some((t) => (porTipo.get(t)?.length ?? 0) > 0);
    if (hayTrabajo) onOcupadaChange?.(true);

    (async () => {
      if (!hayTrabajo) return;
      // ─── informe-lote ───────────────────────────────────────────────────
      const archivosLote = porTipo.get("informe-lote");
      if (archivosLote?.length) {
        marcar("informe-lote", { estado: "en-curso" });
        try {
          const archivos: ArchivoInformeLote[] = archivosLote.map((a) => ({
            fileName: a.fileName,
            informe: (a.payload as ParseInformeLoteResult).informe as InformeLote,
          }));
          const resumen = await informesLoteImport.importar.mutateAsync({ archivos });
          marcar("informe-lote", {
            estado: "ok",
            mensaje: `${resumen.clasificacionesInsertadas} clasificación(es) nueva(s) (${resumen.filasClasificacion} fila(s)), ${resumen.yaTenianInforme} ya existente(s), ${resumen.lotesDiaReparados} lote(s) reparado(s) (${formatKg(resumen.kgReparados)})${resumen.descartados.length ? `, ${resumen.descartados.length} descartado(s)` : ""}.`,
          });
        } catch (e) {
          marcar("informe-lote", { estado: "error", mensaje: errorMessage(e) });
        }
      }

      // ─── informe-produccion ─────────────────────────────────────────────
      const archivosProduccion = porTipo.get("informe-produccion");
      if (archivosProduccion?.length) {
        marcar("informe-produccion", { estado: "en-curso" });
        try {
          const filas: FilaInformeProduccion[] = archivosProduccion.flatMap(
            (a) => (a.payload as ParseInformeProduccionResult).filas,
          );
          const resumen = await historicoImport.importar.mutateAsync({ filas });
          marcar("informe-produccion", {
            estado: "ok",
            mensaje: `${resumen.filasInsertadas} fila(s) insertada(s) en ${resumen.diasNuevos} día(s), ${resumen.filasExistentes} ya existente(s) (fecha+lote), ${resumen.diasSinNuevas} día(s) sin filas nuevas${resumen.horasRellenadas > 0 ? `, ${resumen.horasRellenadas} hora(s) de inicio rellenada(s)/corregida(s)` : ""}.`,
          });
        } catch (e) {
          marcar("informe-produccion", { estado: "error", mensaje: errorMessage(e) });
        }
      }

      // ─── palets-campana (SIEMPRE reemplazarSinId:false en la bandeja) ──
      const archivosPalets = porTipo.get("palets-campana");
      if (archivosPalets?.length) {
        marcar("palets-campana", { estado: "en-curso" });
        try {
          const filas: FilaInformePalets[] = archivosPalets.flatMap(
            (a) => (a.payload as ParseInformePaletsResult).filas,
          );
          const resumen = await historicoImportPalets.importar.mutateAsync({ filas, reemplazarSinId: false });
          marcar("palets-campana", {
            estado: "ok",
            mensaje: `${resumen.paletsInsertados} palet(s) nuevo(s) en ${resumen.diasNuevos} día(s), ${resumen.paletsBackfilled} backfill en ${resumen.diasBackfill} día(s), ${resumen.paletsSinCasar} sin casar. Para reemplazar palets sin nº usa Histórico → Palets.`,
          });
        } catch (e) {
          marcar("palets-campana", { estado: "error", mensaje: errorMessage(e) });
        }
      }

      // ─── camaras-externas ───────────────────────────────────────────────
      const archivosCamaras = porTipo.get("camaras-externas");
      if (archivosCamaras?.length) {
        marcar("camaras-externas", { estado: "en-curso" });
        try {
          const registros: CamionCamaraExterna[] = archivosCamaras.flatMap(
            (a) => (a.payload as ParseRegistroCamaraResult).registros,
          );
          const resumen = await camarasExternas.importar.mutateAsync(registros);
          marcar("camaras-externas", { estado: "ok", mensaje: `${resumen.importados} camión(es) importado(s)/actualizado(s).` });
        } catch (e) {
          marcar("camaras-externas", { estado: "error", mensaje: errorMessage(e) });
        }
      }

      // ─── informe-productor (mismo flujo que EconomicoFruta.tsx) ────────
      const archivosProductor = porTipo.get("informe-productor");
      if (archivosProductor?.length) {
        marcar("informe-productor", { estado: "en-curso" });
        try {
          let nProductores = 0;
          let nVariedades = 0;
          for (const a of archivosProductor) {
            const informe = a.payload as InformeTamanosClases;
            if (!informe.productor || informe.variedades.length === 0) continue;
            const resuelto = resolveProductorGroupKey(informe.productor, null, aliasPorNombreNormalizado);
            await calidadReferencias.guardarReferencias.mutateAsync(
              informe.variedades.map((v) => ({
                productorId: resuelto.productorId ?? null,
                productorNombre: informe.productor as string,
                variedad: v.variedad,
                kgTotal: v.kgTotal,
                kgPodrido: v.kgPodrido,
              })),
            );
            nProductores += 1;
            nVariedades += informe.variedades.length;
          }
          marcar("informe-productor", {
            estado: "ok",
            mensaje: `${nProductores} productor(es), ${nVariedades} variedad(es) guardada(s).`,
          });
        } catch (e) {
          marcar("informe-productor", { estado: "error", mensaje: errorMessage(e) });
        }
      }
    })().finally(() => {
      // La página vuelve a aceptar tandas. Sin guard de `cancelado`: como el
      // padre bloquea nuevas tandas mientras ocupada=true, este finally solo
      // puede llegar con el componente aún montado o tras un desmontaje sin
      // sucesor en marcha — en ambos casos liberar es lo correcto.
      if (hayTrabajo) onOcupadaChange?.(false);
    });

    return () => {
      cancelado = true;
    };
    // Se ejecuta una única vez al montar: el padre remonta este componente
    // (key={batchId}) por cada tanda de clasificación nueva.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const grupos = GRUPOS_ORDEN
    .map((tipo) => ({ tipo, archivos: porTipo.get(tipo) ?? [] }))
    .filter((g) => g.archivos.length > 0);

  if (grupos.length === 0) {
    return <p className="text-sm text-muted-foreground">Ningún archivo de este tipo en esta tanda.</p>;
  }

  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {grupos.map(({ tipo, archivos }) => {
        const estado = resultados[tipo];
        const n = archivos.reduce((s, a) => s + a.n, 0);
        return (
          <Card key={tipo} className="glass-accented overflow-hidden">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">{TIPO_BANDEJA_LABEL[tipo]}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <p className="text-xs text-muted-foreground">
                {formatNumber(archivos.length)} archivo(s) · {formatNumber(n)} unidad(es)
              </p>
              {!estado || estado.estado === "en-curso" ? (
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Importando…
                </p>
              ) : estado.estado === "ok" ? (
                <p className="flex items-start gap-1.5 text-xs text-success">
                  <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" /> <span>{estado.mensaje}</span>
                </p>
              ) : (
                <p className="flex items-start gap-1.5 text-xs text-destructive">
                  <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> <span>{estado.mensaje}</span>
                </p>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
