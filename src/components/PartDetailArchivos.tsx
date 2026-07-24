import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  FileText,
  Trash2,
  Upload,
  ExternalLink,
  Database,
  Factory,
  File as FileIcon,
  Layers,
  FileSpreadsheet,
  FileImage,
  Eye,
} from "lucide-react";
import { formatSize } from "@/components/ExcelViewerDialog";
import { PartFilePreviewDialog, isImageArchivo, isPdfArchivo } from "@/components/PartFilePreviewDialog";

interface Archivo {
  id: string;
  file_name: string | null;
  file_path: string | null;
  file_type: string | null;
  mime_type: string | null;
  file_size: number | null;
  uploaded_at: string;
}

type CategoryId = (typeof CATEGORIES)[number]["id"];

// Las etiquetas (GSTOCK/Produccion/InformeLote/Otro) son los VALORES que se guardan
// en partes_archivos.file_type: no tocar, solo se humaniza la presentación (label/help).
// Significado deducido de cómo los usa analizar-parte y analizar-lote-excel:
// - GSTOCK: informe de palets/stock del calibrador (kg dados de alta).
// - Produccion: informe de producción del calibrador (kg + detalle por lote).
// - InformeLote: informe individual por lote (desglose de tamaños/calibres); se
//   procesa solo al subirlo, sin esperar a "Analizar parte" (ver handleUpload en PartDetail).
// - Otro: catch-all (fotos u otros documentos de apoyo); etiqueta neutra a falta de un uso único.
const CATEGORIES = [
  {
    id: "GSTOCK",
    label: "GSTOCK",
    icon: Database,
    help: "Informe de stock/palets del calibrador (kg dados de alta).",
  },
  {
    id: "Produccion",
    label: "Producción",
    icon: Factory,
    help: "Informe de producción del calibrador, con detalle por lote.",
  },
  {
    id: "InformeLote",
    label: "Informes por lote",
    icon: Layers,
    help: "Desglose de tamaños/calibres de un lote. Se procesa solo, nada más subirlo.",
  },
  {
    id: "Otro",
    label: "Otro",
    icon: FileIcon,
    help: "Fotos u otros documentos de apoyo (p. ej. la hoja de lotes a mano).",
  },
] as const;

const LEGACY_CAT: Record<string, CategoryId> = {
  gstocks: "GSTOCK",
  produccion: "Produccion",
  // "Foto lotes" se retiró como categoría de subida; los archivos antiguos se ven en "Otro".
  foto_lotes: "Otro",
  FotoLotes: "Otro",
};
const normalizeCat = (t: string | null): CategoryId | null =>
  t ? (LEGACY_CAT[t] ?? (CATEGORIES.find((c) => c.id === t)?.id ?? null)) : null;

interface PartDetailArchivosProps {
  archivos: Archivo[];
  readOnly: boolean;
  uploadingCat: CategoryId | null;
  handleUpload: (cat: CategoryId, fileList: FileList | File[]) => Promise<void>;
  handleDeleteFile: (a: Archivo) => Promise<void>;
}

function isExcelArchivo(a: Archivo): boolean {
  const name = (a.file_name ?? "").toLowerCase();
  const mime = (a.mime_type ?? "").toLowerCase();
  return (
    name.endsWith(".xlsx") ||
    name.endsWith(".xls") ||
    name.endsWith(".csv") ||
    mime.includes("spreadsheet") ||
    mime.includes("excel") ||
    mime.includes("csv")
  );
}

function fileKindIcon(a: Archivo) {
  if (isExcelArchivo(a)) return FileSpreadsheet;
  if (isImageArchivo(a)) return FileImage;
  if (isPdfArchivo(a)) return FileText;
  return FileIcon;
}

function formatUploadedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export default function PartDetailArchivos({
  archivos,
  readOnly,
  uploadingCat,
  handleUpload,
  handleDeleteFile,
}: PartDetailArchivosProps) {
  const [previewArchivo, setPreviewArchivo] = useState<Archivo | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Archivo | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function confirmDelete() {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await handleDeleteFile(pendingDelete);
      setPendingDelete(null);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Card className="glass-accented">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-3">
          <div className="h-7 w-1 shrink-0 rounded-full bg-primary" />
          <div className="min-w-0">
            <CardTitle className="text-base">Archivos del parte</CardTitle>
            <p className="text-xs text-muted-foreground">Informes Excel, PDF y fotos por categoría</p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {CATEGORIES.map((c) => {
            const Icon = c.icon;
            const filesInCat = archivos.filter((a) => normalizeCat(a.file_type) === c.id);
            return (
              <div key={c.id} className="flex flex-col rounded-xl glass p-3">
                <div className="flex items-center gap-2">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg glass-strong text-primary">
                    <Icon className="h-4 w-4" />
                  </div>
                  <p className="min-w-0 flex-1 truncate text-sm font-semibold">{c.label}</p>
                  <span className="shrink-0 rounded-full bg-[var(--glass-bg-strong)] px-2 py-0.5 text-xs font-medium tabular-nums text-muted-foreground">
                    {filesInCat.length}
                  </span>
                </div>
                <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground">{c.help}</p>
                <label className="mt-3 flex">
                  <input
                    type="file"
                    multiple
                    className="hidden"
                    disabled={readOnly || uploadingCat === c.id}
                    onChange={(e) => {
                      if (e.target.files && e.target.files.length > 0) handleUpload(c.id, e.target.files);
                      e.target.value = "";
                    }}
                  />
                  <Button asChild size="sm" variant="outline" className="w-full cursor-pointer" disabled={readOnly || uploadingCat === c.id}>
                    <span>
                      <Upload className="h-4 w-4" />
                      {uploadingCat === c.id ? "Subiendo…" : "Subir"}
                    </span>
                  </Button>
                </label>
                {filesInCat.length === 0 ? (
                  <p className="mt-3 py-2 text-center text-xs text-muted-foreground/70">Sin archivos</p>
                ) : (
                  <ul className="mt-3 space-y-1.5">
                    {filesInCat.map((a) => {
                      const isExcel = isExcelArchivo(a);
                      const isPdf = isPdfArchivo(a);
                      const isImage = isImageArchivo(a);
                      const FileIconCmp = fileKindIcon(a);
                      const sizeLabel = formatSize(a.file_size);
                      const dateLabel = formatUploadedAt(a.uploaded_at);
                      const metaLabel = [sizeLabel, dateLabel].filter(Boolean).join(" · ");
                      return (
                        <li key={a.id} className="flex flex-col gap-1 rounded-lg px-1.5 py-1 text-xs hover:bg-[var(--glass-bg-strong)]">
                          <div className="flex items-center gap-2">
                            <FileIconCmp className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                            {isExcel ? (
                              <a
                                href={`/ver-excel/${a.id}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex flex-1 items-center gap-1 truncate text-left text-primary/80 hover:text-primary hover:underline"
                                title={`Ver ${a.file_name}`}
                              >
                                <span className="truncate">{a.file_name}</span>
                                <ExternalLink className="h-2.5 w-2.5 shrink-0 opacity-60" />
                              </a>
                            ) : (
                              <span className="flex-1 truncate" title={a.file_name ?? ""}>{a.file_name}</span>
                            )}
                            {(isPdf || isImage) && (
                              <button
                                onClick={() => setPreviewArchivo(a)}
                                className="shrink-0 text-muted-foreground hover:text-primary"
                                aria-label={`Ver ${a.file_name}`}
                                title="Ver"
                              >
                                <Eye className="h-3.5 w-3.5" />
                              </button>
                            )}
                            {!readOnly && (
                              <button
                                onClick={() => setPendingDelete(a)}
                                className="shrink-0 text-muted-foreground hover:text-destructive"
                                aria-label="Eliminar"
                                title="Eliminar"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </div>
                          {metaLabel && (
                            <span className="pl-5 text-[10px] text-muted-foreground/70">{metaLabel}</span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
        <div className="rounded-xl border border-[var(--glass-border)] bg-[var(--glass-bg)] px-3 py-2 text-xs text-muted-foreground">
          Sube los informes Excel en su categoría. Luego pulsa <strong>Analizar parte</strong> para extraer los datos automáticamente. Los <strong>Informes por lote</strong> son la excepción: se procesan solos en cuanto los subes, sin esperar a "Analizar parte".
        </div>
      </CardContent>

      <PartFilePreviewDialog
        open={previewArchivo != null}
        onOpenChange={(open) => !open && setPreviewArchivo(null)}
        archivo={previewArchivo}
      />

      <AlertDialog open={pendingDelete != null} onOpenChange={(open) => !open && !deleting && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminar archivo</AlertDialogTitle>
            <AlertDialogDescription>
              Se eliminará <strong>{pendingDelete?.file_name}</strong> de forma permanente. Esta acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                confirmDelete();
              }}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? "Eliminando…" : "Eliminar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
