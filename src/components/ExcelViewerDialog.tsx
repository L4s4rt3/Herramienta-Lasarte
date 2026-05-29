import { useState, useEffect, useCallback } from "react";
import * as XLSX from "xlsx";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Download, Loader2, FileSpreadsheet } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

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

type SheetData = { name: string; headers: string[]; rows: string[][] };

function formatSize(bytes: number | null): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "Sí" : "No";
  if (value instanceof Date) return value.toLocaleDateString("es-ES");
  return String(value);
}

function repairXlsx(bytes: Uint8Array): Uint8Array {
  // First check if file starts with ZIP magic bytes
  if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b || bytes[2] !== 0x03 || bytes[3] !== 0x04) {
    return bytes; // Not a ZIP file, return as-is
  }

  // Make a copy to avoid mutating the original
  const buf = new Uint8Array(bytes);
  let needsRepair = false;

  // Check local file headers (PK\x03\x04) for DEFLATE64 (method 9)
  for (let i = 0; i < buf.length - 30; i++) {
    if (buf[i] === 0x50 && buf[i + 1] === 0x4b && buf[i + 2] === 0x03 && buf[i + 3] === 0x04) {
      const method = buf[i + 8] | (buf[i + 9] << 8);
      if (method === 9) {
        needsRepair = true;
        buf[i + 8] = 8;
        buf[i + 9] = 0;
      }
      const fnLen = buf[i + 26] | (buf[i + 27] << 8);
      const exLen = buf[i + 28] | (buf[i + 29] << 8);
      i += 30 + fnLen + exLen - 1;
    }
  }

  // Only repair central directory if we found DEFLATE64
  if (needsRepair) {
    for (let i = 0; i < buf.length - 46; i++) {
      if (buf[i] === 0x50 && buf[i + 1] === 0x4b && buf[i + 2] === 0x01 && buf[i + 3] === 0x02) {
        const method = buf[i + 10] | (buf[i + 11] << 8);
        if (method === 9) {
          buf[i + 10] = 8;
          buf[i + 11] = 0;
        }
        const fnLen = buf[i + 28] | (buf[i + 29] << 8);
        const exLen = buf[i + 30] | (buf[i + 31] << 8);
        const cmLen = buf[i + 32] | (buf[i + 33] << 8);
        i += 46 + fnLen + exLen + cmLen - 1;
      }
    }
  }

  return buf;
}

