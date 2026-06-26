export type ZonaProductoInforme =
  | "Mesas"
  | "Industria"
  | "Mallas"
  | "Graneleras"
  | "Excluir";

export type ProductoInformeOverrides = Record<string, ZonaProductoInforme>;

export interface ProductoInformeClasificable {
  producto?: unknown;
  empaque?: unknown;
  formato_caja?: unknown;
  grupo_destino?: unknown;
  linea?: unknown;
  destino?: unknown;
  situacion?: unknown;
  categoria?: unknown;
  category?: unknown;
}

export interface ProductoInformeClasificacion {
  zona: ZonaProductoInforme;
  computaKgZona: boolean;
  motivo: string;
}

export function clasificarProductoInforme(
  item: ProductoInformeClasificable,
  overrides: ProductoInformeOverrides = {},
): ProductoInformeClasificacion {
  const producto = normalizarTexto(item.producto);
  const empaque = normalizarTexto(item.empaque ?? item.formato_caja);
  const override = overrides[productoOverrideKey(item)];
  if (override) return buildClasificacion(override, "override_manual");

  const text = [
    item.producto,
    item.empaque,
    item.formato_caja,
    item.grupo_destino,
    item.linea,
    item.destino,
    item.situacion,
    item.categoria,
    item.category,
  ].map(normalizarTexto).filter(Boolean).join(" ");

  if (!producto) return buildClasificacion("Excluir", "sin_producto");
  if (/\b(total|totales|subtotal|suma|gran total)\b/.test(text)) {
    return buildClasificacion("Excluir", "total");
  }
  if (
    /\b(muestra|prueba|podrido|podrida|punta|reciclado|egipto)\b/.test(text) ||
    /\bnada\b/.test(empaque) ||
    /\b(citrica|citricas|citrico|citricos|citrus|cit)\b/.test(text) ||
    /\b(pre|precal|precalibrado|prec|precalibrada)\b/.test(text)
  ) {
    return buildClasificacion("Excluir", "fuera_rendimiento");
  }
  if (/\b(industria|industr)\b/.test(text)) return buildClasificacion("Industria", "industria");
  if (/\b(granel|granelera|graneleras|bulk|rpack)\b/.test(producto)) {
    return buildClasificacion("Graneleras", "granel");
  }
  if (
    /\b(malla|malladora|mdna|mercadona|girs|girsac)\b/.test(producto) ||
    /\bd[-\s]?pack\b/.test(producto)
  ) {
    return buildClasificacion("Mallas", "mallas");
  }

  return buildClasificacion("Mesas", "envasado_por_defecto");
}

export function zonaRendimientoDesdeClasificacion(zona: ZonaProductoInforme) {
  if (zona === "Mesas") return "Envasadoras";
  if (zona === "Graneleras") return "Graneleras";
  if (zona === "Mallas" || zona === "Industria") return zona;
  return null;
}

export function productoOverrideKey(item: ProductoInformeClasificable) {
  return [
    item.producto,
    item.empaque ?? item.formato_caja,
  ].map(normalizarTexto).join("|");
}

function buildClasificacion(zona: ZonaProductoInforme, motivo: string): ProductoInformeClasificacion {
  return {
    zona,
    computaKgZona: zona !== "Excluir",
    motivo,
  };
}

function normalizarTexto(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}
