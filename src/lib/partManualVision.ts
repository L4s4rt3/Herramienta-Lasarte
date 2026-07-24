export interface PartManualVisionImage {
  mime: "image/jpeg";
  b64: string;
  previewUrl: string;
}

export interface PartManualVisionRaw {
  fecha: string | null;
  citrica_kg_brutos: number | null;
  citrica_box: number | null;
  citrica_podrido_kg_brutos: number | null;
  citrica_podrido_box: number | null;
  podrido_kg_brutos: number | null;
  podrido_box: number | null;
  malla_z1_kg_brutos: number | null;
  malla_z1_box: number | null;
  malla_z2_kg_brutos: number | null;
  malla_z2_box: number | null;
  palets_punta_kg: number | null;
}

export interface PartManualVisionFields {
  kg_industria_manual: number | null;
  kg_reciclado_malla_z1: number | null;
  kg_reciclado_malla_z2: number | null;
  kg_inventario_sin_alta: number | null;
  kg_podrido_bolsa_basura: number | null;
  box_reciclaje: number | null;
}

export interface PartManualVisionResult {
  raw: PartManualVisionRaw;
  fields: PartManualVisionFields;
  confianza: number;
  dudas: string[];
  modelo: string | null;
}

const TARA_BOX_KG = 30;

function loadImage(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("No se pudo abrir la imagen"));
    image.src = url;
  });
}

function renderJpeg(image: HTMLImageElement, maxSide: number, quality: number) {
  const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("El navegador no permite preparar la foto");
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", quality);
}

export async function preparePartManualPhoto(file: File): Promise<PartManualVisionImage> {
  if (!file.type.startsWith("image/")) throw new Error("Selecciona una fotografía");
  if (file.size > 15 * 1024 * 1024) throw new Error("La fotografía supera 15 MB");

  const sourceUrl = URL.createObjectURL(file);
  try {
    const image = await loadImage(sourceUrl);
    let dataUrl = renderJpeg(image, 1_600, 0.86);
    if (dataUrl.length > 2_000_000) dataUrl = renderJpeg(image, 1_250, 0.72);
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

function nullableNumber(value: unknown, max = 1_000_000): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number"
    ? value
    : Number(String(value).trim().replace(/\s/g, "").replace(",", "."));
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > max) return null;
  return Math.round(parsed * 100) / 100;
}

function normalizeDate(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return raw;
  const es = raw.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
  if (!es) return null;
  const year = es[3].length === 2 ? `20${es[3]}` : es[3];
  return `${year}-${es[2].padStart(2, "0")}-${es[1].padStart(2, "0")}`;
}

function boxesForTare(kg: number | null, box: number | null): number {
  if (kg === null || kg <= 0) return 0;
  return Math.max(1, Math.ceil(box ?? 1));
}

export function derivePartManualFields(raw: PartManualVisionRaw): PartManualVisionFields {
  const citricaPodrido = raw.citrica_podrido_kg_brutos;
  const podrido = raw.podrido_kg_brutos;
  const hasPodrido = (citricaPodrido !== null && citricaPodrido > 0)
    || (podrido !== null && podrido > 0);
  const podridoBox = boxesForTare(citricaPodrido, raw.citrica_podrido_box)
    + boxesForTare(podrido, raw.podrido_box);

  const hasMallaBox = raw.malla_z1_box !== null || raw.malla_z2_box !== null;
  const mallaZ1Box = raw.malla_z1_box === null ? null : Math.ceil(raw.malla_z1_box);
  const mallaZ2Box = raw.malla_z2_box === null ? null : Math.ceil(raw.malla_z2_box);
  const boxReciclaje = hasMallaBox ? (mallaZ1Box ?? 0) + (mallaZ2Box ?? 0) : null;
  const mallaNeta = (kgBrutos: number | null, box: number | null) => {
    if (kgBrutos === null) return null;
    return Math.max(0, kgBrutos - (box ?? 0) * TARA_BOX_KG);
  };

  return {
    // "Cítrica" se guarda tal como se pesa en el papel: industria bruta del día.
    kg_industria_manual: raw.citrica_kg_brutos,
    // Las mallas se guardan netas. Cada fracción ocupa un box físico completo,
    // por lo que la tara se redondea hacia arriba de forma independiente.
    kg_reciclado_malla_z1: mallaNeta(raw.malla_z1_kg_brutos, mallaZ1Box),
    kg_reciclado_malla_z2: mallaNeta(raw.malla_z2_kg_brutos, mallaZ2Box),
    kg_inventario_sin_alta: raw.palets_punta_kg,
    // Cada línea de podrido usa su propio box. Si el papel no anota cantidad,
    // se asume un box para Cítrica podrido y otro para Podrido.
    kg_podrido_bolsa_basura: hasPodrido
      ? Math.max(0, (citricaPodrido ?? 0) + (podrido ?? 0) - podridoBox * TARA_BOX_KG)
      : null,
    // Una fracción de box ocupa un box físico completo en cada zona.
    box_reciclaje: boxReciclaje,
  };
}

