export function darBajaTrabajadorPreservandoHistorial<T extends { id: string; activo: boolean }>(
  trabajadores: readonly T[],
  trabajadorId: string,
) {
  return trabajadores.map((trabajador) =>
    trabajador.id === trabajadorId ? { ...trabajador, activo: false } : trabajador,
  );
}

export const ZONA_ENVASADORAS_FALLBACK = "Envasadoras";
export const ZONA_CARGA_DESCARGA = "Carga y descarga";

const ZONAS_OPERATIVAS_TRABAJADORES = new Map<string, string>([
  ["raquel prisco diaz", "Encargadas"],
  ["lidia luna rodriguez", "Encargadas"],
  ["antonio jesus rodriguez espejo", "Carretillero inicio linea"],
  ["enrique fernandez", "Transpaletas mecanicas"],
  ["sandra naranjo", "Tria podrido"],
  ["daniela areiza", "Tria podrido"],
  ["marta ariza", "Aereo"],
  ["pilar llamas", "Aereo"],
  ["alejandro carmona", "Carretillero final linea"],
  ["juan prieto", "Carretillero final linea"],
  ["angel prisco", "Transpaletas mecanicas"],
  ["monserrat garcia alcazar", "Transpaletas mecanicas"],
  ["cristian prisco", "Transpaletas mecanicas"],
  ["cristian prieto", "Transpaletas mecanicas"],
  ["ana maria rodriguez ramos", "Produccion"],
  ["rocio flores ancio", "Produccion"],
  ["sara hans doblas", "Produccion"],
  ["silvia cerro ojeda", "Produccion"],
  ["antonio lopez galvez", "Responsable mantenimiento"],
  ["alvaro corrales", "Responsables mallas"],
  ["ana cristina jimenez", "Responsables mallas"],
  ["encarni minguez", "Responsables mallas"],
  ["cristobalina pigner garcia", "Responsables mallas"],
  ["marina jimenez", "Malla 1 - Tria"],
  ["araceli rivera", "Malla 1 - Recogedoras"],
  ["miriam plaza", "Malla 1 - Recogedoras"],
  ["maria pilar moreno", "Malla 2 - Tria"],
  ["rocio garcia navarro", "Malla 2 - Recogedoras"],
  ["rocio gonzalez", "Malla 2 - Recogedoras"],
  ["sandra leon", "Malla 3 - Tria"],
  ["lucia ferrero martinez", "Malla 3 - Recogedoras"],
  ["libertad diaz", "Malla 3 - Recogedoras"],
  ["ana belen rodriguez laguna", "Malla 4 - Tria"],
  ["eli conde", "Malla 4 - Recogedoras"],
  ["eva llamas", "Responsables granel/RP"],
  ["irene luna", "Responsables granel/RP"],
  ["virginia fabra", "Triadoras granel/RP"],
  ["laura rivero rodriguez", "Triadoras granel/RP"],
  ["sonia lebron", "Triadoras granel/RP"],
  ["borja garrido", "Mozos envasado"],
  ["josue prisco", "Mozos envasado"],
  ["rafael arjona", "Mozos envasado"],
  ["ruben chaparro", "Mozos envasado"],
]);

export function zonaOperativaTrabajador(nombre: string, zonaActual?: string | null) {
  const zonaAsignada = ZONAS_OPERATIVAS_TRABAJADORES.get(normalizeTrabajadorName(nombre));
  if (zonaAsignada) return zonaAsignada;
  if (normalizeTrabajadorName(zonaActual ?? "") === normalizeTrabajadorName(ZONA_CARGA_DESCARGA)) {
    return ZONA_CARGA_DESCARGA;
  }
  return ZONA_ENVASADORAS_FALLBACK;
}

export function aplicarZonasOperativasTrabajadores<T extends { nombre: string; zona?: string | null }>(
  trabajadores: readonly T[],
) {
  return trabajadores.map((trabajador) => ({
    ...trabajador,
    zona: zonaOperativaTrabajador(trabajador.nombre, trabajador.zona),
  }));
}

export interface TrabajadorPorNombreMatch<TTrabajador> {
  input: string;
  trabajador: TTrabajador;
}

export interface TrabajadorSugerencia<TTrabajador> {
  trabajadorId: string;
  trabajador: TTrabajador;
  nombre: string;
  score: number;
}

export interface TrabajadorNoResuelto<TTrabajador> {
  nombre: string;
  sugerencias: TrabajadorSugerencia<TTrabajador>[];
}

