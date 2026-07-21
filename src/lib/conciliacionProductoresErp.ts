/**
 * conciliacionProductoresErp — corrige los vínculos productor ↔ entradas de
 * la herramienta usando como fuente de verdad el "LISTADO DE ENTRADAS POR
 * PROVEEDOR" del ERP (informe productores.xlsx, export de Crystal Reports).
 *
 * Ese informe trae, para CADA entrada, el productor correcto (código de 9
 * dígitos + razón social) y su finca/parcela — y el código de lote (AAMMDDNN),
 * que es la misma clave que entradas_bascula.lote. Eso permite corregir
 * lote a lote sin adivinar nada por texto:
 *
 *   1. `parseInformeProveedoresErp` — lee el xlsx jerárquico del ERP
 *      (productor → finca → parcela → fecha → nº entrada → detalle → artículo)
 *      y devuelve una fila plana por entrada.
 *   2. `planConciliacionProductores` — compara contra las entradas y el
 *      catálogo/alias actuales y produce un plan: productores a crear,
 *      entradas cuyo productor_id hay que corregir, y alias a crear /
 *      re-apuntar / eliminar (los ambiguos, que causaban los enlaces mal).
 *
 * Módulo puro (sin Supabase/React): el diálogo
 * ConciliarProductoresDialog.tsx se encarga de aplicar el plan.
 */
import { normalizarLoteCodigo } from "@/lib/loteCodigo";
import { normalizeProductorName } from "@/lib/productoresCanonicos";

// ─── 1. Parser del informe del ERP ──────────────────────────────────────────

export interface RegistroErp {
  productorCodigo: string;
  productorNombre: string;
  finca: string | null;
  parcela: string | null;
  /** Fecha ISO aaaa-mm-dd. */
  fecha: string | null;
  /** Código de lote normalizado (AAMMDDNN), clave contra entradas_bascula.lote. */
  lote: string;
  kg: number;
}

export interface InformeErpParseado {
  registros: RegistroErp[];
  /** Nº de filas del xlsx que no encajaron en ningún patrón conocido. */
  filasNoReconocidas: number;
  /** TOTAL GENERAL del propio informe (kg), para cuadre visual. `null` si no aparece. */
  totalGeneralKg: number | null;
}

const FECHA_DDMMYYYY = /^(\d{2})\/(\d{2})\/(\d{4})$/;
/** Nº de entrada del ERP: dígitos con puntos de millar y espacios a la izquierda ("   16.145"). */
const NUM_ENTRADA = /^\s+[\d.]+$/;
const CODIGO_PRODUCTOR = /^\d{9}$/;

function celda(v: unknown): string {
  return v == null ? "" : String(v).trim();
}

