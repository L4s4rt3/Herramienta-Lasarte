export const ASISTENCIA_GROUPS_STORAGE_KEY = "lasarte.asistencia.grupos";
export const SIN_GRUPO_LABEL = "Sin grupo";

export const DEFAULT_ASISTENCIA_GRUPOS = [
  "Encargadas",
  "Produccion",
  "Aereo",
  "Tria podrido",
  "Punta",
  "Volcador",
  "Mecanica",
  "Mantenimiento",
  "Envasadoras",
  "Mallas",
  "Carretilla",
  "Graneleras",
  "Mozos",
  "Carga y descarga",
];

function groupKey(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es");
}

export function normalizeAsistenciaGroup(value: string | null | undefined) {
  return (value ?? "").trim().replace(/\s+/g, " ");
}

export function sanitizeAsistenciaGroups(groups: readonly (string | null | undefined)[]) {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const rawGroup of groups) {
    const group = normalizeAsistenciaGroup(rawGroup);
    if (!group) continue;

    const key = groupKey(group);
    if (key === groupKey(SIN_GRUPO_LABEL) || seen.has(key)) continue;

    seen.add(key);
    result.push(group);
  }

  return result;
}

export function addAsistenciaGroup(groups: readonly string[], name: string) {
  return sanitizeAsistenciaGroups([...groups, name]);
}

export function removeAsistenciaGroup(groups: readonly string[], name: string) {
  const keyToRemove = groupKey(normalizeAsistenciaGroup(name));
  return sanitizeAsistenciaGroups(groups).filter((group) => groupKey(group) !== keyToRemove);
}

export function renameAsistenciaGroup(groups: readonly string[], oldName: string, newName: string) {
  const sanitizedGroups = sanitizeAsistenciaGroups(groups);
  const oldKey = groupKey(normalizeAsistenciaGroup(oldName));
  const nextName = sanitizeAsistenciaGroups([newName])[0];

  if (!nextName || !sanitizedGroups.some((group) => groupKey(group) === oldKey)) {
    return sanitizedGroups;
  }

  const nextKey = groupKey(nextName);
  const duplicateTarget = sanitizedGroups.some((group) => groupKey(group) !== oldKey && groupKey(group) === nextKey);
  if (duplicateTarget) return sanitizedGroups;

  return sanitizedGroups.map((group) => (groupKey(group) === oldKey ? nextName : group));
}
