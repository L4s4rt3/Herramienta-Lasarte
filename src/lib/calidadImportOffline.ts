// Capa OFFLINE del control de calidad de importación.
//
// La nave tiene zonas sin cobertura: si la evaluadora rellena un control sin
// conexión, nada se pierde. Los datos del control van a un "outbox" en
// localStorage (upserts completos por id), las fotos y la firma a IndexedDB
// (blobs), y todo se sube solo en cuanto vuelve la conexión (evento online o
// al abrir la app). Las lecturas caen a una caché local cuando la red falla.
//
// El id del control se genera SIEMPRE en el cliente (crypto.randomUUID), así
// que crear un control offline funciona igual: el replay hace upsert.

export interface ControlOutboxEntry {
  /** Fila completa lista para upsert en calidad_import_controles. */
  row: Record<string, unknown> & { id: string; user_id: string };
  updatedLocal: string;
}

export interface FotoPendiente {
  /** Clave única local (uuid). */
  key: string;
  controlId: string;
  userId: string;
  fileName: string;
  mime: string;
  orden: number;
  /** "foto" va a calidad_import_fotos; "firma" actualiza firma_path. */
  tipo: "foto" | "firma";
  blob: Blob;
}

const OUTBOX_KEY = "calidad-import:outbox";
const CACHE_LISTA_KEY = "calidad-import:cache-lista";
const cacheControlKey = (id: string) => `calidad-import:cache-control:${id}`;

// ─── Outbox de controles (localStorage) ──────────────────────────────────────

function leerOutbox(): Record<string, ControlOutboxEntry> {
  try {
    return JSON.parse(localStorage.getItem(OUTBOX_KEY) ?? "{}") as Record<string, ControlOutboxEntry>;
  } catch {
    return {};
  }
}

function escribirOutbox(outbox: Record<string, ControlOutboxEntry>) {
  try {
    localStorage.setItem(OUTBOX_KEY, JSON.stringify(outbox));
  } catch {
    // localStorage lleno o bloqueado: el autoguardado online sigue funcionando.
  }
}

export function encolarControl(row: ControlOutboxEntry["row"]) {
  const outbox = leerOutbox();
  outbox[row.id] = { row, updatedLocal: new Date().toISOString() };
  escribirOutbox(outbox);
}

export function controlesPendientes(): ControlOutboxEntry[] {
  return Object.values(leerOutbox());
}

export function controlPendiente(id: string): ControlOutboxEntry | null {
  return leerOutbox()[id] ?? null;
}

export function quitarControlPendiente(id: string) {
  const outbox = leerOutbox();
  if (outbox[id]) {
    delete outbox[id];
    escribirOutbox(outbox);
  }
}

export function hayPendientes(): boolean {
  return Object.keys(leerOutbox()).length > 0;
}

// ─── Caché de lectura (última versión vista con red) ─────────────────────────

export function cachearLista(rows: unknown[]) {
  try {
    localStorage.setItem(CACHE_LISTA_KEY, JSON.stringify(rows));
  } catch {
    // sin espacio: la lista offline simplemente saldrá vacía
  }
}

export function listaCacheada(): unknown[] | null {
  try {
    const raw = localStorage.getItem(CACHE_LISTA_KEY);
    return raw ? (JSON.parse(raw) as unknown[]) : null;
  } catch {
    return null;
  }
}

export function cachearControl(id: string, bundle: unknown) {
  try {
    localStorage.setItem(cacheControlKey(id), JSON.stringify(bundle));
  } catch {
    // ídem
  }
}

export function controlCacheado<T>(id: string): T | null {
  try {
    const raw = localStorage.getItem(cacheControlKey(id));
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function quitarControlCacheado(id: string) {
  try {
    localStorage.removeItem(cacheControlKey(id));
  } catch {
    // nada
  }
}

// ─── Outbox de fotos y firma (IndexedDB, porque son blobs) ───────────────────

const DB_NAME = "calidad-import-offline";
const STORE = "fotos";

function abrirDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE, { keyPath: "key" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB no disponible"));
  });
}

export async function encolarFotoPendiente(foto: FotoPendiente): Promise<void> {
  const db = await abrirDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(foto);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("No se pudo guardar la foto offline"));
  });
  db.close();
}

export async function fotosPendientes(controlId?: string): Promise<FotoPendiente[]> {
  try {
    const db = await abrirDb();
    const todas = await new Promise<FotoPendiente[]>((resolve, reject) => {
      const req = db.transaction(STORE, "readonly").objectStore(STORE).getAll();
      req.onsuccess = () => resolve((req.result ?? []) as FotoPendiente[]);
      req.onerror = () => reject(req.error ?? new Error("No se pudieron leer las fotos offline"));
    });
    db.close();
    return controlId ? todas.filter((f) => f.controlId === controlId) : todas;
  } catch {
    return [];
  }
}

export async function quitarFotoPendiente(key: string): Promise<void> {
  const db = await abrirDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("No se pudo limpiar la foto offline"));
  });
  db.close();
}

// ─── ¿Estamos sin conexión? ──────────────────────────────────────────────────

/** navigator.onLine dice "seguro que NO hay red" cuando es false; cuando es
 * true puede mentir, así que los errores de fetch también cuentan (ver
 * esErrorDeRed). */
export function sinConexion(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

const NOMBRE_TIMEOUT_RED = "TiempoDeRedAgotado";

/**
 * El caso que de verdad bloqueaba en la nave: wifi conectado pero SIN
 * internet. Ahí navigator.onLine miente (true) y fetch no falla: se queda
 * COLGADO para siempre — imágenes que no cargan, "Guardando..." eterno,
 * botones girando. Toda operación de red del módulo pasa por aquí: si no
 * responde a tiempo, se trata como error de red (⇒ outbox/caché local).
 */
export function conTimeout<T>(promesa: PromiseLike<T>, ms: number, etiqueta = "la red"): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      const error = new Error(`Sin respuesta de ${etiqueta} en ${Math.round(ms / 1000)}s`);
      error.name = NOMBRE_TIMEOUT_RED;
      reject(error);
    }, ms);
    promesa.then(
      (valor) => {
        clearTimeout(timer);
        resolve(valor);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export function esErrorDeRed(error: unknown): boolean {
  if (sinConexion()) return true;
  if (error instanceof Error && error.name === NOMBRE_TIMEOUT_RED) return true;
  const mensaje = error instanceof Error ? error.message : String(error);
  return /Failed to fetch|NetworkError|Load failed|ERR_INTERNET|fetch failed/i.test(mensaje);
}

/**
 * ¿La copia local (outbox) es más nueva que la fila que devolvió la base?
 * Antes el outbox SIEMPRE pisaba a la red: una entrada rezagada enseñaba un
 * control viejo ("Control sin referencia") aunque la base ya tuviera el bueno.
 */
export function outboxMasNuevo(entry: ControlOutboxEntry, updatedAtServidor: string | undefined | null): boolean {
  if (!updatedAtServidor) return true;
  return entry.updatedLocal > new Date(updatedAtServidor).toISOString();
}
