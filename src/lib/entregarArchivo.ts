// Entregar un archivo generado en el navegador (informe Word, foto, Excel).
//
// VIVE AQUÍ desde el 16-09-2026 porque ya son dos los informes que lo
// necesitan: el de calidad de importación (donde nació) y el informe técnico de
// campo. Copiarlo habría sido la tercera versión de la misma función, y en este
// repo las copias divergen — patrón fotoLotesCoherencia: una lib, dos
// consumidores.
//
// EL PORQUÉ DEL MÓVIL (lo aprendido con el informe de calidad): en iPhone/iPad
// y Android la hoja de compartir nativa es el camino cómodo (Mail, WhatsApp,
// Guardar en Archivos) Y el fiable — la descarga de blobs en una PWA instalada
// en iOS falla en silencio. En escritorio, descarga normal.

/** MIME del .docx. Explícito siempre: con el genérico, el visor del iPhone no sabe abrir el informe. */
export const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** Logo corporativo, el mismo que usan los informes y el membrete. */
export const LOGO_PATH = "/branding/lasarte-logo-horizontal.jpg";

/** Imagen lista para incrustar en un .docx. */
export interface ImagenParaInforme {
  data: ArrayBuffer | Uint8Array;
  width: number;
  height: number;
  tipo: "jpg" | "png";
}

/**
 * Entrega el archivo: hoja de compartir en el móvil, descarga en escritorio.
 * "cancelado" = la persona cerró la hoja de compartir, que NO es un fallo y no
 * debe disparar la descarga por detrás.
 */
export async function entregarArchivo(blob: Blob, filename: string, mime: string): Promise<"compartido" | "descargado" | "cancelado"> {
  const esMovil = typeof navigator !== "undefined" && /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
  const file = new File([blob], filename, { type: mime });
  if (esMovil && typeof navigator.canShare === "function" && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: filename });
      return "compartido";
    } catch (error) {
      // Cancelar la hoja de compartir no es un fallo: no forzar la descarga.
      if (error instanceof Error && error.name === "AbortError") return "cancelado";
      // Cualquier otro fallo: se intenta la descarga clásica.
    }
  }
  const url = URL.createObjectURL(new Blob([blob], { type: mime }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revocar al momento aborta la descarga en iOS/Safari: se le da margen.
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return "descargado";
}

/** Mide la imagen (el .docx necesita el tamaño real) y la deja lista para incrustar. */
export async function blobAImagenInforme(blob: Blob, tipo: "jpg" | "png"): Promise<ImagenParaInforme> {
  const bitmap = await createImageBitmap(blob);
  const { width, height } = bitmap;
  bitmap.close();
  return { data: await blob.arrayBuffer(), width, height, tipo };
}

/**
 * El logo para la cabecera del informe. Si falla o tarda, devuelve null y el
 * informe sale sin él: un logo no puede impedir que se genere un documento.
 * Con la PWA instalada está precacheado y va sin conexión.
 */
export async function cargarLogoInforme(timeoutMs = 5000): Promise<ImagenParaInforme | null> {
  try {
    const control = new AbortController();
    const reloj = window.setTimeout(() => control.abort(), timeoutMs);
    const respuesta = await fetch(LOGO_PATH, { signal: control.signal });
    window.clearTimeout(reloj);
    if (!respuesta.ok) return null;
    return await blobAImagenInforme(await respuesta.blob(), "jpg");
  } catch {
    return null;
  }
}
