export const PART_DETAIL_MANUAL_FIELDS = [
  { key: "kg_industria_manual", label: "Industria (Cítrica)", unidad: "kg" },
  { key: "kg_reciclado_malla_z1", label: "Reciclado malla Z1", unidad: "kg" },
  { key: "kg_reciclado_malla_z2", label: "Reciclado malla Z2", unidad: "kg" },
  { key: "kg_inventario_sin_alta", label: "Inventario final sin dar de alta", unidad: "kg" },
  { key: "kg_podrido_bolsa_basura", label: "Podrido manual (bolsa basura)", unidad: "kg" },
  // Z1 y Z2 ya se guardan netos de tara. Este campo conserva el número de
  // envases físicos para trazabilidad y reparto entre pasadas.
  { key: "box_reciclaje", label: "Box de reciclaje (nº)", unidad: "box" },
] as const;

export type PartDetailManualField = (typeof PART_DETAIL_MANUAL_FIELDS)[number];
export type PartDetailManualFieldKey = PartDetailManualField["key"];
