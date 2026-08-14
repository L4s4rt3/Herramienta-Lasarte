/**
 * La lógica pura de la copia de seguridad: qué carpetas viejas borrar y cómo
 * convertir un nombre de objeto del storage en una ruta que no se salga de su
 * carpeta. Aparte del script que la usa para poder probarla sin tocar nada
 * (scripts/probar-copia-seguridad.mjs) — la rotación borra ficheros de verdad
 * y tiene que estar bien ANTES de estrenarse.
 */

/**
 * Qué carpetas de copia sobran, dadas las que hay (nombres YYYY-MM-DD).
 *
 * Se conservan las `diarias` más recientes y, de cada mes, la PRIMERA copia
 * (mensual perpetua): catorce días cubren "me di cuenta tarde", y la mensual
 * cubre "esto llevaba mal desde marzo". Lo demás sobra.
 */
export function carpetasABorrar(nombres, { diarias = 14 } = {}) {
  const validas = [...new Set(nombres)].filter((n) => /^\d{4}-\d{2}-\d{2}$/.test(n)).sort();
  const conservar = new Set(validas.slice(-diarias));
  const primeraDelMes = new Map();
  for (const n of validas) {
    const mes = n.slice(0, 7);
    if (!primeraDelMes.has(mes)) primeraDelMes.set(mes, n);
  }
  for (const n of primeraDelMes.values()) conservar.add(n);
  return validas.filter((n) => !conservar.has(n));
}

/**
 * Ruta local segura para un objeto del storage. Los nombres vienen de la base
 * ("carpeta/archivo.pdf") y aunque los escribió nuestra propia app, un fichero
 * que va a escribirse en disco no se fía de nadie: fuera unidades, ".." y
 * caracteres que Windows no admite.
 */
export function rutaSegura(nombre) {
  const trozos = String(nombre ?? "")
    .replace(/\\/g, "/")
    .split("/")
    .map((t) => t.replace(/[:*?"<>|]/g, "_").trim())
    .filter((t) => t && t !== "." && t !== "..");
  return trozos.join("/");
}

/**
 * Reintenta una llamada que puede fallar por un parpadeo de red. Un trabajo
 * nocturno sin nadie delante no puede morirse por un "fetch failed" suelto:
 * en la primera prueba real (14-08) la restauración cayó por uno a mitad de
 * la tabla grande, con la misma llamada que había funcionado minutos antes.
 */
export async function conReintentos(fn, { veces = 4, esperaMs = 2000 } = {}) {
  for (let intento = 1; ; intento++) {
    try {
      return await fn();
    } catch (e) {
      if (intento >= veces) throw e;
      console.warn(`  (intento ${intento} fallido: ${e.message} — se reintenta en ${(esperaMs * intento) / 1000}s)`);
      await new Promise((r) => setTimeout(r, esperaMs * intento));
    }
  }
}

/** "48,3 MB" — el tamaño con palabras, para el detalle del registro. */
export function comoTamano(bytes) {
  if (!(bytes >= 0)) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1048576).toLocaleString("es-ES", { maximumFractionDigits: 1 })} MB`;
  return `${(bytes / 1073741824).toLocaleString("es-ES", { maximumFractionDigits: 2 })} GB`;
}
