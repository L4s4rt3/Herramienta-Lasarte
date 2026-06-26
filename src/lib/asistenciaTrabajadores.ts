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

export interface TrabajadoresPorNombreResult<TTrabajador> {
  inputs: string[];
  matches: TrabajadorPorNombreMatch<TTrabajador>[];
  inactive: TrabajadorPorNombreMatch<TTrabajador>[];
  ambiguous: Array<{ input: string; trabajadores: TTrabajador[] }>;
  missing: string[];
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

export function resolveTrabajadoresPorNombre<T extends { nombre: string; activo: boolean }>(
  trabajadores: readonly T[],
  input: string,
): TrabajadoresPorNombreResult<T> {
  const inputs = parseTrabajadorNamesInput(input);
  const byName = trabajadores.reduce<Map<string, T[]>>((map, trabajador) => {
    const key = normalizeTrabajadorName(trabajador.nombre);
    map.set(key, [...(map.get(key) ?? []), trabajador]);
    return map;
  }, new Map<string, T[]>());

  const result: TrabajadoresPorNombreResult<T> = {
    inputs,
    matches: [],
    inactive: [],
    ambiguous: [],
    missing: [],
  };

  inputs.forEach((name) => {
    const workers = byName.get(normalizeTrabajadorName(name)) ?? [];
    if (workers.length === 0) {
      result.missing.push(name);
    } else if (workers.length > 1) {
      result.ambiguous.push({ input: name, trabajadores: workers });
    } else if (workers[0].activo) {
      result.matches.push({ input: name, trabajador: workers[0] });
    } else {
      result.inactive.push({ input: name, trabajador: workers[0] });
    }
  });

  return result;
}

function normalizeTrabajadorName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es")
    .trim()
    .replace(/\s+/g, " ");
}