export function ExcelViewerDialog({ open, onOpenChange, archivo }: ExcelViewerDialogProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sheets, setSheets] = useState<SheetData[]>([]);
  const [activeSheet, setActiveSheet] = useState("0");
  const [blob, setBlob] = useState<Blob | null>(null);

  const loadFile = useCallback(async () => {
    if (!archivo?.file_path) return;
    setLoading(true);
    setError(null);
    setSheets([]);
    setActiveSheet("0");
    setBlob(null);

    try {
      const { data, error: dlError } = await supabase.storage
        .from("partes-archivos")
        .download(archivo.file_path);

      if (dlError || !data) throw new Error(dlError?.message ?? "No se pudo descargar el archivo");

      setBlob(data);
      const buffer = await data.arrayBuffer();
      const bytes = new Uint8Array(buffer);

      // Función para verificar si el contenido parseado es válido
      const isValidContent = (sheets: SheetData[]): boolean => {
        if (sheets.length === 0) return false;
        
        // Verificar que al menos una hoja tenga contenido válido
        for (const sheet of sheets) {
          const allContent = [
            ...sheet.headers,
            ...sheet.rows.flat()
          ].join("");
          
          // Si el contenido contiene muchos caracteres de control o binarios, es inválido
          const controlChars = (allContent.match(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]/g) || []).length;
          const totalChars = allContent.length;
          
          if (totalChars > 0 && controlChars / totalChars < 0.1) {
            return true; // Al menos una hoja tiene contenido válido
          }
        }
        return false;
      };

      // Función para parsear el workbook
      const parseWorkbook = (wb: XLSX.WorkBook): SheetData[] => {
        return wb.SheetNames.map((name) => {
          const ws = wb.Sheets[name];
          const json = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, defval: "", raw: false });
          const headers = json.length > 0 ? json[0].map((h) => formatCell(h)) : [];
          const rows = json.slice(1).map((row) => row.map((c) => formatCell(c)));
          return { name, headers, rows };
        });
      };

      let parsed: SheetData[] = [];
      
      // Intento 1: Parsear normalmente
      try {
        const wb = XLSX.read(bytes, { type: "array" });
        parsed = parseWorkbook(wb);
      } catch (e) {
        console.warn("Error en primer intento de parseo:", e);
      }

      // Intento 2: Si el contenido no es válido, intentar con reparación
      if (!isValidContent(parsed)) {
        console.log("Contenido inválido, intentando reparación...");
        try {
          const repaired = repairXlsx(bytes);
          const wb = XLSX.read(repaired, { type: "array" });
          const repairedParsed = parseWorkbook(wb);
          
          if (isValidContent(repairedParsed)) {
            parsed = repairedParsed;
            console.log("Reparación exitosa");
          }
        } catch (e) {
          console.warn("Error en segundo intento de parseo:", e);
        }
      }

      // Intento 3: Si sigue sin funcionar, intentar con diferentes opciones de XLSX
      if (!isValidContent(parsed)) {
        console.log("Intentando con opciones alternativas...");
        try {
          const wb = XLSX.read(bytes, { type: "array", cellDates: true, cellNF: false });
          const altParsed = parseWorkbook(wb);
          
          if (isValidContent(altParsed)) {
            parsed = altParsed;
            console.log("Parseo alternativo exitoso");
          }
        } catch (e) {
          console.warn("Error en tercer intento de parseo:", e);
        }
      }

      // Validación final
      if (!isValidContent(parsed)) {
        throw new Error("No se pudo parsear el archivo Excel. El archivo puede estar corrupto o en un formato no soportado.");
      }

      setSheets(parsed);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error desconocido");
    } finally {
      setLoading(false);
    }
  }, [archivo?.file_path]);

  useEffect(() => {
    if (open && archivo) loadFile();
  }, [open, archivo, loadFile]);

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

  const currentSheet = sheets[Number(activeSheet)];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[85vh] flex flex-col">
        <DialogHeader className="shrink-0">
          <div className="flex items-center justify-between pr-8">
            <div className="flex items-center gap-2 min-w-0">
              <FileSpreadsheet className="h-5 w-5 text-primary shrink-0" />
              <div className="min-w-0">
                <DialogTitle className="truncate">{archivo?.file_name ?? "Archivo"}</DialogTitle>
                <DialogDescription>
                  {archivo?.file_size ? formatSize(archivo.file_size) : ""}
                  {sheets.length > 0 ? ` · ${sheets.length} hoja${sheets.length !== 1 ? "s" : ""}` : ""}
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

        <div className="flex-1 min-h-0 overflow-hidden">
          {loading && (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
              <span className="ml-2 text-sm text-muted-foreground">Cargando archivo…</span>
            </div>
          )}

          {error && (
            <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive">
              {error}
            </div>
          )}

          {!loading && !error && sheets.length > 0 && (
            <Tabs value={activeSheet} onValueChange={setActiveSheet} className="flex flex-col h-full">
              {sheets.length > 1 && (
                <TabsList className="shrink-0 self-start">
                  {sheets.map((s, i) => (
                    <TabsTrigger key={i} value={String(i)} className="text-xs">
                      {s.name}
                    </TabsTrigger>
                  ))}
                </TabsList>
              )}

              {sheets.map((s, i) => (
                <TabsContent key={i} value={String(i)} className="flex-1 min-h-0 mt-2">
                  <div className="rounded-xl border border-[var(--glass-border)] overflow-auto max-h-[60vh]">
                    <table className="text-xs border-collapse">
                      {s.headers.length > 0 && (
                        <thead className="sticky top-0 z-10">
                          <tr className="bg-[var(--glass-bg-strong)]">
                            <th className="sticky left-0 z-20 px-2 py-1.5 text-left font-semibold border-b border-r border-[var(--glass-border)] text-muted-foreground bg-[var(--glass-bg-strong)]">
                              #
                            </th>
                            {s.headers.map((h, ci) => (
                              <th
                                key={ci}
                                className="px-2 py-1.5 text-left font-semibold border-b border-[var(--glass-border)] whitespace-nowrap"
                              >
                                {h}
                              </th>
                            ))}
                          </tr>
                        </thead>
                      )}
                      <tbody>
                        {s.rows.map((row, ri) => (
                          <tr key={ri} className={ri % 2 === 0 ? "" : "bg-[var(--glass-bg)]"}>
                            <td className="sticky left-0 z-[5] px-2 py-1 border-b border-r border-[var(--glass-border)] text-muted-foreground/50 font-mono text-[10px] bg-inherit">
                              {ri + 1}
                            </td>
                            {s.headers.map((_, ci) => (
                              <td
                                key={ci}
                                className="px-2 py-1 border-b border-[var(--glass-border)] whitespace-nowrap"
                              >
                                {row[ci] ?? ""}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {s.rows.length === 0 && (
                      <p className="text-center text-xs text-muted-foreground py-8">Hoja vacía</p>
                    )}
                  </div>
                </TabsContent>
              ))}
            </Tabs>
          )}

          {!loading && !error && sheets.length === 0 && !archivo && null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
