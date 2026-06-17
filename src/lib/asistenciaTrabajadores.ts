export function darBajaTrabajadorPreservandoHistorial<T extends { id: string; activo: boolean }>(
  trabajadores: readonly T[],
  trabajadorId: string,
) {
  return trabajadores.map((trabajador) =>
    trabajador.id === trabajadorId ? { ...trabajador, activo: false } : trabajador,
  );
}
