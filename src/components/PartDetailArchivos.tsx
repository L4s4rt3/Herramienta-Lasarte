import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FileText, Trash2, Upload } from "lucide-react";

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
  { id: "GSTOCK", label: "GSTOCK" },
  { id: "Produccion", label: "Producción" },
  { id: "FotoLotes", label: "Foto lotes" },
  { id: "Otro", label: "Otro" },
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

export default function PartDetailArchivos({
  archivos,
  readOnly,
  uploadingCat,
  handleUpload,
  handleDeleteFile,
}: PartDetailArchivosProps) {
  return (
    <Card className="glass-accented">
      <CardHeader>
        <CardTitle className="text-lg">Archivos del parte</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {CATEGORIES.map((c) => {
            const filesInCat = archivos.filter((a) => normalizeCat(a.file_type) === c.id);
            return (
              <div key={c.id} className="rounded-xl glass p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium">{c.label}</p>
                  <span className="text-xs text-muted-foreground">{filesInCat.length}</span>
                </div>
                <label className="flex">
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
                <ul className="space-y-1">
                  {filesInCat.map((a) => (
                    <li key={a.id} className="flex items-center gap-2 text-xs">
                      <FileText className="h-3 w-3 shrink-0 text-muted-foreground" />
                      <span className="truncate flex-1" title={a.file_name ?? ""}>{a.file_name}</span>
                      {!readOnly && (
                        <button onClick={() => handleDeleteFile(a)} className="text-muted-foreground hover:text-destructive" aria-label="Eliminar">
                          <Trash2 className="h-3 w-3" />
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
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