function fechaISO(ddmmyyyy: string): string | null {
  const m = FECHA_DDMMYYYY.exec(ddmmyyyy);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

/**
 * Parsea las filas crudas (XLSX.utils.sheet_to_json con header:1) del
 * "LISTADO DE ENTRADAS POR PROVEEDOR". Estructura por filas (verificada
 * contra el export real de jul-2026):
 *   - productor:   [código 9 dígitos, razón social]            (col C vacía)
 *   - finca/parcela: una sola celda de texto (finca primero; tras
 *     "TOTAL Parcela" la siguiente celda suelta es otra parcela, tras
 *     "TOTAL Finca" es otra finca)
 *   - fecha:       [dd/mm/aaaa]
 *   - nº entrada:  ["   16.145", "*"?]
 *   - detalle:     [albarán, tipología, imp. transp, imp. comis, imp. recolec]
 *   - artículo:    [referencia, denominación, LOTE, env. llenos, env. vacíos, KILOS, %destrío, %dscho]
 */
export function parseInformeProveedoresErp(rows: unknown[][]): InformeErpParseado {
  const registros: RegistroErp[] = [];
  let filasNoReconocidas = 0;
  let totalGeneralKg: number | null = null;

  let productorCodigo: string | null = null;
  let productorNombre: string | null = null;
  let finca: string | null = null;
  let parcela: string | null = null;
  let fecha: string | null = null;
  let estado: "" | "espera_detalle" | "espera_articulo" = "";

  for (const row of rows) {
    const c1 = row?.[0];
    if (c1 == null || celda(c1) === "") continue;
    const s1 = celda(c1);
    const c2 = row[1];
    const c3 = row[2];

    if (s1 === "TOTAL Parcela") { parcela = null; continue; }
    if (s1 === "TOTAL Finca") { finca = null; parcela = null; continue; }
    if (s1 === "TOTAL PROVEEDOR") { productorCodigo = null; productorNombre = null; finca = null; parcela = null; continue; }
    if (s1 === "TOTAL GENERAL") {
      const kg = Number(row[3]);
      if (Number.isFinite(kg)) totalGeneralKg = kg;
      continue;
    }
    // Cabeceras repetidas del informe (paginado del ERP).
    if (s1.startsWith("Fecha")) continue;

    if (FECHA_DDMMYYYY.test(s1)) { fecha = fechaISO(s1); continue; }

    if (typeof c1 === "string" && NUM_ENTRADA.test(c1)) { estado = "espera_detalle"; continue; }

    // Productor: código de 9 dígitos + nombre, SIN tercera columna (las filas
    // de artículo también empiezan por 9 dígitos pero siempre traen lote en la 3ª).
    if (CODIGO_PRODUCTOR.test(s1) && celda(c2) !== "" && celda(c3) === "") {
      productorCodigo = s1;
      productorNombre = celda(c2);
      finca = null;
      parcela = null;
      estado = "";
      continue;
    }

    if (estado === "espera_detalle" && celda(c2) !== "") { estado = "espera_articulo"; continue; }

    if (estado === "espera_articulo" && celda(c2) !== "" && celda(c3) !== "") {
      const lote = normalizarLoteCodigo(celda(c3));
      if (lote && productorCodigo && productorNombre) {
        registros.push({
          productorCodigo,
          productorNombre,
          finca,
          parcela,
          fecha,
          lote,
          kg: Number(row[5]) || 0,
        });
      } else {
        filasNoReconocidas += 1;
      }
      continue;
    }

    // Celda de texto suelta: finca (si no hay) o parcela.
    if (celda(c2) === "") {
      if (finca === null) finca = s1;
      else parcela = s1;
      continue;
    }

    filasNoReconocidas += 1;
  }

  return { registros, filasNoReconocidas, totalGeneralKg };
}

// ─── 2. Plan de conciliación ────────────────────────────────────────────────

export interface EntradaConciliacionInput {
  id: string;
  lote: string;
  agricultor: string | null;
  productor_id: string | null;
}

export interface ProductorCatalogoConciliacion {
  id: string;
  nombre: string;
  /** Código de proveedor del ERP (migración 20260721120000). `null`/ausente si la ficha no está anclada aún. */
  codigo_erp?: string | null;
}

/** Productor destino de una corrección: uno del catálogo o uno nuevo del ERP aún sin crear. */
export type TargetProductor =
  | { tipo: "existente"; productorId: string; nombre: string }
  | { tipo: "nuevo"; codigo: string; nombre: string };

export interface AsignacionLote {
  entradaId: string;
  lote: string;
  /** productor_id actual de la entrada (null = sin vincular). */
  productorIdActual: string | null;
  target: TargetProductor;
}

export type AliasAccion =
  | { tipo: "crear"; alias: string; aliasNormalizado: string; target: TargetProductor }
  | { tipo: "reapuntar"; alias: string; aliasNormalizado: string; productorIdActual: string; target: TargetProductor }
  | { tipo: "eliminar_ambiguo"; alias: string; aliasNormalizado: string; nombresDestino: string[] };

export interface FichaActualizar {
  productorId: string;
  /** Código del ERP a grabar en la ficha (siempre presente: asignación nueva o confirmación). */
  codigo: string;
  nombreAnterior: string;
  /** Nombre oficial del ERP si difiere del actual (ERP manda); `null` si el nombre ya coincide. */
  nombreNuevo: string | null;
}

export interface PlanConciliacionProductores {
  /** Productores del ERP sin correspondencia en catálogo ni alias: hay que crearlos (con su código). */
  productoresNuevos: Array<{ codigo: string; nombre: string }>;
  /** Fichas existentes a las que hay que grabar el código del ERP y/o actualizar el nombre al oficial. */
  fichasActualizar: FichaActualizar[];
  /** Productores del ERP cuyo código apuntaría a una ficha ya reclamada por OTRO código: se omiten y se listan aquí. */
  conflictosCodigo: string[];
  /** Entradas cuyo productor_id hay que poner/corregir. */
  asignaciones: AsignacionLote[];
  /** Nº de entradas cubiertas por el ERP que ya estaban bien vinculadas. */
  entradasYaCorrectas: number;
  aliasAcciones: AliasAccion[];
  /** Lotes del informe ERP que no existen en entradas_bascula (muestra). */
  lotesErpSinEntrada: string[];
  /** Totales del informe para el resumen del diálogo. */
  totales: { registrosErp: number; kgErp: number; productoresErp: number };
}

export function planConciliacionProductores(
  registros: RegistroErp[],
  entradas: EntradaConciliacionInput[],
  catalogo: ProductorCatalogoConciliacion[],
  aliasPorNombreNormalizado: Map<string, string>,
): PlanConciliacionProductores {
  const nombrePorId = new Map(catalogo.map((p) => [p.id, p.nombre]));
  const catalogoPorCodigo = new Map<string, ProductorCatalogoConciliacion>();
  const codigoPorId = new Map<string, string>();
  for (const p of catalogo) {
    if (p.codigo_erp) {
      if (!catalogoPorCodigo.has(p.codigo_erp)) catalogoPorCodigo.set(p.codigo_erp, p);
      codigoPorId.set(p.id, p.codigo_erp);
    }
  }
  const catalogoPorNorm = new Map<string, ProductorCatalogoConciliacion>();
  for (const p of catalogo) {
    const norm = normalizeProductorName(p.nombre);
    if (norm && !catalogoPorNorm.has(norm)) catalogoPorNorm.set(norm, p);
  }

  // Productor destino por código ERP. Prioridad de resolución (decisión del
  // dueño 2026-07-21, el ERP es el origen principal de identidad):
  //   1. codigo_erp — identidad estable; si el nombre del catálogo difiere del
  //      del ERP, se renombra la ficha (el nombre viejo queda como alias).
  //   2. Nombre EXACTO del catálogo — se le graba el código.
  //   3. Alias — puede estar mal apuntado (es justo lo que esta conciliación
  //      corrige), por eso va el último; también se graba código + nombre ERP.
  //   4. Nuevo — se crea con nombre y código del ERP.
  const targetPorCodigo = new Map<string, TargetProductor>();
  const productoresNuevos: Array<{ codigo: string; nombre: string }> = [];
  const fichasActualizar: FichaActualizar[] = [];
  const conflictosCodigo: string[] = [];
  const idsReclamados = new Map<string, string>(); // productorId → codigo que lo reclamó

  for (const r of registros) {
    if (targetPorCodigo.has(r.productorCodigo)) continue;
    const norm = normalizeProductorName(r.productorNombre);

    const porCodigo = catalogoPorCodigo.get(r.productorCodigo);
    const porNombre = !porCodigo ? catalogoPorNorm.get(norm) : undefined;
    const aliasId = !porCodigo && !porNombre && norm ? aliasPorNombreNormalizado.get(norm) : undefined;
    const existente = porCodigo
      ?? porNombre
      ?? (aliasId ? { id: aliasId, nombre: nombrePorId.get(aliasId) ?? r.productorNombre, codigo_erp: codigoPorId.get(aliasId) ?? null } : undefined);

    if (!existente) {
      targetPorCodigo.set(r.productorCodigo, { tipo: "nuevo", codigo: r.productorCodigo, nombre: r.productorNombre });
      productoresNuevos.push({ codigo: r.productorCodigo, nombre: r.productorNombre });
      continue;
    }

    // Guarda: una ficha con OTRO código (o ya reclamada por otro código en este
    // mismo plan) no puede recibir este — sería fundir dos proveedores del ERP.
    const codigoActual = existente.codigo_erp ?? idsReclamados.get(existente.id) ?? null;
    if (codigoActual && codigoActual !== r.productorCodigo) {
      conflictosCodigo.push(`${r.productorCodigo} ${r.productorNombre} → la ficha "${existente.nombre}" ya pertenece al código ${codigoActual}`);
      targetPorCodigo.set(r.productorCodigo, { tipo: "nuevo", codigo: r.productorCodigo, nombre: r.productorNombre });
      productoresNuevos.push({ codigo: r.productorCodigo, nombre: r.productorNombre });
      continue;
    }

    const nombreCambia = normalizeProductorName(existente.nombre) !== norm;
    if (!existente.codigo_erp || nombreCambia) {
      fichasActualizar.push({
        productorId: existente.id,
        codigo: r.productorCodigo,
        nombreAnterior: existente.nombre,
        nombreNuevo: nombreCambia ? r.productorNombre : null,
      });
    }
    idsReclamados.set(existente.id, r.productorCodigo);
    targetPorCodigo.set(r.productorCodigo, {
      tipo: "existente",
      productorId: existente.id,
      nombre: nombreCambia ? r.productorNombre : existente.nombre,
    });
  }

  // Lote → productor ERP. El lote es único en el informe; si reapareciera con
  // otro productor gana la primera aparición (no se ha visto en datos reales).
  const codigoPorLote = new Map<string, string>();
  for (const r of registros) {
    if (!codigoPorLote.has(r.lote)) codigoPorLote.set(r.lote, r.productorCodigo);
  }

  const asignaciones: AsignacionLote[] = [];
  let entradasYaCorrectas = 0;
  const lotesEncontrados = new Set<string>();
  // Texto crudo de agricultor → productores ERP destino que le tocan (para alias).
  const targetsPorAgricultor = new Map<string, { alias: string; codigos: Set<string> }>();

  for (const e of entradas) {
    const lote = normalizarLoteCodigo(e.lote);
    if (!lote) continue;
    const codigo = codigoPorLote.get(lote);
    if (!codigo) continue;
    lotesEncontrados.add(lote);
    const target = targetPorCodigo.get(codigo)!;

    const targetId = target.tipo === "existente" ? target.productorId : null;
    if (target.tipo === "nuevo" || e.productor_id !== targetId) {
      asignaciones.push({ entradaId: e.id, lote, productorIdActual: e.productor_id, target });
    } else {
      entradasYaCorrectas += 1;
    }

    const alias = (e.agricultor ?? "").trim();
    const norm = normalizeProductorName(alias);
    if (norm) {
      const acc = targetsPorAgricultor.get(norm) ?? { alias, codigos: new Set<string>() };
      acc.codigos.add(codigo);
      targetsPorAgricultor.set(norm, acc);
    }
  }

  // Alias: si TODAS las entradas con ese texto de agricultor pertenecen a un
  // único productor del ERP, el alias debe apuntar ahí; si el ERP demuestra
  // que ese texto mezcla varios productores, un alias es imposible de
  // resolver por nombre y, de existir, hay que eliminarlo (era la fuente de
  // los enlaces mal: el trigger asignaba TODO ese texto al mismo productor).
  const aliasAcciones: AliasAccion[] = [];
  for (const [norm, { alias, codigos }] of targetsPorAgricultor) {
    const aliasActual = aliasPorNombreNormalizado.get(norm) ?? null;
    if (codigos.size === 1) {
      const target = targetPorCodigo.get([...codigos][0])!;
      const targetId = target.tipo === "existente" ? target.productorId : null;
      if (aliasActual === null) {
        aliasAcciones.push({ tipo: "crear", alias, aliasNormalizado: norm, target });
      } else if (target.tipo === "nuevo" || aliasActual !== targetId) {
        aliasAcciones.push({ tipo: "reapuntar", alias, aliasNormalizado: norm, productorIdActual: aliasActual, target });
      }
    } else if (aliasActual !== null) {
      const nombresDestino = [...codigos].map((c) => targetPorCodigo.get(c)!.nombre).sort();
      aliasAcciones.push({ tipo: "eliminar_ambiguo", alias, aliasNormalizado: norm, nombresDestino });
    }
  }

  const lotesErpSinEntrada = [...codigoPorLote.keys()].filter((l) => !lotesEncontrados.has(l));

  return {
    productoresNuevos,
    fichasActualizar,
    conflictosCodigo,
    asignaciones,
    entradasYaCorrectas,
    aliasAcciones,
    lotesErpSinEntrada,
    totales: {
      registrosErp: registros.length,
      kgErp: registros.reduce((s, r) => s + r.kg, 0),
      productoresErp: targetPorCodigo.size,
    },
  };
}

/**
 * Vinculación POR ALIAS de las filas que el informe del ERP no cubre por lote
 * (otras campañas, rangos sin exportar…): si el ERP demostró que un texto de
 * agricultor pertenece a UN único productor (acción de alias "crear" /
 * "reapuntar" del plan), las filas restantes con ese mismo texto se vinculan
 * al mismo productor. Es el mismo criterio que ya aplica el trigger de BD con
 * los alias — aquí solo se hace retroactivo tras la conciliación.
 */
export function planVinculacionPorAlias(
  entradas: EntradaConciliacionInput[],
  asignacionesPorLote: AsignacionLote[],
  aliasAcciones: AliasAccion[],
): Array<{ entradaId: string; target: TargetProductor }> {
  const cubiertas = new Set(asignacionesPorLote.map((a) => a.entradaId));
  const targetPorNorm = new Map<string, TargetProductor>();
  for (const a of aliasAcciones) {
    if (a.tipo === "crear" || a.tipo === "reapuntar") targetPorNorm.set(a.aliasNormalizado, a.target);
  }
  const resultado: Array<{ entradaId: string; target: TargetProductor }> = [];
  for (const e of entradas) {
    if (cubiertas.has(e.id)) continue;
    const norm = normalizeProductorName((e.agricultor ?? "").trim());
    const target = norm ? targetPorNorm.get(norm) : undefined;
    if (!target) continue;
    const targetId = target.tipo === "existente" ? target.productorId : null;
    if (target.tipo === "nuevo" || e.productor_id !== targetId) {
      resultado.push({ entradaId: e.id, target });
    }
  }
  return resultado;
}
