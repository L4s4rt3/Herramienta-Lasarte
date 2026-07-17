import { useState, useEffect, useCallback, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Download, FileSpreadsheet, AlertTriangle } from "lucide-react";
import ExcelPreviewer from "@/components/ExcelPreviewer";
import { PreviewSkeleton } from "@/components/excel-preview";
import { formatSize, parseSheet, parseWorkbookBytes, type RawSheetGrid } from "@/lib/excelPreview";

/**
 * Página /ver-excel/:fileId — visor a pantalla completa de un Excel adjunto a
 * un parte. Mismo pipeline de parseo que ExcelViewerDialog (todo en
 * src/lib/excelPreview.ts); trazas de diagnóstico con ?debug en la URL.
 */
export default function ExcelViewerPage() {
  const { fileId } = useParams();
  const navigate = useNavigate();

  const [fileName, setFileName] = useState("");
  const [fileSize, setFileSize] = useState<number | null>(null);
  const [uploadedAt, setUploadedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [grids, setGrids] = useState<RawSheetGrid[]>([]);
  const [activeSheet, setActiveSheet] = useState(0);
  const [blob, setBlob] = useState<Blob | null>(null);

  const loadFile = useCallback(async () => {
    if (!fileId) return;
    setLoading(true);
    setError(null);

    try {
      const { data: fileMeta, error: metaError } = await supabase
        .from("partes_archivos")
        .select("file_name, file_path, file_size, uploaded_at")
        .eq("id", fileId)
        .single();

      if (metaError || !fileMeta) throw new Error(metaError?.message ?? "Archivo no encontrado");

      const resolvedName = fileMeta.file_name ?? "Archivo";
      setFileName(resolvedName);
      setFileSize(fileMeta.file_size);
      setUploadedAt(fileMeta.uploaded_at ?? null);

      if (!fileMeta.file_path) throw new Error("El archivo no tiene ruta de almacenamiento");

      const { data, error: dlError } = await supabase.storage
        .from("partes-archivos")
        .download(fileMeta.file_path);

      if (dlError || !data) throw new Error(dlError?.message ?? "No se pudo descargar el archivo");

      setBlob(data);
      const buffer = await data.arrayBuffer();
      const parsed = parseWorkbookBytes(new Uint8Array(buffer), resolvedName);
      setGrids(parsed);
      setActiveSheet(0);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error desconocido");
    } finally {
      setLoading(false);
    }
  }, [fileId]);

  useEffect(() => {
    loadFile();
  }, [loadFile]);

  // Parseo estructurado SOLO de la hoja activa (memoizado): los archivos
  // reales llegan a 39.000 filas.
  const activeParsed = useMemo(() => {
    const sheet = grids[activeSheet];
    if (!sheet) return null;
    return parseSheet(sheet.grid, fileName || "archivo", sheet.name);
  }, [grids, activeSheet, fileName]);

  function handleDownload() {
    if (!blob || !fileName) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  const uploadedAtLabel = uploadedAt
    ? new Date(uploadedAt).toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit", year: "numeric" })
    : null;

  const subtitleParts = [
    fileName ? fileName.split(".").pop()?.toUpperCase() : null,
    fileSize != null ? formatSize(fileSize) : null,
    uploadedAtLabel,
  ].filter(Boolean);

  return (
    <div className="page-shell p-3 sm:p-4 lg:p-6">
      <header className="page-header">
        <div className="flex items-start gap-3 min-w-0">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate(-1)}
            className="shrink-0"
            aria-label="Volver"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="min-w-0">
            <div className="flex items-center gap-2 min-w-0">
              <FileSpreadsheet className="h-5 w-5 text-primary shrink-0" />
              <h1 className="page-title truncate">{fileName || "Cargando…"}</h1>
            </div>
            {subtitleParts.length > 0 && (
              <p className="page-subtitle">{subtitleParts.join(" · ")}</p>
            )}
          </div>
        </div>
        <Button
          variant="outline"
          onClick={handleDownload}
          disabled={!blob}
          className="glass glass-hover"
        >
          <Download className="h-4 w-4 mr-1.5" />
          Descargar
        </Button>
      </header>

      {loading && <PreviewSkeleton />}

      {!loading && error && (
        <div className="glass-accented rounded-xl p-6 flex flex-col items-center gap-3 text-center">
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-destructive/10 text-destructive">
            <AlertTriangle className="h-5 w-5" />
          </span>
          <div className="space-y-1 max-w-lg">
            <p className="text-sm font-semibold text-foreground">No se pudo previsualizar el archivo</p>
            <p className="text-sm text-muted-foreground">{error}</p>
          </div>
          <Button
            variant="outline"
            onClick={handleDownload}
            disabled={!blob}
            className="glass glass-hover mt-1"
          >
            <Download className="h-4 w-4 mr-1.5" />
            Descargar archivo original
          </Button>
        </div>
      )}

      {!loading && !error && activeParsed && (
        <div className="glass rounded-xl p-3 sm:p-4">
          <ExcelPreviewer
            data={activeParsed}
            sheets={grids.map((g) => ({ name: g.name }))}
            activeSheetIndex={activeSheet}
            onSheetChange={setActiveSheet}
            onDownload={handleDownload}
            downloadDisabled={!blob}
          />
        </div>
      )}
    </div>
  );
}
