import { DEST_COLORS } from "@/lib/chartTheme";

// Clasifica un grupo_destino crudo (de calibres_dia) en una categoría legible.
// Compartido por el Dashboard y la Cascada DJPMN para que ambos usen
// exactamente el mismo criterio y los mismos colores.
export function detectarTipoClasificacion(valor: string | null): string {
  if (!valor) return "Otro";
  const v = valor.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  if (v.includes("no_export") || v.includes("no export") || v.includes("no_exportac") || v.includes("no exportac")) return "No exportación";
  if (v.includes("no_comerc") || v.includes("no comerc") || v.includes("industria") || v.includes("ind")) return "No comercial";
  if (v.includes("export") || v.includes("ext")) return "Exportación";
  if (v.includes("mujer")) return "Mujeres";
  if (v.includes("mercado") || v.includes("nac") || v.includes("interior") || v.includes("int")) return "Mercado";
  return valor;
}

export const GRUPO_COLORS: Record<string, string> = {
  "Exportación":   DEST_COLORS.exportacion,
  "Mercado":       DEST_COLORS.mercado,
  "No exportación": DEST_COLORS.noExportacion,
  "No comercial":  DEST_COLORS.noComercial,
  "Mujeres":       DEST_COLORS.mujeres,
  "Otro":          DEST_COLORS.otro,
};
