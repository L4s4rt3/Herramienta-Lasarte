import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { ArrowLeft, FileSpreadsheet, Download, Loader2 } from "lucide-react";
import ExcelPreviewer from "@/components/ExcelPreviewer";
import {
  type SheetData,
  formatSize,
  repairXlsx,
  parseWorkbookToSheets,
  isValidContent,
  parseSheetToStructured,
} from "@/lib/excel-parser";
import * as XLSX from "xlsx";

export default function ExcelViewerPage() {
  const { fileId } = useParams();
  const navigate = useNavigate();

  const [fileName, setFileName] = useState("");
  const [fileSize, setFileSize] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sheets, setSheets] = useState<SheetData[]>([]);
  const [activeSheet, setActiveSheet] = useState("0");
  const [blob, setBlob] = useState<Blob | null>(null);

  const loadFile = useCallback(async () => {
    if (!fileId) return;
    setLoading(true);
    setError(null);

    try {
      const { data: fileMeta, error: metaError } = await supabase
        .from("partes_archivos")
        .select("file_name, file_path, file_size")
        .eq("id", fileId)
        .single();

      if (metaError || !fileMeta) throw new Error(metaError?.message ?? "Archivo no encontrado");

      setFileName(fileMeta.file_name ?? "Archivo");
      setFileSize(fileMeta.file_size);

      if (!fileMeta.file_path) throw new Error("El archivo no tiene ruta de almacenamiento");

      const { data, error: dlError } = await supabase.storage
        .from("partes-archivos")
        .download(fileMeta.file_path);

      if (dlError || !data) throw new Error(dlError?.message ?? "No se pudo descargar el archivo");

      setBlob(data);
      const buffer = await data.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      const cleanBytes = repairXlsx(bytes);
      let parsed: SheetData[] = [];

      for (const opts of [
        { type: "array" } as const,
        { type: "array", cellDates: true, cellNF: false } as const,
        { type: "array", raw: true } as const,
        { type: "array", dense: true, cellDates: true, raw: true } as const,
      ]) {
        if (isValidContent(parsed)) break;
        try {
          const wb = XLSX.read(cleanBytes, opts);
          const result = parseWorkbookToSheets(wb);
          if (isValidContent(result)) parsed = result;
        } catch { /* next */ }
      }

      if (!isValidContent(parsed)) {
        const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
        if (text.includes(",") || text.includes(";") || text.includes("\t")) {
          const sep = text.includes(";") ? ";" : text.includes("\t") ? "\t" : ",";
          const lines = text.split(/\r?\n/).filter((l) => l.trim());
          if (lines.length >= 2) {
            const headers = lines[0].split(sep).map((h) => h.trim());
            const dataRows = lines.slice(1).map((l) => l.split(sep).map((c) => c.trim()));
            parsed = [{ name: "CSV", headers, rows: dataRows }];
          }
        }
      }

      if (!isValidContent(parsed)) {
        const looksLikeZip = bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
        throw new Error(
          `No se pudo leer el archivo.` +
          (looksLikeZip
            ? " El XLSX está corrupto. Ábrelo en Excel y guárdalo de nuevo."
            : " No parece un Excel válido.")
        );
      }

      setSheets(parsed);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error desconocido");
    } finally {
      setLoading(false);
    }
  }, [fileId]);

  useEffect(() => {
    loadFile();
  }, [loadFile]);

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

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 border-b border-[var(--glass-border)] bg-[var(--glass-bg-strong)] backdrop-blur-xl">
        <div className="flex items-center justify-between px-4 py-3 max-w-7xl mx-auto">
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={() => navigate(-1)}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-[var(--glass-bg)] hover:text-foreground transition-colors"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
            <FileSpreadsheet className="h-5 w-5 text-primary shrink-0" />
            <div className="min-w-0">
              <h1 className="text-sm font-semibold truncate">{fileName}</h1>
              {fileSize != null && (
                <p className="text-xs text-muted-foreground">
                  {formatSize(fileSize)}
                  {sheets.length > 0 && ` · ${sheets.length} hoja${sheets.length !== 1 ? "s" : ""}`}
                </p>
              )}
            </div>
          </div>
          <button
            onClick={handleDownload}
            disabled={!blob}
            className="inline-flex items-center gap-1.5 rounded-xl border border-[var(--glass-border)] bg-[var(--glass-bg)] px-3 py-1.5 text-xs font-medium text-foreground hover:bg-[var(--glass-bg-strong)] transition-colors disabled:opacity-50"
          >
            <Download className="h-3.5 w-3.5" />
            Descargar
          </button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-4">
        {loading && (
          <div className="flex items-center justify-center py-24">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
            <span className="ml-2 text-sm text-muted-foreground">Cargando archivo…</span>
          </div>
        )}

        {error && (
          <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive">
            {error}
          </div>
        )}

        {!loading && !error && sheets.length > 1 && (
          <div className="flex gap-1 mb-4 overflow-x-auto">
            {sheets.map((s, i) => (
              <button
                key={i}
                onClick={() => setActiveSheet(String(i))}
                className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                  activeSheet === String(i)
                    ? "bg-primary text-primary-foreground"
                    : "bg-[var(--glass-bg)] text-muted-foreground hover:text-foreground border border-[var(--glass-border)]"
                }`}
              >
                {s.name}
              </button>
            ))}
          </div>
        )}

        {!loading && !error && sheets.length > 0 && (
          <div className="rounded-xl border border-[var(--glass-border)] bg-[var(--glass-bg)]">
            {sheets.map((s, i) => {
              if (String(i) !== activeSheet) return null;
              const parsed = parseSheetToStructured(s, fileName);
              return (
                <div key={i} className="p-4">
                  <ExcelPreviewer data={parsed} />
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
