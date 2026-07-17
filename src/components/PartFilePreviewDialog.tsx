import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Download, Loader2, FileImage, FileText } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { formatSize } from "@/lib/excelPreview";

const STORAGE_BUCKET = "partes-archivos";
const SIGNED_URL_TTL_SECONDS = 60 * 10;

export interface PreviewableArchivo {
  id: string;
  file_name: string | null;
  file_path: string | null;
  mime_type: string | null;
  file_size: number | null;
}

interface PartFilePreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  archivo: PreviewableArchivo | null;
}

export function isImageArchivo(a: Pick<PreviewableArchivo, "file_name" | "mime_type">): boolean {
  const name = (a.file_name ?? "").toLowerCase();
  const mime = (a.mime_type ?? "").toLowerCase();
  return mime.startsWith("image/") || /\.(png|jpe?g|webp|gif)$/.test(name);
}

export function isPdfArchivo(a: Pick<PreviewableArchivo, "file_name" | "mime_type">): boolean {
  const name = (a.file_name ?? "").toLowerCase();
  const mime = (a.mime_type ?? "").toLowerCase();
  return mime === "application/pdf" || name.endsWith(".pdf");
}

/**
 * Dialog de previsualizacion para PDF e imagenes de un archivo de parte.
 * Reutiliza el patron ya usado en ExcelViewerDialog/CalidadJornada: descarga
 * el archivo del bucket "partes-archivos" y genera una URL firmada temporal
 * para mostrarla en un <iframe>/<object> (PDF) o <img> (imagen).
 */
export function PartFilePreviewDialog({ open, onOpenChange, archivo }: PartFilePreviewDialogProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signedUrl, setSignedUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !archivo?.file_path) {
      setSignedUrl(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setSignedUrl(null);

    supabase.storage
      .from(STORAGE_BUCKET)
      .createSignedUrl(archivo.file_path, SIGNED_URL_TTL_SECONDS)
      .then(({ data, error: signError }) => {
        if (cancelled) return;
        if (signError || !data?.signedUrl) {
          setError(signError?.message ?? "No se pudo generar el enlace de vista previa");
          return;
        }
        setSignedUrl(data.signedUrl);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Error desconocido");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, archivo?.file_path]);

  const isImage = archivo ? isImageArchivo(archivo) : false;
  const isPdf = archivo ? isPdfArchivo(archivo) : false;
  const Icon = isImage ? FileImage : FileText;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl h-[80vh] flex flex-col p-0 gap-0">
        <DialogHeader className="shrink-0 border-b border-[var(--glass-border)] px-5 py-3">
          <div className="flex items-center justify-between gap-3 pr-8">
            <div className="flex items-center gap-2 min-w-0">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg glass-strong text-primary">
                <Icon className="h-4.5 w-4.5" />
              </span>
              <div className="min-w-0">
                <DialogTitle className="truncate text-sm">{archivo?.file_name ?? "Archivo"}</DialogTitle>
                <DialogDescription className="text-xs">{formatSize(archivo?.file_size ?? null)}</DialogDescription>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              disabled={!signedUrl}
              className="shrink-0 glass glass-hover"
              asChild
            >
              <a href={signedUrl ?? "#"} download={archivo?.file_name ?? undefined} target="_blank" rel="noopener noreferrer">
                <Download className="h-3.5 w-3.5 mr-1.5" />
                Descargar
              </a>
            </Button>
          </div>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-auto p-4">
          {loading && (
            <div className="flex h-full items-center justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
              <span className="ml-2 text-sm text-muted-foreground">Generando vista previa…</span>
            </div>
          )}

          {!loading && error && (
            <div className="flex h-full items-center justify-center">
              <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive max-w-md text-center">
                {error}
              </div>
            </div>
          )}

          {!loading && !error && signedUrl && isPdf && (
            <object data={signedUrl} type="application/pdf" className="h-full w-full rounded-xl border border-[var(--glass-border)]">
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                No se pudo mostrar el PDF en el navegador.{" "}
                <a href={signedUrl} target="_blank" rel="noopener noreferrer" className="ml-1 text-primary underline">
                  Abrir en pestaña nueva
                </a>
              </div>
            </object>
          )}

          {!loading && !error && signedUrl && isImage && (
            <div className="flex h-full items-center justify-center rounded-xl bg-[var(--glass-bg-strong)] border border-[var(--glass-border)]">
              <img
                src={signedUrl}
                alt={archivo?.file_name ?? "Vista previa"}
                className="max-h-full max-w-full object-contain"
              />
            </div>
          )}

          {!loading && !error && signedUrl && !isPdf && !isImage && (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              Este tipo de archivo no tiene vista previa disponible.
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
