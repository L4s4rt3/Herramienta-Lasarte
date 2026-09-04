/**
 * Tipos de lib-asistencia-reloj.mjs para que el test de la app
 * (src/lib/asistenciaReloj.test.ts) pase el typecheck estricto: tsconfig.app.json
 * no tiene allowJs, así que un .mjs importado desde src necesita esta
 * declaración al lado. Debe ir a la par del .mjs.
 */

export const UMBRAL_HORAS_PRESENTE: number;

export const COLUMNAS_RELOJ: Readonly<{
  num: number;
  nombre: number;
  fecha: number;
  primeraEntrada: number;
  salidas: readonly number[];
  total: number;
}>;

export interface RegistroReloj {
  num: unknown;
  nombre: string;
  fecha: string;
  horas: number | null;
  entrada: string | null;
  salida: string | null;
  fichero: string | null;
}

export interface TrabajadorReloj {
  id: string;
  nombre: string;
  activo: boolean;
}

export type EstadoCasado = "casado" | "aproximado" | "inactivo" | "ambiguo" | "sin-casar";
export type ViaCasado = "nombre" | "tokens" | "alias" | "subconjunto" | "aproximado";

export interface Casado<T extends TrabajadorReloj = TrabajadorReloj> {
  estado: EstadoCasado;
  via: ViaCasado | null;
  trabajador: T | null;
  candidatos: T[];
}

/** Misma forma que AsistenciaUpsertRecord en src/hooks/useAsistencia.ts. */
export interface FilaAsistencia {
  user_id: string;
  date: string;
  trabajador_id: string;
  presente: boolean;
  motivo_ausencia: null;
}

export interface DiaExistente {
  filas: number;
  presentes: number;
}

export interface DiaPlan {
  fecha: string;
  estado: "cargar" | "ya-cargado" | "sin-datos";
  finDeSemana: boolean;
  registros: number;
  presentesReloj: number;
  presentesCasados: number;
  existente?: DiaExistente | null;
  filas: FilaAsistencia[];
}

export interface NombreAgregado<T extends TrabajadorReloj = TrabajadorReloj> {
  nombre: string;
  dias: number;
  diasConHoras: number;
  horas: number;
  casado: Casado<T> | undefined;
}

export interface PlanCarga<T extends TrabajadorReloj = TrabajadorReloj> {
  desde: string;
  hasta: string;
  activos: number;
  dias: DiaPlan[];
  aCargar: DiaPlan[];
  yaCargados: DiaPlan[];
  sinDatos: DiaPlan[];
  nombres: {
    casados: NombreAgregado<T>[];
    aproximados: NombreAgregado<T>[];
    inactivos: NombreAgregado<T>[];
    ambiguos: NombreAgregado<T>[];
    sinCasar: NombreAgregado<T>[];
  };
  activosNuncaEnReloj: T[];
}

export function horasDeCelda(v: unknown): number | null;
export function fechaIsoDeCelda(v: unknown): string | null;
export function esCabeceraReloj(fila: unknown): boolean;
export function registrosDeFilas(filas: unknown[][], opciones?: { fichero?: string | null }): RegistroReloj[] | null;
export function fusionarRegistros(listas: Array<RegistroReloj[] | null | undefined>): RegistroReloj[];

export function normalizarNombre(nombre: unknown): string;
export function tokensDe(nombre: unknown): string[];
export function claveTokens(nombre: unknown): string;
export function casarNombresReloj<T extends TrabajadorReloj>(
  nombresReloj: Iterable<string>,
  trabajadores: readonly T[],
  aliasPorNombre?: ReadonlyMap<string, string>,
  opciones?: { aproximado?: boolean },
): Map<string, Casado<T>>;

export function sumaDias(iso: string, n: number): string;
export function fechasEntre(desde: string, hasta: string): string[];
export function esFinDeSemana(iso: string): boolean;

export function planificarCarga<T extends TrabajadorReloj>(argumentos: {
  registros: readonly RegistroReloj[];
  casados: ReadonlyMap<string, Casado<T>>;
  trabajadores: readonly T[];
  diasExistentes?: ReadonlyMap<string, DiaExistente>;
  desde: string;
  hasta: string;
  forzar?: boolean;
  userId: string;
  umbral?: number;
}): PlanCarga<T>;
