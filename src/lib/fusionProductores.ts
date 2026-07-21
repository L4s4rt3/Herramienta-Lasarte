/**
 * fusionProductores — detección de productores DUPLICADOS en el catálogo
 * (calidad_productores) para fusionarlos en uno canónico.
 *
 * El catálogo se pobló desde tres fuentes de texto libre (báscula, calibrador,
 * calidad) más el informe del ERP, y el mismo productor real acabó repetido
 * con variantes del nombre. Se detectan TRES clases de variante:
 *
 *   1. Mismo nombre base (sin formas legales ni el prefijo "LASARTE EXPORT"):
 *      "EL ESPARRAGAL" = "EL ESPARRAGAL S.A." = "LASARTE EXPORT EL ESPARRAGAL".
 *   2. Nombre parcial: las palabras distintivas de uno están contenidas en el
 *      otro — "SOMISUR" ⊂ "AGRICOLA SOMISUR S.L.", "JUARRANZ" ⊂ "JUARRANZ
 *      ROMERO, JOSE MARIA", "Josefa Gomez" ⊂ "Josefa Gomez Dominguez".
 *   3. Erratas de una letra en palabras largas: "ESPARAGAL" ≈ "ESPARRAGAL".
 *
 * GUARDA DE AMBIGÜEDAD: si un nombre parcial encaja con VARIOS productores
 * distintos ("CARRANZA" vale para "Carranza Naranjo" y "Carranza Pelaez"),
 * NO se fusiona automáticamente — sale en `ambiguos` para que el admin elija
 * el destino a mano. Preferimos un duplicado visible a una fusión equivocada.
 *
 * SOLO detección (módulo puro, testeable): la fusión real la aplica
 * FusionarProductoresDialog.tsx con confirmación del admin por grupo.
 */
import { normalizeProductorName } from "@/lib/productoresCanonicos";

/** Formas legales y abreviaturas societarias que NO distinguen productores. */
const TOKENS_LEGALES = new Set([
  "sa", "sl", "slu", "sll", "srl", "sat", "sc", "scp", "sca", "scv", "cb", "coop", "cooperativa",
]);

/** Artículos/conjunciones sin valor identificativo. */
const TOKENS_VACIOS = new Set(["de", "del", "la", "las", "el", "los", "y", "e", "en", "d"]);

/**
 * Palabras genéricas del sector que acompañan al nombre pero no lo distinguen
 * ("AGRICOLA SOMISUR" y "SOMISUR" son el mismo). Solo se ignoran en el lado
 * PEQUEÑO de la comparación por subconjunto; en el nombre completo se conservan.
 */
const TOKENS_GENERICOS = new Set([
  "agricola", "agricolas", "agro", "agricultura", "cultivos", "explotacion", "explotaciones",
  "export", "exportacion", "citricos", "citrica", "citricas", "naranjas", "naranja", "frutas", "fruta",
  "campo", "hijos", "hnos", "hermanos", "finca", "fincas",
]);

function tokenize(nombre: string | null | undefined): string[] {
  const normalizado = normalizeProductorName(nombre).replace(/[.,\-–_/]/g, " ");
  let tokens = normalizado.split(/\s+/).filter(Boolean);
  if (tokens[0] === "lasarte" && tokens[1] === "export") {
    tokens = tokens.slice(2);
    while (tokens.length > 0 && ["s", "l", "sl"].includes(tokens[0])) tokens.shift();
  }
  return tokens.filter((t) => t.length > 1 && !TOKENS_LEGALES.has(t) && !TOKENS_VACIOS.has(t));
}

/**
 * "Nombre base" para agrupar por igualdad exacta: tokens sin formas legales
 * ni prefijo comercial, unidos. "" si no queda nada significativo.
 */
export function nombreBaseProductor(nombre: string | null | undefined): string {
  return tokenize(nombre).join(" ");
}

/** Tokens que de verdad identifican al productor (sin genéricos del sector). */
export function tokensDistintivos(nombre: string | null | undefined): string[] {
  return tokenize(nombre).filter((t) => !TOKENS_GENERICOS.has(t));
}

