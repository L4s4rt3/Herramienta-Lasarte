export const RENDIMIENTO_GRUPOS = ["Envasadoras", "Mallas", "Graneleras"] as const;
export const TRATAMIENTO_GRUPOS = ["Produccion", "Aereo", "Tria podrido", "Punta", "Volcador", "Mecanica", "Carretilla"] as const;
export const EXCLUIDOS_KG_PERSONA = ["Carga y descarga"] as const;

export type RendimientoGrupoKey = typeof RENDIMIENTO_GRUPOS[number];
export type TipoCostePersona = "grupo" | "tratamiento" | "general" | "no_computa" | "sin_grupo";
type ParteRendimiento = Record<string, unknown>;
type ProductoRendimiento = Record<string, unknown>;

export interface GrupoRendimiento {
  kg: number;
  personas: number;
}

export type RendimientoGrupos = Record<RendimientoGrupoKey, GrupoRendimiento>;

interface TrabajadorRendimiento {
  id: string;
  nombre?: string | null;
  zona?: string | null;
}

interface CalcularRendimientoInput {
  parte: ParteRendimiento | null | undefined;
  trabajadores: TrabajadorRendimiento[];
  asistencia: Record<string, boolean>;
}

export interface PersonaRendimiento {
  id: string;
  nombre: string;
  zona: string;
  presente: boolean;
  cuentaKgPersona: boolean;
  tipoCoste: TipoCostePersona;
  grupoDirecto: RendimientoGrupoKey | null;
  kgDirectosPersona: number;
  kgGeneralPersona: number;
  kgReferenciaPersona: number;
}

function num(value: unknown): number {
  return Number(value) || 0;
}

function getRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function getPath(value: unknown, path: string[]): unknown {
  let current: unknown = value;
  for (const key of path) {
    const record = getRecord(current);
    if (!record) return undefined;
    current = record[key];
  }
  return current;
}

