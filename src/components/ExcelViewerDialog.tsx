import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Download, Loader2, FileSpreadsheet } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import ExcelPreviewer from "./ExcelPreviewer";
import { PreviewSkeleton } from "./excel-preview";
import { formatSize, parseSheet, parseWorkbookBytes, type RawSheetGrid } from "@/lib/excelPreview";

// Re-export para compatibilidad: PartDetailArchivos y PartFilePreviewDialog
// importan formatSize desde aquí. La implementación vive en la lib.
export { formatSize } from "@/lib/excelPreview";

interface Archivo {
  file_name: string | null;
  file_path: string | null;
  mime_type: string | null;
  file_size: number | null;
}

interface ExcelViewerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  archivo: Archivo | null;
}

/**
 * Diálogo de previsualización de Excel adjunto a un parte. Descarga el
 * archivo del bucket "partes-archivos" y lo muestra con el kit excel-preview.
 * Todo el parseo (reparación de ZIP, celdas combinadas, detección de
 * cabecera, tipado de columnas, filas decorativas) vive en
 * src/lib/excelPreview.ts — mismo pipeline que ExcelViewerPage (/ver-excel).
 * Las trazas de diagnóstico se activan con ?debug en la URL (dlog de la lib).
 */
export function ExcelViewerDialog({ open, onOpenChange, archivo }: ExcelViewerDialogProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [grids, setGrids] = useState<RawSheetGrid[]>([]);
  const [activeSheet, setActiveSheet] = useState(0);
  const [blob, setBlob] = useState<Blob | null>(null);

  const loadFile = useCallback(async () => {
    if (!archivo?.file_path) return;
    setLoading(true);
    setError(null);
    setGrids([]);
    setActiveSheet(0);
    setBlob(null);

    try {
      const { data, error: dlError } = await supabase.storage
        .from("partes-archivos")
        .download(archivo.file_path);

      if (dlError || !data) throw new Error(dlError?.message ?? "No se pudo descargar el archivo");

      setBlob(data);
      const buffer = await data.arrayBuffer();
      const parsed = parseWorkbookBytes(new Uint8Array(buffer), archivo.file_name ?? "archivo");
      setGrids(parsed);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error desconocido");
    } finally {
      setLoading(false);
    }
  }, [archivo?.file_path, archivo?.file_name]);

  useEffect(() => {
    if (open && archivo) loadFile();
  }, [open, archivo, loadFile]);

  // Parseo estructurado SOLO de la hoja activa (memoizado): los archivos
  // reales llegan a 39.000 filas y no tiene sentido estructurar hojas que
  // no se están viendo.
  const activeParsed = useMemo(() => {
    const sheet = grids[activeSheet];
    if (!sheet) return null;
    return parseSheet(sheet.grid, archivo?.file_name ?? "archivo", sheet.name);
  }, [grids, activeSheet, archivo?.file_name]);

  function handleDownload() {
    if (!blob || !archivo?.file_name) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = archivo.file_name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[min(1500px,96vw)] max-h-[95vh] flex flex-col p-0">
        <DialogHeader className="shrink-0 border-b border-[var(--glass-border)] px-5 py-4">
          <div className="flex items-center justify-between pr-8">
            <div className="flex items-center gap-2 min-w-0">
              <FileSpreadsheet className="h-5 w-5 text-primary shrink-0" />
              <div className="min-w-0">
                <DialogTitle className="truncate">{archivo?.file_name ?? "Archivo"}</DialogTitle>
                <DialogDescription>
                  {archivo?.file_size ? formatSize(archivo.file_size) : ""}
                  {grids.length > 0 ? ` · ${grids.length} hoja${grids.length !== 1 ? "s" : ""}` : ""}
                </DialogDescription>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleDownload}
              disabled={!blob}
              className="shrink-0 glass glass-hover"
            >
              <Download className="h-3.5 w-3.5 mr-1.5" />
              Descargar
            </Button>
          </div>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-hidden px-4 pb-4 pt-3">
          {loading && (
            <div className="h-full overflow-hidden">
              <div className="flex items-center justify-center pb-3">
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                <span className="ml-2 text-sm text-muted-foreground">Cargando archivo…</span>
              </div>
              <PreviewSkeleton />
            </div>
          )}

          {!loading && error && (
            <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive">
              {error}
            </div>
          )}

          {!loading && !error && activeParsed && (
            <div className="h-full min-h-0 overflow-y-auto scrollbar-midas">
              <ExcelPreviewer
                data={activeParsed}
                sheets={grids.map((g) => ({ name: g.name }))}
                activeSheetIndex={activeSheet}
                onSheetChange={setActiveSheet}
                mimeType={archivo?.mime_type}
              />
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
