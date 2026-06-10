export const RENDIMIENTO_GRUPOS = ["Envasadoras", "Mallas", "Graneleras"] as const;

export type RendimientoGrupoKey = typeof RENDIMIENTO_GRUPOS[number];

export interface GrupoRendimiento {
  kg: number;
  personas: number;
}

export type RendimientoGrupos = Record<RendimientoGrupoKey, GrupoRendimiento>;

interface TrabajadorRendimiento {
  id: string;
  zona?: string | null;
}

interface CalcularRendimientoInput {
  parte: any;
  trabajadores: TrabajadorRendimiento[];
  asistencia: Record<string, boolean>;
}

function num(value: unknown): number {
  return Number(value) || 0;
}

export function produccionRealParte(parte: any): number {
  if (!parte) return 0;
  const produccionCascada = num(
    parte?.resumen_ia?.cascada?.produccion_real ??
      parte?.cascade?.produccion_real ??
      parte?.cascada?.produccion_real
  );
  if (produccionCascada > 0) return produccionCascada;

  return Math.max(
    0,
    num(parte.kg_produccion_calibrador) -
      num(parte.kg_mujeres_calibrador) -
      num(parte.kg_reciclado_malla_z1) -
      num(parte.kg_reciclado_malla_z2)
  );
}

function normalizarTexto(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function textoExclusionItem(item: any): string {
  return [
    item?.producto,
    item?.grupo_destino,
    item?.linea,
    item?.destino,
    item?.situacion,
  ].map(normalizarTexto).filter(Boolean).join(" ");
}

function esLineaTotal(value: unknown): boolean {
  const text = normalizarTexto(value);
  return /\b(total|totales|subtotal|suma|gran total)\b/.test(text);
}

function esFilaTotal(item: any): boolean {
  return [
    item?.producto,
    item?.linea,
    item?.grupo_destino,
    item?.destino,
    item?.formato_caja,
    item?.situacion,
  ].some(esLineaTotal);
}

function esExcluidoRendimiento(item: any): boolean {
  const text = textoExclusionItem(item);
  if (!text) return true;
  return (
    /\b(industria|industr|muestra|podrido|podrida|punta|reciclado|campo|egipto)\b/.test(text) ||
    /\b(citrica|citricas|citrico|citricos|citrus|cit)\b/.test(text) ||
    /\b(pre|precal|precalibrado|prec|precalibrada)\b/.test(text)
  );
}

function normalizarGrupoConfeccion(value: unknown): RendimientoGrupoKey | null {
  const text = normalizarTexto(value);
  if (!text) return null;
  if (/\b(granel|granelera|graneleras|bulk)\b/.test(text)) return "Graneleras";
  if (/\b(malla|mallas|malladora|malladoras)\b/.test(text)) return "Mallas";
  if (/\b(envasado|envasados|envasadora|envasadoras|encajado|caja|empacado|empaque)\b/.test(text)) {
    return "Envasadoras";
  }
  return null;
}

function grupoProductoNombre(producto: unknown): RendimientoGrupoKey | null {
  const text = normalizarTexto(producto);
  if (!text) return null;
  if (/\b(granel|granelera|bulk)\b/.test(text)) return "Graneleras";
  if (/\b(malla|malladora|mdna|mercadona)\b/.test(text) || /\bd[-\s]?pack\b/.test(text)) return "Mallas";
  return null;
}

function grupoProductoDia(item: any): RendimientoGrupoKey | null {
  if (esFilaTotal(item) || esExcluidoRendimiento(item)) return null;

  const grupoProducto = grupoProductoNombre(item?.producto);
  if (grupoProducto) return grupoProducto;

  const explicit =
    normalizarGrupoConfeccion(item?.grupo_destino) ??
    normalizarGrupoConfeccion(item?.linea) ??
    normalizarGrupoConfeccion(item?.formato_caja);
  if (explicit) return explicit;

  return normalizarTexto(item?.producto) ? "Envasadoras" : null;
}

function kgProducto(item: any): number {
  return num(item?.kg ?? item?.kg_neto);
}

function getProductoDetalle(parte: any): any[] {
  const detalleDb = parte?.producto_dia;
  if (Array.isArray(detalleDb) && detalleDb.length > 0) return detalleDb;

  const detalleIa = parte?.resumen_ia?.producto_detalle;
  return Array.isArray(detalleIa) ? detalleIa : [];
}

function getPaletsFallback(parte: any): any[] {
  const paletsIa = parte?.resumen_ia?.palets_detalle;
  return Array.isArray(paletsIa) ? paletsIa : [];
}

function gruposVacios(): RendimientoGrupos {
  return {
    Envasadoras: { kg: 0, personas: 0 },
    Mallas: { kg: 0, personas: 0 },
    Graneleras: { kg: 0, personas: 0 },
  };
}

function ajustarGruposAProduccionReal(grupos: RendimientoGrupos, parte: any) {
  const produccionReal = produccionRealParte(parte);
  const totalGrupos = totalKgRendimiento(grupos);
  if (produccionReal <= 0 || totalGrupos <= 0) return;

  const factor = produccionReal / totalGrupos;
  for (const grupo of RENDIMIENTO_GRUPOS) {
    grupos[grupo].kg *= factor;
  }
}

export function calcularRendimientoGrupos({
  parte,
  trabajadores,
  asistencia,
}: CalcularRendimientoInput): RendimientoGrupos {
  const grupos = gruposVacios();

  const addKg = (grupo: RendimientoGrupoKey | null, kg: number) => {
    if (grupo && kg > 0) grupos[grupo].kg += kg;
  };

  const detalle = getProductoDetalle(parte);
  if (detalle.length > 0) {
    for (const item of detalle) {
      addKg(grupoProductoDia(item), kgProducto(item));
    }
    ajustarGruposAProduccionReal(grupos, parte);
  } else {
    for (const item of getPaletsFallback(parte)) {
      addKg(grupoProductoDia(item), kgProducto(item));
    }
    ajustarGruposAProduccionReal(grupos, parte);
  }

  for (const trabajador of trabajadores) {
    const grupo = normalizarGrupoConfeccion(trabajador.zona);
    if (grupo && asistencia[trabajador.id] === true) grupos[grupo].personas++;
  }

  return grupos;
}

export function totalKgRendimiento(grupos: RendimientoGrupos): number {
  return RENDIMIENTO_GRUPOS.reduce((sum, grupo) => sum + grupos[grupo].kg, 0);
}

export function totalPersonasRendimiento(grupos: RendimientoGrupos): number {
  return RENDIMIENTO_GRUPOS.reduce((sum, grupo) => sum + grupos[grupo].personas, 0);
}