export function produccionRealParte(parte: ParteRendimiento | null | undefined): number {
  if (!parte) return 0;
  const produccionCascada = num(
    getPath(parte, ["resumen_ia", "cascada", "produccion_real"]) ??
      getPath(parte, ["cascade", "produccion_real"]) ??
      getPath(parte, ["cascada", "produccion_real"])
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

function textoExclusionItem(item: ProductoRendimiento): string {
  return [
    item.producto,
    item.grupo_destino,
    item.linea,
    item.destino,
    item.situacion,
  ].map(normalizarTexto).filter(Boolean).join(" ");
}

function esLineaTotal(value: unknown): boolean {
  const text = normalizarTexto(value);
  return /\b(total|totales|subtotal|suma|gran total)\b/.test(text);
}

function esFilaTotal(item: ProductoRendimiento): boolean {
  return [
    item.producto,
    item.linea,
    item.grupo_destino,
    item.destino,
    item.formato_caja,
    item.situacion,
  ].some(esLineaTotal);
}

function esExcluidoRendimiento(item: ProductoRendimiento): boolean {
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

export function grupoRendimientoTrabajador(trabajador: TrabajadorRendimiento): RendimientoGrupoKey | null {
  return normalizarGrupoConfeccion(trabajador.zona);
}

export function tipoCosteTrabajador(trabajador: TrabajadorRendimiento): TipoCostePersona {
  if (grupoRendimientoTrabajador(trabajador)) return "grupo";
  const zona = normalizarTexto(trabajador.zona);
  if (!zona) return "sin_grupo";
  if (EXCLUIDOS_KG_PERSONA.some((grupo) => normalizarTexto(grupo) === zona)) return "no_computa";
  return TRATAMIENTO_GRUPOS.some((grupo) => normalizarTexto(grupo) === zona) ? "tratamiento" : "general";
}

export function etiquetaTipoCoste(tipo: TipoCostePersona) {
  if (tipo === "grupo") return "Coste de grupo";
  if (tipo === "tratamiento") return "Linea tratamiento";
  if (tipo === "general") return "Coste general";
  if (tipo === "no_computa") return "No computa kg/p";
  return "Sin grupo";
}

export function cuentaTrabajadorKgPersona(trabajador: TrabajadorRendimiento): boolean {
  return tipoCosteTrabajador(trabajador) !== "no_computa";
}

function grupoProductoNombre(producto: unknown): RendimientoGrupoKey | null {
  const text = normalizarTexto(producto);
  if (!text) return null;
  if (/\b(granel|granelera|bulk)\b/.test(text)) return "Graneleras";
  if (/\b(malla|malladora|mdna|mercadona)\b/.test(text) || /\bd[-\s]?pack\b/.test(text)) return "Mallas";
  return null;
}

function grupoProductoDia(item: ProductoRendimiento): RendimientoGrupoKey | null {
  if (esFilaTotal(item) || esExcluidoRendimiento(item)) return null;

  const grupoProducto = grupoProductoNombre(item.producto);
  if (grupoProducto) return grupoProducto;

  const explicit =
    normalizarGrupoConfeccion(item.grupo_destino) ??
    normalizarGrupoConfeccion(item.linea) ??
    normalizarGrupoConfeccion(item.formato_caja);
  if (explicit) return explicit;

  return normalizarTexto(item.producto) ? "Envasadoras" : null;
}

function kgProducto(item: ProductoRendimiento): number {
  return num(item.kg ?? item.kg_neto);
}

function getProductoDetalle(parte: ParteRendimiento | null | undefined): ProductoRendimiento[] {
  const detalleDb = getPath(parte, ["producto_dia"]);
  if (Array.isArray(detalleDb) && detalleDb.length > 0) return detalleDb;

  const detalleIa = getPath(parte, ["resumen_ia", "producto_detalle"]);
  return Array.isArray(detalleIa) ? detalleIa : [];
}

function getPaletsFallback(parte: ParteRendimiento | null | undefined): ProductoRendimiento[] {
  const paletsIa = getPath(parte, ["resumen_ia", "palets_detalle"]);
  return Array.isArray(paletsIa) ? paletsIa : [];
}

function gruposVacios(): RendimientoGrupos {
  return {
    Envasadoras: { kg: 0, personas: 0 },
    Mallas: { kg: 0, personas: 0 },
    Graneleras: { kg: 0, personas: 0 },
  };
}

function ajustarGruposAProduccionReal(grupos: RendimientoGrupos, parte: ParteRendimiento | null | undefined) {
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
    const grupo = grupoRendimientoTrabajador(trabajador);
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

export function calcularRendimientoPersonas({
  trabajadores,
  asistencia,
  grupos,
  kgGeneralBase,
}: {
  trabajadores: TrabajadorRendimiento[];
  asistencia: Record<string, boolean>;
  grupos: RendimientoGrupos;
  kgGeneralBase: number;
}): PersonaRendimiento[] {
  const presentes = trabajadores.filter((trabajador) => asistencia[trabajador.id] === true && cuentaTrabajadorKgPersona(trabajador)).length;
  const kgGeneralPersona = presentes > 0 ? kgGeneralBase / presentes : 0;

  return trabajadores
    .map((trabajador) => {
      const presente = asistencia[trabajador.id] === true;
      const cuentaKgPersona = cuentaTrabajadorKgPersona(trabajador);
      const grupoDirecto = grupoRendimientoTrabajador(trabajador);
      const grupoData = grupoDirecto ? grupos[grupoDirecto] : null;
      const kgDirectosPersona = presente && grupoData && grupoData.personas > 0
        ? grupoData.kg / grupoData.personas
        : 0;
      const tipoCoste = tipoCosteTrabajador(trabajador);

      return {
        id: trabajador.id,
        nombre: trabajador.nombre ?? "Sin nombre",
        zona: trabajador.zona ?? "Sin grupo",
        presente,
        cuentaKgPersona,
        tipoCoste,
        grupoDirecto,
        kgDirectosPersona,
        kgGeneralPersona: presente && cuentaKgPersona ? kgGeneralPersona : 0,
        kgReferenciaPersona: presente && cuentaKgPersona ? (kgDirectosPersona || kgGeneralPersona) : 0,
      };
    })
    .sort((a, b) => {
      if (a.presente !== b.presente) return a.presente ? -1 : 1;
      if (a.tipoCoste !== b.tipoCoste) return a.tipoCoste.localeCompare(b.tipoCoste);
      return a.nombre.localeCompare(b.nombre, "es");
    });
}