export interface TrabajadoresPorNombreResult<TTrabajador> {
  inputs: string[];
  matches: TrabajadorPorNombreMatch<TTrabajador>[];
  inactive: TrabajadorPorNombreMatch<TTrabajador>[];
  ambiguous: Array<{ input: string; trabajadores: TTrabajador[] }>;
  missing: string[];
  /**
   * Nombres que no casaron ni por nombre exacto/normalizado ni por alias, con
   * hasta 3 sugerencias por similitud (mismo contenido que `missing`, pero
   * enriquecido). Se mantiene `missing` para no romper a los consumidores
   * existentes (aplicarBajaLaboralPorNombre, tests previos).
   */
  noResueltos: TrabajadorNoResuelto<TTrabajador>[];
}

export function parseTrabajadorNamesInput(input: string): string[] {
  const seen = new Set<string>();
  return input
    .split(/[\n,;]+/g)
    .map((name) => name.trim().replace(/\s+/g, " "))
    .filter(Boolean)
    .filter((name) => {
      const normalized = normalizeTrabajadorName(name);
      if (seen.has(normalized)) return false;
      seen.add(normalized);
      return true;
    });
}

const MAX_SUGERENCIAS = 3;
/** Umbral mínimo de similitud (0-1) para proponer una sugerencia; por debajo, es ruido. */
const SUGERENCIA_MIN_SCORE = 0.4;

interface TrabajadorIndex<T> {
  byId: Map<string, T>;
  byName: Map<string, T[]>;
  byTokenKey: Map<string, T[]>;
}

function buildTrabajadorIndex<T extends { id: string; nombre: string }>(
  trabajadores: readonly T[],
): TrabajadorIndex<T> {
  const byId = new Map<string, T>();
  const byName = new Map<string, T[]>();
  const byTokenKey = new Map<string, T[]>();

  for (const trabajador of trabajadores) {
    byId.set(trabajador.id, trabajador);

    const key = normalizeTrabajadorName(trabajador.nombre);
    byName.set(key, [...(byName.get(key) ?? []), trabajador]);

    const tokenKey = tokenSetKey(trabajador.nombre);
    byTokenKey.set(tokenKey, [...(byTokenKey.get(tokenKey) ?? []), trabajador]);
  }

  return { byId, byName, byTokenKey };
}

/**
 * Resuelve UN nombre ya aislado (p.ej. una celda de Excel, sin separadores de
 * lista) contra el indice de trabajadores: nombre normalizado exacto, luego
 * conjunto de tokens (soporta "Apellido, Nombre" / orden invertido / comas
 * dentro del propio nombre), y por ultimo alias aprendido.
 */
function resolveUnNombre<T extends { id: string; nombre: string; activo: boolean }>(
  name: string,
  // El listado completo ya viene indexado en `index`; se mantiene el parametro
  // por legibilidad de las llamadas pero no se usa directamente.
  _trabajadores: readonly T[],
  index: TrabajadorIndex<T>,
  aliasPorNombre?: ReadonlyMap<string, string>,
): T[] {
  const normalized = normalizeTrabajadorName(name);

  let workers = index.byName.get(normalized) ?? [];

  // Orden de tokens invertido / con coma ("GARRIDO, BORJA" vs "Borja Garrido"):
  // compara el conjunto de tokens si la cadena exacta no caso.
  if (workers.length === 0) {
    workers = index.byTokenKey.get(tokenSetKey(name)) ?? [];
  }

  // Capa de alias aprendido: resuelve por alias antes de rendirse.
  if (workers.length === 0 && aliasPorNombre) {
    const aliasId = aliasPorNombre.get(normalized) ?? aliasPorNombre.get(tokenSetKey(name));
    const aliasTrabajador = aliasId ? index.byId.get(aliasId) : undefined;
    if (aliasTrabajador) workers = [aliasTrabajador];
  }

  return workers;
}

function clasificarNombre<T extends { id: string; nombre: string; activo: boolean }>(
  name: string,
  trabajadores: readonly T[],
  index: TrabajadorIndex<T>,
  result: TrabajadoresPorNombreResult<T>,
  aliasPorNombre?: ReadonlyMap<string, string>,
) {
  const workers = resolveUnNombre(name, trabajadores, index, aliasPorNombre);

  if (workers.length === 0) {
    result.missing.push(name);
    result.noResueltos.push({
      nombre: name,
      sugerencias: sugerirTrabajadores(name, trabajadores),
    });
  } else if (workers.length > 1) {
    result.ambiguous.push({ input: name, trabajadores: workers });
  } else if (workers[0].activo) {
    result.matches.push({ input: name, trabajador: workers[0] });
  } else {
    result.inactive.push({ input: name, trabajador: workers[0] });
  }
}

/**
 * Resuelve un textarea/blob pegado con nombres separados por salto de linea,
 * coma o punto y coma (formato de la lista de baja laboral). La coma aqui
 * separa PERSONAS, no apellido/nombre dentro de una persona.
 */
