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
      const wb = XLSX.read(buffer, { type: "array" });

      const parsed: SheetData[] = wb.SheetNames.map((name) => {
        const ws = wb.Sheets[name];
        const json = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, defval: "" });
        const headers = json.length > 0 ? json[0].map((h) => String(h)) : [];
        const rows = json.slice(1).map((row) => row.map((c) => String(c)));
        return { name, headers, rows };
      });

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
                  <div className="rounded-xl border border-[var(--glass-border)] overflow-y-auto max-h-[60vh]">
                    <table className="w-full text-xs border-collapse table-fixed">
                      {s.headers.length > 0 && (
                        <thead className="sticky top-0 z-10">
                          <tr className="bg-[var(--glass-bg-strong)]">
                            <th className="px-2 py-1.5 text-left font-semibold border-b border-[var(--glass-border)] text-muted-foreground w-12">
                              #
                            </th>
                            {s.headers.map((h, ci) => (
                              <th
                                key={ci}
                                className="px-2 py-1.5 text-left font-semibold border-b border-[var(--glass-border)]"
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
                            <td className="px-2 py-1 border-b border-[var(--glass-border)] text-muted-foreground/50 font-mono text-[10px]">
                              {ri + 1}
                            </td>
                            {s.headers.map((_, ci) => (
                              <td
                                key={ci}
                                className="px-2 py-1 border-b border-[var(--glass-border)] break-words"
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
