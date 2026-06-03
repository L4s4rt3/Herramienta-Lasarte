import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import * as XLSX from "xlsx";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Download, Loader2, FileSpreadsheet } from "lucide-react";
import ExcelPreviewer from "@/components/ExcelPreviewer";
import { parseSheetToStructured, formatSize, formatCell } from "@/components/ExcelViewerDialog";

interface SheetData { name: string; headers: string[]; rows: string[][] }

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

      // Limpiar prefijo basura
      let start = 0;
      while (start < bytes.length - 4) {
        const b0 = bytes[start], b1 = bytes[start + 1], b2 = bytes[start + 2], b3 = bytes[start + 3];
        if (b0 === 0x50 && b1 === 0x4b && b2 === 0x03 && b3 === 0x04) break;
        start++;
      }
      const cleaned = start > 0 ? bytes.slice(start) : bytes;
      const cleanBytes = new Uint8Array(cleaned);

      // Convertir DEFLATE64 → DEFLATE
      for (let i = 0; i < cleanBytes.length - 30; i++) {
        if (cleanBytes[i] === 0x50 && cleanBytes[i + 1] === 0x4b && (cleanBytes[i + 2] === 0x03 || cleanBytes[i + 2] === 0x01) && cleanBytes[i + 3] === 0x04) {
          const method = cleanBytes[i + 8] | (cleanBytes[i + 9] << 8);
          if (method === 9) { cleanBytes[i + 8] = 8; cleanBytes[i + 9] = 0; }
        }
      }

      // Buscar EOCD
      let eocdPos = -1;
      const searchStart = Math.max(0, cleanBytes.length - 66000);
      for (let i = cleanBytes.length - 22; i >= searchStart; i--) {
        if (cleanBytes[i] === 0x50 && cleanBytes[i + 1] === 0x4b && cleanBytes[i + 2] === 0x05 && cleanBytes[i + 3] === 0x06) {
          eocdPos = i; break;
        }
      }
      if (eocdPos < 0) {
        const eocd = new Uint8Array(22);
        eocd[0] = 0x50; eocd[1] = 0x4b; eocd[2] = 0x05; eocd[3] = 0x06;
        const out = new Uint8Array(cleanBytes.length + 22);
        out.set(cleanBytes); out.set(eocd, cleanBytes.length);
        // fall through, xlsx puede manejar esto
      }

      let parsed: SheetData[] = [];

      const parseWorkbook = (wb: XLSX.WorkBook): SheetData[] => {
        return wb.SheetNames.map((name) => {
          const ws = wb.Sheets[name];
          const json = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "", raw: true });
          const headers = json.length > 0 ? json[0].map((h) => formatCell(h)) : [];
          const rows = json.slice(1).map((row) => row.map((c) => formatCell(c)));
          return { name, headers, rows };
        });
      };

      for (const opts of [
        { type: "array" },
        { type: "array", cellDates: true, cellNF: false },
        { type: "array", raw: true },
        { type: "array", dense: true, cellDates: true, raw: true },
      ] as const) {
        if (parsed.length > 0 && parsed.some((s) => s.rows.length > 0 || s.headers.some((h) => h))) break;
        try {
          const wb = XLSX.read(cleanBytes, opts);
          parsed = parseWorkbook(wb);
        } catch { /* next */ }
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