/** Distancia de edición ≤ 1 entre palabras largas (erratas de una letra). */
function tokenSimilar(a: string, b: string): boolean {
  if (a === b) return true;
  const la = a.length;
  const lb = b.length;
  if (Math.min(la, lb) < 5 || Math.abs(la - lb) > 1) return false;
  // Levenshtein acotado a 1: una sustitución (misma longitud) o una inserción.
  if (la === lb) {
    let diff = 0;
    for (let i = 0; i < la; i++) if (a[i] !== b[i]) { diff += 1; if (diff > 1) return false; }
    return diff === 1;
  }
  const [corto, largo] = la < lb ? [a, b] : [b, a];
  let i = 0;
  let j = 0;
  let saltos = 0;
  while (i < corto.length && j < largo.length) {
    if (corto[i] === largo[j]) { i += 1; j += 1; continue; }
    saltos += 1;
    if (saltos > 1) return false;
    j += 1;
  }
  return true;
}

/** true si TODOS los tokens de `sub` tienen un token similar en `sup`. */
function esSubconjuntoFuzzy(sub: string[], sup: string[]): boolean {
  return sub.every((t) => sup.some((s) => tokenSimilar(t, s)));
}

export interface ProductorFusionInput {
  id: string;
  nombre: string;
  /** Nº de filas vinculadas (entradas de báscula + pasadas de calibrador). */
  referencias: number;
}

export interface GrupoDuplicados {
  base: string;
  /** El productor que se conserva: el de más referencias (empate → nombre más largo → alfabético). */
  canonico: ProductorFusionInput;
  /** Los que se fusionan en el canónico y se borran. */
  duplicados: ProductorFusionInput[];
}

export interface DuplicadoAmbiguo {
  productor: ProductorFusionInput;
  /** Productores con los que encaja: el admin decide el destino (o ninguno). */
  candidatos: ProductorFusionInput[];
}

export interface DeteccionDuplicados {
  grupos: GrupoDuplicados[];
  ambiguos: DuplicadoAmbiguo[];
}

function ordenCanonico(a: ProductorFusionInput, b: ProductorFusionInput): number {
  return b.referencias - a.referencias || b.nombre.length - a.nombre.length || a.nombre.localeCompare(b.nombre);
}

/**
 * Detecta duplicados del catálogo: grupos seguros (nombre base igual, nombre
 * parcial inequívoco, erratas de una letra) y casos ambiguos que requieren
 * decisión manual. Ver la cabecera del módulo para las reglas.
 */
export function detectarDuplicadosProductores(productores: ProductorFusionInput[]): DeteccionDuplicados {
  const n = productores.length;
  const tokens = productores.map((p) => tokenize(p.nombre));
  const distintivos = productores.map((p) => tokensDistintivos(p.nombre));

  // Union-find sobre índices del catálogo.
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const union = (i: number, j: number) => { parent[find(j)] = find(i); };

  // Pase 1: nombre base idéntico (con tolerancia a erratas token a token).
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (tokens[i].length === 0 || tokens[i].length !== tokens[j].length) continue;
      if (tokens[i].every((t, k) => tokenSimilar(t, tokens[j][k]))) union(i, j);
    }
  }

  // Pase 2: nombre parcial (subconjunto distintivo), con guarda de ambigüedad.
  // Un candidato "i ⊂ j" solo se fusiona si TODOS sus encajes acaban en el
  // MISMO grupo; si reparte entre grupos distintos, queda como ambiguo.
  const candidatosDe = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const dist = distintivos[i];
    // Exigir sustancia: al menos una palabra distintiva de 4+ letras.
    if (dist.length === 0 || !dist.some((t) => t.length >= 4)) continue;
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      // Ya fusionados por el pase 1: nada que proponer.
      if (find(i) === find(j)) continue;
      if (esSubconjuntoFuzzy(dist, tokens[j])) {
        const arr = candidatosDe.get(i) ?? [];
        arr.push(j);
        candidatosDe.set(i, arr);
      }
    }
  }

  const ambiguosIdx = new Set<number>();
  let cambio = true;
  while (cambio) {
    cambio = false;
    for (const [i, cands] of candidatosDe) {
      if (ambiguosIdx.has(i)) continue;
      const objetivos = [...new Set(cands.map((j) => find(j)))].filter((r) => r !== find(i));
      if (objetivos.length === 1) {
        union(objetivos[0], i);
        candidatosDe.delete(i);
        cambio = true;
      }
    }
    // Los que siguen repartidos entre varios grupos tras estabilizar: ambiguos.
    if (!cambio) {
      for (const [i, cands] of candidatosDe) {
        const objetivos = [...new Set(cands.map((j) => find(j)))].filter((r) => r !== find(i));
        if (objetivos.length > 1) ambiguosIdx.add(i);
      }
    }
  }

  // Construir grupos finales (≥2 miembros).
  const porRaiz = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    const arr = porRaiz.get(r) ?? [];
    arr.push(i);
    porRaiz.set(r, arr);
  }

  const grupos: GrupoDuplicados[] = [];
  for (const miembros of porRaiz.values()) {
    if (miembros.length < 2) continue;
    const ordenados = miembros.map((i) => productores[i]).sort(ordenCanonico);
    grupos.push({
      base: nombreBaseProductor(ordenados[0].nombre) || ordenados[0].nombre,
      canonico: ordenados[0],
      duplicados: ordenados.slice(1),
    });
  }
  grupos.sort((a, b) => a.base.localeCompare(b.base));

  const ambiguos: DuplicadoAmbiguo[] = [...ambiguosIdx]
    .map((i) => ({
      productor: productores[i],
      candidatos: [...new Set((candidatosDe.get(i) ?? []).map((j) => find(j)))]
        .map((r) => (porRaiz.get(r) ?? [r]).map((k) => productores[k]).sort(ordenCanonico)[0])
        .filter((p) => p.id !== productores[i].id)
        .sort(ordenCanonico),
    }))
    .sort((a, b) => a.productor.nombre.localeCompare(b.productor.nombre));

  return { grupos, ambiguos };
}

