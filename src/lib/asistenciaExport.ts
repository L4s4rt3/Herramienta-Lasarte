import type { EtiquetaCosteOperativo } from "./asistenciaRendimiento";

function normalizeText(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

export function normalizeAsistenciaExportZona(value: unknown) {
  const text = normalizeText(value);
  if (!text) return "Sin grupo";
  if (text === "envasadoras" || text === "envasado" || /\b(envasadora|envasadoras|mesa|mesas)\b/.test(text)) {
    return "Mesas";
  }
  if (/\bgranel/.test(text) || /\brp\b/.test(text) || /\brpack\b/.test(text)) {
    return "Graneleras";
  }
  return String(value ?? "Sin grupo");
}

export function buildRendimientoZonaExportRow(
  zona: {
    label: string;
    kg: number;
    porcentajeKg: number;
    personas: number;
    objetivo?: number | null;
    kgPersona: number;
  },
  porcentajeKg: string,
) {
  return {
    Zona: normalizeAsistenciaExportZona(zona.label),
    Kg: Math.round(zona.kg),
    "Porcentaje kg": porcentajeKg,
    "Personas presentes": zona.personas,
    "Personas plantilla": zona.objetivo ?? "",
    "Kg/persona": Math.round(zona.kgPersona),
  };
}

export function buildTrabajadorDiaExportRow(input: {
  nombre: string;
  zona?: string | null;
  estado: string;
  coste: EtiquetaCosteOperativo | "";
  calculo: string;
  kgRef?: number | null;
}) {
  return {
    Nombre: input.nombre,
    Zona: normalizeAsistenciaExportZona(input.zona),
    Estado: input.estado,
    Coste: input.coste,
    Calculo: input.calculo,
    "Kg/persona general": input.kgRef != null ? Math.round(input.kgRef) : "",
  };
}

export function buildProductoClasificadoExportRow(producto: {
  producto: string;
  empaque: string;
  zona: string;
  computa: boolean;
  kg: number;
}) {
  return {
    Producto: producto.producto,
    Empaque: producto.empaque,
    Zona: normalizeAsistenciaExportZona(producto.zona),
    "Computa kg zona": producto.computa ? "Si" : "No",
    Kg: Math.round(producto.kg),
  };
}
