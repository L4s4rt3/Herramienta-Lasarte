/**
 * AnalisisInformes.tsx — Página independiente de Análisis de Informes.
 *
 * Permite subir los Excel del calibrador (producción, palets, producto, calibres)
 * y genera:
 *   1. Dashboard visual con KPIs, gráficos y tablas (AnalisisDashboard)
 *   2. Reporte Operativo Ejecutivo en Markdown (ReporteOperativo)
 *
 * Separada de los Partes diarios para tener un espacio dedicado al análisis.
 */
import { useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import { Upload, BarChart3, FileText, Loader2, Trash2, X } from "lucide-react";
import { parseInforme, type ParsedInforme } from "@/lib/parsers";
import { computeAnalisisDesdeInformes, type AnalisisDia } from "@/lib/analisis";
import { AnalisisDashboard } from "@/components/AnalisisDashboard";
import { ReporteOperativo } from "@/components/ReporteOperativo";
import { cn } from "@/lib/utils";

type Vista = "dashboard" | "reporte";
type Estado = "idle" | "parseando" | "calculando" | "listo" | "error";

export default function AnalisisInformes() {
  const [archivos, setArchivos] = useState<File[]>([]);
  const [estado, setEstado] = useState<Estado>("idle");
  const [progreso, setProgreso] = useState("");
  const [analisis, setAnalisis] = useState<AnalisisDia | null>(null);
  const [vista, setVista] = useState<Vista>("dashboard");

  // ── Agregar archivos ──────────────────────────────────────────────────────
  const handleFiles = useCallback((fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    const nuevos = Array.from(fileList).filter(
      (f) => f.name.endsWith(".xlsx") || f.name.endsWith(".xls") || f.name.endsWith(".csv")
    );
    if (nuevos.length === 0) {
      toast({ title: "Formato no soportado", description: "Solo se aceptan archivos .xlsx, .xls o .csv", variant: "destructive" });
      return;
    }
    setArchivos((prev) => [...prev, ...nuevos]);
    // Reset analysis when new files are added
    setAnalisis(null);
    setEstado("idle");
  }, []);

  const removeFile = (index: number) => {
    setArchivos((prev) => prev.filter((_, i) => i !== index));
    setAnalisis(null);
    setEstado("idle");
  };

  const clearAll = () => {
    setArchivos([]);
    setAnalisis(null);
    setEstado("idle");
    setProgreso("");
  };

  // ── Ejecutar análisis ─────────────────────────────────────────────────────
  const ejecutarAnalisis = useCallback(async () => {
    if (archivos.length === 0) {
      toast({ title: "Sin archivos", description: "Sube al menos un informe Excel", variant: "destructive" });
      return;
    }

    setEstado("parseando");
    setAnalisis(null);

    // Paso 1: Parsear archivos
    const informes: ParsedInforme[] = [];

    for (const file of archivos) {
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
      toast({ title: "Sin informes válidos", description: "Ningún archivo pudo parsearse correctamente", variant: "destructive" });
      setEstado("error");
      setProgreso("");
      return;
    }

    // Paso 2: Calcular KPIs
    setEstado("calculando");
    setProgreso("Calculando KPIs y alertas…");

    try {
      const resultado = computeAnalisisDesdeInformes(informes);
      setAnalisis(resultado);
      setEstado("listo");
      setProgreso("");

      toast({
        title: "Análisis completado",
        description: `${resultado.alertas.length} alertas · ${resultado.kpis.pct_exportacion}% exportación · ${informes.length} informes procesados`,
      });
    } catch (err) {
      console.error("Error en computeAnalisis:", err);
      toast({ title: "Error al calcular KPIs", description: String(err), variant: "destructive" });
      setEstado("error");
      setProgreso("");
    }
  }, [archivos]);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Análisis de Informes</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Sube los informes Excel del calibrador y obtén KPIs, alertas y reporte ejecutivo
          </p>
        </div>
        {analisis && (
          <div className="flex items-center gap-1 p-1 bg-muted rounded-lg">
            <button
              onClick={() => setVista("dashboard")}
              className={cn(
                "px-3 py-1.5 rounded-md text-xs font-medium transition-colors flex items-center gap-1.5",
                vista === "dashboard"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <BarChart3 className="h-3.5 w-3.5" />
              Dashboard
            </button>
            <button
              onClick={() => setVista("reporte")}
              className={cn(
                "px-3 py-1.5 rounded-md text-xs font-medium transition-colors flex items-center gap-1.5",
                vista === "reporte"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <FileText className="h-3.5 w-3.5" />
              Reporte Ejecutivo
            </button>
          </div>
        )}
      </div>

      {/* Upload zone */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Upload className="h-4 w-4" />
            Informes del calibrador
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Drop zone */}
          <label
            className={cn(
              "flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-8 cursor-pointer transition-colors",
              "hover:border-primary/50 hover:bg-primary/5",
              estado === "parseando" || estado === "calculando" ? "pointer-events-none opacity-60" : ""
            )}
            onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
            onDrop={(e) => { e.preventDefault(); e.stopPropagation(); handleFiles(e.dataTransfer.files); }}
          >
            <input
              type="file"
              multiple
              accept=".xlsx,.xls,.csv"
              className="hidden"
              disabled={estado === "parseando" || estado === "calculando"}
              onChange={(e) => { handleFiles(e.target.files); e.target.value = ""; }}
            />
            <Upload className="h-8 w-8 text-muted-foreground/50" />
            <div className="text-center">
              <p className="text-sm font-medium">Arrastra archivos aquí o haz clic para seleccionar</p>
              <p className="text-xs text-muted-foreground mt-1">
                Informe_produccion.xlsx · palets_*.xlsx · Informe_producto.xlsx · Informe_tamaños*.xlsx
              </p>
            </div>
          </label>

          {/* File list */}
          {archivos.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium text-muted-foreground">
                  {archivos.length} archivo{archivos.length !== 1 ? "s" : ""} seleccionado{archivos.length !== 1 ? "s" : ""}
                </p>
                <Button variant="ghost" size="sm" onClick={clearAll} className="h-6 text-xs text-muted-foreground">
                  <Trash2 className="h-3 w-3 mr-1" />
                  Limpiar todo
                </Button>
              </div>
              <div className="flex flex-wrap gap-2">
                {archivos.map((f, i) => (
                  <Badge key={i} variant="secondary" className="gap-1.5 pr-1">
                    <FileText className="h-3 w-3" />
                    <span className="max-w-[180px] truncate text-xs">{f.name}</span>
                    <button
                      onClick={() => removeFile(i)}
                      className="ml-0.5 rounded-full p-0.5 hover:bg-destructive/20 hover:text-destructive"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {/* Action button */}
          <div className="flex items-center gap-3">
            <Button
              onClick={ejecutarAnalisis}
              disabled={archivos.length === 0 || estado === "parseando" || estado === "calculando"}
              size="lg"
            >
              {(estado === "parseando" || estado === "calculando") ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {progreso || "Procesando…"}
                </>
              ) : (
                <>
                  <BarChart3 className="h-4 w-4" />
                  Analizar informes
                </>
              )}
            </Button>
            {estado === "listo" && (
              <Badge className="bg-success/10 text-success border-success/30 border">
                Análisis completado
              </Badge>
            )}
            {estado === "error" && (
              <Badge variant="destructive">Error en análisis</Badge>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Results */}
      {analisis && vista === "dashboard" && (
        <AnalisisDashboard analisis={analisis} />
      )}

      {analisis && vista === "reporte" && (
        <ReporteOperativo analisis={analisis} />
      )}
    </div>
  );
}