/** Compatibilidad con la primera versión (solo grupos por nombre base y parciales seguros). */
export function agruparProductoresDuplicados(productores: ProductorFusionInput[]): GrupoDuplicados[] {
  return detectarDuplicadosProductores(productores).grupos;
}

// ─── Resolución del plan de fusión ──────────────────────────────────────────

export interface FusionPar {
  /** Ficha que se borra. */
  dup: ProductorFusionInput;
  /** Ficha que se conserva y recibe todos los datos. */
  canon: ProductorFusionInput;
}

/** El par ordenado por datos: conserva SIEMPRE la ficha con más referencias (empate → nombre más largo). */
export function parPorReferencias(a: ProductorFusionInput, b: ProductorFusionInput): FusionPar {
  const [canon, dup] = [a, b].sort(ordenCanonico);
  return { canon, dup };
}

/**
 * Sanea una lista de fusiones antes de aplicarla, en orden:
 *   - un duplicado no puede fusionarse dos veces (gana el primer par);
 *   - los destinos se resuelven EN CADENA: si A→B y B→C, A acaba en C — nunca
 *     se fusiona contra una ficha que también va a borrarse;
 *   - los ciclos (A→B y B→A) se cortan descartando el par que cierra el ciclo.
 *
 * Con esto, mezclar grupos automáticos, ambiguos elegidos a mano y fusiones
 * manuales es seguro sea cual sea el orden en que se añadan.
 */
export function resolverCadenaFusiones(pares: FusionPar[]): FusionPar[] {
  const aceptadas: FusionPar[] = [];
  const canonDe = new Map<string, ProductorFusionInput>();
  for (const par of pares) {
    if (canonDe.has(par.dup.id)) continue; // duplicado repetido: gana el primero
    let canon = par.canon;
    const vistos = new Set([par.dup.id]);
    while (canonDe.has(canon.id)) {
      if (vistos.has(canon.id)) break;
      vistos.add(canon.id);
      canon = canonDe.get(canon.id)!;
    }
    if (canon.id === par.dup.id) continue; // ciclo o auto-fusión
    aceptadas.push({ dup: par.dup, canon });
    canonDe.set(par.dup.id, canon);
    // Pares anteriores que apuntaban a este dup pasan a apuntar a su canónico final.
    for (const a of aceptadas) {
      if (a.canon.id === par.dup.id) a.canon = canon;
    }
    for (const [k, v] of canonDe) {
      if (v.id === par.dup.id) canonDe.set(k, canon);
    }
  }
  return aceptadas;
}
