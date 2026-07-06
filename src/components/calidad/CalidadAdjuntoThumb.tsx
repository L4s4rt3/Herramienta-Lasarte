import { FileText, Image as ImageIcon } from "lucide-react";
import { isPdfArchivo } from "@/components/PartFilePreviewDialog";
import type { CalidadAdjunto } from "@/lib/calidad";

interface CalidadAdjuntoThumbProps {
  adjunto: CalidadAdjunto;
}

/**
 * Miniatura de un adjunto de calidad: imagen (URL firmada, object-cover) o
 * icono de tipo de archivo (PDF/documento) cuando no hay imagen disponible.
 */
export function CalidadAdjuntoThumb({ adjunto }: CalidadAdjuntoThumbProps) {
  if (adjunto.signedUrl) {
    return <img src={adjunto.signedUrl} alt={adjunto.file_name} className="h-32 w-full rounded-t-xl object-cover" />;
  }

  const Icon = isPdfArchivo(adjunto) ? FileText : ImageIcon;
  return (
    <div className="flex h-32 items-center justify-center rounded-t-xl bg-primary/6">
      <Icon className="h-7 w-7 text-primary" />
    </div>
  );
}
