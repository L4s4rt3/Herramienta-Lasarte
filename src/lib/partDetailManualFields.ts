export const PART_DETAIL_MANUAL_FIELDS = [
  { key: "kg_industria_manual", label: "Industria (Cítrica)", unidad: "kg" },
  // Reciclado por ZONA (regla del dueño 2026-07-29): el operario apunta el
  // BRUTO del papel y los box de su zona; la app resta 30 kg por box (⌈box⌉,
  // ver recicladoZonas.ts) y guarda el NETO en kg_reciclado_malla_z1/z2 — las
  // columnas de siempre, que consume todo lo demás. Box vacío = sin desglose
  // (null en BD): en partes antiguos el bruto se precarga con el neto y no
  // se resta nada (0 box).
  { key: "kg_reciclado_malla_z1_bruto", label: "Reciclado malla Z1 (bruto papel)", unidad: "kg" },
  { key: "box_reciclaje_z1", label: "Box reciclaje Z1 (nº)", unidad: "box" },
  { key: "kg_reciclado_malla_z2_bruto", label: "Reciclado malla Z2 (bruto papel)", unidad: "kg" },
  { key: "box_reciclaje_z2", label: "Box reciclaje Z2 (nº)", unidad: "box" },
  { key: "kg_inventario_sin_alta", label: "Inventario final sin dar de alta", unidad: "kg" },
  { key: "kg_podrido_bolsa_basura", label: "Podrido manual (bolsa basura)", unidad: "kg" },
  // Bateas de la tría PRE-calibrador: se van llenando VARIOS días y se pesan
  // al VACIARLAS (corrección del dueño 2026-07-29) — el kg se apunta en el
  // parte del día del vaciado y NO se prorratea por lote (la estimación por
  // lote sale de los pesos: entrada − procesado, ver mermaLote.ts). Vacío =
  // sin vaciado ese día (null en BD, no un 0).
  { key: "kg_podrido_bateas", label: "Podrido bateas (al vaciarlas)", unidad: "kg" },
] as const;

export type PartDetailManualField = (typeof PART_DETAIL_MANUAL_FIELDS)[number];
export type PartDetailManualFieldKey = PartDetailManualField["key"];
