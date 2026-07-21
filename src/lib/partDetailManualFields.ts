export const PART_DETAIL_MANUAL_FIELDS = [
  { key: "kg_reciclado_malla_z1", label: "Reciclado malla Z1", unidad: "kg" },
  { key: "kg_reciclado_malla_z2", label: "Reciclado malla Z2", unidad: "kg" },
  { key: "kg_inventario_sin_alta", label: "Inventario final sin dar de alta", unidad: "kg" },
  { key: "kg_podrido_bolsa_basura", label: "Podrido manual (bolsa basura)", unidad: "kg" },
  // Nº de box de reciclaje del día: su TARA (~30 kg/box, dato del dueño
  // 21-jul-2026) se resta del reciclado bruto de malla Z1+Z2 para obtener el
  // neto de fruta que vuelve a la línea (700 kg y 3 box → 610 kg netos). Lo
  // usa la conciliación de kg (conciliacionKg.ts). Migración 20260721140000.
  { key: "box_reciclaje", label: "Box de reciclaje (nº)", unidad: "box" },
] as const;

export type PartDetailManualField = (typeof PART_DETAIL_MANUAL_FIELDS)[number];
export type PartDetailManualFieldKey = PartDetailManualField["key"];
