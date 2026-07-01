import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FileText, Trash2, Upload, ExternalLink, Database, Factory, Image as ImageIcon, File as FileIcon } from "lucide-react";

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

const CATEGORIES = [
  { id: "GSTOCK", label: "GSTOCK", icon: Database },
  { id: "Produccion", label: "Producción", icon: Factory },
  { id: "FotoLotes", label: "Foto lotes", icon: ImageIcon },
  { id: "Otro", label: "Otro", icon: FileIcon },
] as const;

const LEGACY_CAT: Record<string, CategoryId> = {
  gstocks: "GSTOCK",
  produccion: "Produccion",
  foto_lotes: "FotoLotes",
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

function isPreviewable(a: Archivo): boolean {
  const name = (a.file_name ?? "").toLowerCase();
  const mime = (a.mime_type ?? "").toLowerCase();
  return name.endsWith(".xlsx") || name.endsWith(".xls") || mime.includes("spreadsheet") || mime.includes("excel");
}

export default function PartDetailArchivos({
  archivos,
  readOnly,
  uploadingCat,
  handleUpload,
  handleDeleteFile,
}: PartDetailArchivosProps) {
  return (
    <Card className="glass-accented">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-3">
          <div className="h-7 w-1 shrink-0 rounded-full bg-primary" />
          <div className="min-w-0">
            <CardTitle className="text-base">Archivos del parte</CardTitle>
            <p className="text-xs text-muted-foreground">Informes Excel y fotos por categoría</p>
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
                      const previewable = isPreviewable(a);
                      return (
                        <li key={a.id} className="flex items-center gap-2 text-xs">
                          <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          {previewable ? (
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
                          {!readOnly && (
                            <button onClick={() => handleDeleteFile(a)} className="shrink-0 text-muted-foreground hover:text-destructive" aria-label="Eliminar">
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
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
          Sube los informes Excel y fotos en su categoría. Luego pulsa <strong>Analizar con IA</strong> para extraer los datos automáticamente.
        </div>
      </CardContent>
    </Card>
  );
}