export function resolveTrabajadoresPorNombre<T extends { id: string; nombre: string; activo: boolean }>(
  trabajadores: readonly T[],
  input: string,
  aliasPorNombre?: ReadonlyMap<string, string>,
): TrabajadoresPorNombreResult<T> {
  const inputs = parseTrabajadorNamesInput(input);
  const index = buildTrabajadorIndex(trabajadores);

  const result: TrabajadoresPorNombreResult<T> = {
    inputs,
    matches: [],
    inactive: [],
    ambiguous: [],
    missing: [],
    noResueltos: [],
  };

  inputs.forEach((name) => clasificarNombre(name, trabajadores, index, result, aliasPorNombre));

  return result;
}

/**
 * Resuelve una lista de nombres YA AISLADOS (una celda de Excel = un nombre),
 * sin volver a partir por comas: aqui "Garrido, Borja" es un unico nombre en
 * formato "Apellido, Nombre" y debe casar por conjunto de tokens con
 * "Borja Garrido". Pensada para los importadores de asistencia (diario y
 * semanal), donde cada nombre ya llega separado por fila/columna del Excel.
 */
export function resolveTrabajadoresPorLista<T extends { id: string; nombre: string; activo: boolean }>(
  trabajadores: readonly T[],
  names: readonly string[],
  aliasPorNombre?: ReadonlyMap<string, string>,
): TrabajadoresPorNombreResult<T> {
  const seen = new Set<string>();
  const inputs = names
    .map((name) => name.trim().replace(/\s+/g, " "))
    .filter(Boolean)
    .filter((name) => {
      const key = tokenSetKey(name);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

  const index = buildTrabajadorIndex(trabajadores);

  const result: TrabajadoresPorNombreResult<T> = {
    inputs,
    matches: [],
    inactive: [],
    ambiguous: [],
    missing: [],
    noResueltos: [],
  };

  inputs.forEach((name) => clasificarNombre(name, trabajadores, index, result, aliasPorNombre));

  return result;
}

function sugerirTrabajadores<T extends { id: string; nombre: string; activo: boolean }>(
  nombre: string,
  trabajadores: readonly T[],
): TrabajadorSugerencia<T>[] {
  const normalizedInput = normalizeTrabajadorName(nombre);
  const inputTokens = new Set(tokensOf(nombre));

  const scored = trabajadores.map((trabajador) => {
    const normalizedCandidate = normalizeTrabajadorName(trabajador.nombre);
    const candidateTokens = new Set(tokensOf(trabajador.nombre));

    const distance = levenshteinDistance(normalizedInput, normalizedCandidate);
    const maxLen = Math.max(normalizedInput.length, normalizedCandidate.length, 1);
    const stringScore = 1 - distance / maxLen;

    const overlap = intersectionSize(inputTokens, candidateTokens);
    const unionSize = new Set([...inputTokens, ...candidateTokens]).size || 1;
    const tokenScore = overlap / unionSize;

    const score = Math.max(stringScore, tokenScore);

    return { trabajadorId: trabajador.id, trabajador, nombre: trabajador.nombre, score };
  });

  return scored
    .filter((candidate) => candidate.score >= SUGERENCIA_MIN_SCORE)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_SUGERENCIAS);
}

function intersectionSize(a: Set<string>, b: Set<string>): number {
  let count = 0;
  for (const value of a) {
    if (b.has(value)) count++;
  }
  return count;
}

function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let previousRow = Array.from({ length: b.length + 1 }, (_, i) => i);

  for (let i = 1; i <= a.length; i++) {
    const currentRow = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      currentRow.push(
        Math.min(
          currentRow[j - 1] + 1, // insercion
          previousRow[j] + 1, // eliminacion
          previousRow[j - 1] + cost, // sustitucion
        ),
      );
    }
    previousRow = currentRow;
  }

  return previousRow[b.length];
}

/** Tokens normalizados (sin tildes, sin puntuacion, minusculas) de un nombre. */
function tokensOf(name: string): string[] {
  return normalizeTrabajadorName(name)
    .replace(/[.,;]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Clave estable a partir del conjunto de tokens de un nombre (orden alfabetico,
 * sin duplicados). Permite que "GARRIDO, BORJA" case con "Borja Garrido" y que
 * comas/espacios dobles/orden de apellidos no rompan la busqueda.
 */
function tokenSetKey(name: string): string {
  return Array.from(new Set(tokensOf(name))).sort().join(" ");
}

function normalizeTrabajadorName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[.,;]/g, " ")
    .toLocaleLowerCase("es")
    .trim()
    .replace(/\s+/g, " ");
}