export function normalizePartManualVisionResult(value: unknown): PartManualVisionResult {
  if (!value || typeof value !== "object") throw new Error("Respuesta de visión vacía");
  const envelope = value as Record<string, unknown>;
  const source = envelope.raw && typeof envelope.raw === "object"
    ? envelope.raw as Record<string, unknown>
    : envelope;

  const raw: PartManualVisionRaw = {
    fecha: normalizeDate(source.fecha),
    citrica_kg_brutos: nullableNumber(source.citrica_kg_brutos),
    citrica_box: nullableNumber(source.citrica_box, 100),
    citrica_podrido_kg_brutos: nullableNumber(source.citrica_podrido_kg_brutos),
    citrica_podrido_box: nullableNumber(source.citrica_podrido_box, 100),
    podrido_kg_brutos: nullableNumber(source.podrido_kg_brutos),
    podrido_box: nullableNumber(source.podrido_box, 100),
    malla_z1_kg_brutos: nullableNumber(source.malla_z1_kg_brutos),
    malla_z1_box: nullableNumber(source.malla_z1_box, 100),
    malla_z2_kg_brutos: nullableNumber(source.malla_z2_kg_brutos),
    malla_z2_box: nullableNumber(source.malla_z2_box, 100),
    palets_punta_kg: nullableNumber(source.palets_punta_kg),
  };

  const confidenceRaw = Number(envelope.confianza);
  return {
    raw,
    fields: derivePartManualFields(raw),
    confianza: Number.isFinite(confidenceRaw) ? Math.max(0, Math.min(1, confidenceRaw)) : 0.5,
    dudas: Array.isArray(envelope.dudas)
      ? envelope.dudas.map((item) => String(item ?? "").trim()).filter(Boolean).slice(0, 8)
      : [],
    modelo: envelope.modelo ? String(envelope.modelo) : null,
  };
}

export function partManualVisionExplanations(result: PartManualVisionResult): string[] {
  const { raw, fields } = result;
  const lines: string[] = [];
  if (fields.kg_podrido_bolsa_basura !== null) {
    const box = boxesForTare(raw.citrica_podrido_kg_brutos, raw.citrica_podrido_box)
      + boxesForTare(raw.podrido_kg_brutos, raw.podrido_box);
    lines.push(
      `Podrido neto: ${raw.citrica_podrido_kg_brutos ?? 0} + ${raw.podrido_kg_brutos ?? 0} − ${box} box × 30 = ${fields.kg_podrido_bolsa_basura} kg`,
    );
  }
  if (fields.box_reciclaje !== null) {
    lines.push(
      `Box reciclaje: ⌈${raw.malla_z1_box ?? 0}⌉ + ⌈${raw.malla_z2_box ?? 0}⌉ = ${fields.box_reciclaje}`,
    );
  }
  if (fields.kg_reciclado_malla_z1 !== null) {
    lines.push(
      `Malla Z1 neta: ${raw.malla_z1_kg_brutos ?? 0} − ${Math.ceil(raw.malla_z1_box ?? 0)} box × 30 = ${fields.kg_reciclado_malla_z1} kg`,
    );
  }
  if (fields.kg_reciclado_malla_z2 !== null) {
    lines.push(
      `Malla Z2 neta: ${raw.malla_z2_kg_brutos ?? 0} − ${Math.ceil(raw.malla_z2_box ?? 0)} box × 30 = ${fields.kg_reciclado_malla_z2} kg`,
    );
  }
  return lines;
}
