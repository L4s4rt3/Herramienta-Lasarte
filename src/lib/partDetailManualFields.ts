export const PART_DETAIL_MANUAL_FIELDS = [
  { key: "kg_reciclado_malla_z1", label: "Reciclado malla Z1" },
  { key: "kg_reciclado_malla_z2", label: "Reciclado malla Z2" },
  { key: "kg_inventario_sin_alta", label: "Inventario final sin dar de alta" },
  { key: "kg_podrido_bolsa_basura", label: "Podrido manual (bolsa basura)" },
] as const;

export type PartDetailManualField = (typeof PART_DETAIL_MANUAL_FIELDS)[number];
export type PartDetailManualFieldKey = PartDetailManualField["key"];
