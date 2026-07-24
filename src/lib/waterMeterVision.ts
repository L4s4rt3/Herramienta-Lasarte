export interface WaterMeterVisionImage {
  mime: "image/jpeg";
  b64: string;
  previewUrl: string;
}

export interface WaterMeterVisionResult {
  lectura_m3: number;
  lectura_texto: string;
  confianza: number;
  dudas: string[];
  modelo: string | null;
}

function loadImage(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("No se pudo abrir la imagen"));
    image.src = url;
  });
}

function renderJpeg(image: HTMLImageElement, maxSide: number, quality: number) {
  const shortSide = Math.min(image.naturalWidth, image.naturalHeight);
  const sourceWidth = Math.min(image.naturalWidth, shortSide * 0.9);
  const sourceHeight = Math.min(image.naturalHeight, shortSide * 0.75);
  const centerX = image.naturalWidth * 0.45;
  const centerY = image.naturalHeight * 0.52;
  const sourceX = Math.max(0, Math.min(image.naturalWidth - sourceWidth, centerX - sourceWidth / 2));
  const sourceY = Math.max(0, Math.min(image.naturalHeight - sourceHeight, centerY - sourceHeight / 2));
  const scale = Math.min(1, maxSide / Math.max(sourceWidth, sourceHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(sourceWidth * scale));
  canvas.height = Math.max(1, Math.round(sourceHeight * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("El navegador no permite preparar la foto");
  context.drawImage(
    image,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    0,
    0,
    canvas.width,
    canvas.height,
  );
  return canvas.toDataURL("image/jpeg", quality);
}

export async function prepareWaterMeterPhoto(file: File): Promise<WaterMeterVisionImage> {
  if (!file.type.startsWith("image/")) throw new Error("Selecciona una fotografía");
  if (file.size > 15 * 1024 * 1024) throw new Error("La fotografía supera 15 MB");

  const sourceUrl = URL.createObjectURL(file);
  try {
    const image = await loadImage(sourceUrl);
    let dataUrl = renderJpeg(image, 1_400, 0.86);
    if (dataUrl.length > 2_000_000) dataUrl = renderJpeg(image, 1_100, 0.72);
    const comma = dataUrl.indexOf(",");
    if (comma < 0) throw new Error("No se pudo codificar la fotografía");
    return {
      mime: "image/jpeg",
      b64: dataUrl.slice(comma + 1),
      previewUrl: dataUrl,
    };
  } finally {
    URL.revokeObjectURL(sourceUrl);
  }
}

export function normalizeWaterMeterVisionResult(value: unknown): WaterMeterVisionResult {
  if (!value || typeof value !== "object") throw new Error("Respuesta de visión vacía");
  const raw = value as Record<string, unknown>;
  const reading = Number(raw.lectura_m3);
  if (!Number.isFinite(reading) || reading < 10_000 || reading > 999_999.9999) {
    throw new Error("La lectura detectada no es válida");
  }
  const confidenceRaw = Number(raw.confianza);
  return {
    lectura_m3: Math.round(reading * 10_000) / 10_000,
    lectura_texto: String(raw.lectura_texto ?? reading),
    confianza: Number.isFinite(confidenceRaw) ? Math.max(0, Math.min(1, confidenceRaw)) : 0.5,
    dudas: Array.isArray(raw.dudas)
      ? raw.dudas.map((item) => String(item ?? "").trim()).filter(Boolean)
      : [],
    modelo: raw.modelo ? String(raw.modelo) : null,
  };
}
