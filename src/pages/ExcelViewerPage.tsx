import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import * as XLSX from "xlsx";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Download, FileSpreadsheet, AlertTriangle } from "lucide-react";
import ExcelPreviewer from "@/components/ExcelPreviewer";
import { parseSheetToStructured, formatSize, formatCell, repairXlsx } from "@/components/ExcelViewerDialog";
import { PreviewSkeleton } from "@/components/excel-preview";

interface SheetData { name: string; headers: string[]; rows: string[][] }

export default function ExcelViewerPage() {
  const { fileId } = useParams();
  const navigate = useNavigate();

  const [fileName, setFileName] = useState("");
  const [fileSize, setFileSize] = useState<number | null>(null);
  const [uploadedAt, setUploadedAt] = useState<string | null>(null);
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
      const bytes = new Uint8Array(buffer);
      const cleanBytes = repairXlsx(bytes);
      const looksLikeCsvFile = /\.csv$/i.test(resolvedName);

      const isValidContent = (sheets: SheetData[]): boolean => {
        if (sheets.length === 0) return false;
        for (const sheet of sheets) {
          let cellsWithContent = 0;
          let suspicious = 0;
          const check = (c: string) => {
            const t = c?.trim() ?? "";
            if (!t) return;
            cellsWithContent++;
            if (t.length > 80 || /^[A-F0-9]{16,}$/i.test(t) || /^[A-Za-z0-9+/=]{24,}$/.test(t)) {
              suspicious++;
            }
          };
          for (const h of sheet.headers) check(h);
          for (const row of sheet.rows) for (const cell of row) check(cell);
          if (cellsWithContent >= 3 && suspicious / cellsWithContent < 0.3) return true;
        }
        return false;
      };

      const parseWorkbook = (wb: XLSX.WorkBook): SheetData[] => {
        return wb.SheetNames.map((name) => {
          const ws = wb.Sheets[name];
          const json = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "", raw: true });
          const headers = json.length > 0 ? json[0].map((h) => formatCell(h)) : [];
          const rows = json.slice(1).map((row) => row.map((c) => formatCell(c)));
          return { name, headers, rows };
        });
      };

      let parsed: SheetData[] = [];

      // Si el archivo es .csv, xlsx ya sabe parsear texto CSV directamente
      // via type: "string" — mas barato y fiable que el fallback manual de
      // separadores mas abajo.
      if (looksLikeCsvFile) {
        try {
          const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
          const wb = XLSX.read(text, { type: "string", raw: true });
          const csvParsed = parseWorkbook(wb);
          if (isValidContent(csvParsed)) parsed = csvParsed;
        } catch { /* sigue a los intentos binarios */ }
      }

      const parseAttempts: Array<[string, Parameters<typeof XLSX.read>[1]]> = [
        ["Normal", { type: "array" }],
        ["DEFLATE64 repair", { type: "array" }],
        ["cellDates", { type: "array", cellDates: true, cellNF: false }],
        ["raw mode", { type: "array", raw: true }],
        ["dense mode", { type: "array", dense: true, cellDates: true, raw: true }],
      ];
      for (const [, opts] of parseAttempts) {
        if (isValidContent(parsed)) break;
        try {
          const wb = XLSX.read(cleanBytes, opts);
          const result = parseWorkbook(wb);
          if (isValidContent(result)) parsed = result;
        } catch { /* next */ }
      }

      if (!isValidContent(parsed)) {
        const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
        if (!text.trim().startsWith("<") && (text.includes(",") || text.includes(";") || text.includes("\t"))) {
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
        const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
        if (text.includes("<table")) {
          const doc = new DOMParser().parseFromString(text, "text/html");
          const tables = doc.querySelectorAll("table");
          if (tables.length) {
            parsed = Array.from(tables).map((table, idx) => {
              const headerCells = Array.from(table.querySelectorAll("thead th, tr:first-child th, tr:first-child td"));
              const headers = headerCells.map((th) => th.textContent?.trim() ?? "");
              const dataRows = Array.from(table.querySelectorAll("tbody tr, tr")).filter((tr) => !tr.querySelector("th"));
              const rows = dataRows.map((tr) => Array.from(tr.querySelectorAll("td")).map((td) => td.textContent?.trim() ?? ""));
              return { name: `Tabla ${idx + 1}`, headers, rows };
            });
          }
        }
      }

      if (!isValidContent(parsed)) {
        const looksLikeZip = bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
        throw new Error(
          `No se pudo leer "${resolvedName}"` +
          (looksLikeZip ? ". El archivo XLSX está corrupto. Ábrelo en Excel y guárdalo de nuevo." : ". No parece un Excel válido.")
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

      {!loading && !error && sheets.length > 0 && (
        <div className="glass rounded-xl p-3 sm:p-4">
          {sheets.map((s, i) => {
            if (String(i) !== activeSheet) return null;
            const parsed = parseSheetToStructured(s, fileName);
            return (
              <ExcelPreviewer
                key={i}
                data={parsed}
                sheets={sheets}
                activeSheetIndex={i}
                onSheetChange={(idx) => setActiveSheet(String(idx))}
                onDownload={handleDownload}
                downloadDisabled={!blob}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
