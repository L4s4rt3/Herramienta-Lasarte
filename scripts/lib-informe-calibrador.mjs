/**
 * Lee el informe "Totales de Calidad Clase Tamaño Por Producto" que manda el
 * Compac Sizer al cerrar un lote.
 *
 * FORMATO. Llega en .docx, que es un ZIP con XML dentro: se lee de forma exacta,
 * sin OCR y sin adivinar. La estructura es regular:
 *
 *   [cabecera]  Commodity, Productor / Codigo, Nombre del Lote, tiempos,
 *               utilizacion, bins, toneladas/hora, cartons, % de rechazo…
 *   Producto: <nombre>
 *     Calidad: <n>
 *     Clase: (A) Extra 1     Grupo de Clasificacion: EXPORTACION
 *       Tamaño | Piezas | % Piezas | Peso (kg) | % Peso | Cartons | % Cartons
 *       (03) 8/120 | 161 | 0.41% | 20.17 | 0.25% | 1.35 | 0.24%
 *       …
 *       <fila de totales del bloque, sin tamaño>
 *     Clase: (B) Extra 2 …
 *   Producto: …
 *
 * AUTOVALIDACION. Cada bloque de clase termina en una fila de totales. El parser
 * la devuelve aparte para poder comprobar que la suma de sus tamaños cuadra: si
 * cuadra, la lectura es correcta; si no, algo ha cambiado en el informe y hay que
 * mirarlo antes de fiarse de los numeros.
 *
 * El lote viene en la cabecera Y en el asunto del correo, en formato de entrada
 * (AAMMDDNN), asi que la vinculacion es exacta — nada de reconstruir codigos.
 */
import { unzipSync, strFromU8 } from "fflate";

/** Etiquetas de la cabecera → clave con la que se devuelven. */
const CABECERA = {
  "Commodity": "commodity",
  "Productor / Código": "productor",
  "Nombre del Lote": "lote",
  "Fecha y Hora de Comienzo": "comienzo",
  "Tiempo Máquina": "tiempoMaquina",
  "Tiempo Lote": "tiempoLote",
  "Utilización": "utilizacionPct",
  "Peso de Fruta Promedio (g)": "pesoFrutaMediaG",
  "Conteo de Fruta Promedio": "conteoFrutaMedio",
  "Bins / Hora": "binsHora",
  "Ejecución de Bins": "binsEjecutados",
  "Toneladas / Hora": "toneladasHora",
  "Cartons": "cartons",
  "Cartons / Hora": "cartonsHora",
  "Porcentaje de Rechazo": "rechazoPct",
  "Variedad totalizadora / Código": "variedadTotalizadora",
};

/** "1,234.56", "52.59 %", "206.51 (206.51)*" → numero. null si no hay. */
export function numero(texto) {
  if (texto == null) return null;
  const m = String(texto).replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
}

const MESES = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/**
 * "11-Aug-26 05:25 AM" → "2026-08-11".
 *
 * El Sizer escribe el mes en ingles abreviado y el año con dos digitos. Se
 * devuelve null si no encaja, en vez de inventar una fecha: una fecha mal puesta
 * ensucia todo lo que cuelgue de ella.
 */
export function fechaDeComienzo(texto) {
  const m = String(texto ?? "").match(/(\d{1,2})-([A-Za-z]{3})-(\d{2,4})/);
  if (!m) return null;
  const mes = MESES[m[2].toLowerCase()];
  if (!mes) return null;
  const dia = Number(m[1]);
  let anio = Number(m[3]);
  if (anio < 100) anio += 2000;
  if (dia < 1 || dia > 31) return null;
  return `${anio}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
}

/** "INVERMARMELO / 71" → { nombre, codigo }. */
export function partirProductor(texto) {
  const s = String(texto ?? "").trim();
  const i = s.lastIndexOf("/");
  if (i < 0) return { nombre: s || null, codigo: null };
  return { nombre: s.slice(0, i).trim() || null, codigo: s.slice(i + 1).trim() || null };
}

/** Las filas de tabla del documento, cada una como array de celdas. */
export function filasDelDocx(bytes) {
  const zip = unzipSync(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
  const doc = zip["word/document.xml"];
  if (!doc) throw new Error("El .docx no tiene word/document.xml: no es un informe valido.");
  const xml = strFromU8(doc);
  return [...xml.matchAll(/<w:tr[ >][\s\S]*?<\/w:tr>/g)].map((m) =>
    [...m[0].matchAll(/<w:tc[ >][\s\S]*?<\/w:tc>/g)].map((c) =>
      [...c[0].matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((t) => t[1]).join("").trim(),
    ),
  );
}

const esFilaProducto = (celdas) => celdas.some((c) => c === "Producto:");
const CABECERA_TAMANOS = /^Tamaño$/;

function leerCabecera(filas, hastaFila) {
  // Se aplanan las celdas en orden: la cabecera son pares etiqueta/valor, y asi
  // da igual si el Sizer las reparte en una tabla o en varias.
  const plano = [];
  for (let i = 0; i < hastaFila; i++) for (const c of filas[i]) if (c !== "") plano.push(c);

  const cab = {};
  for (let i = 0; i < plano.length - 1; i++) {
    const clave = CABECERA[plano[i]];
    if (clave && cab[clave] === undefined) cab[clave] = plano[i + 1];
  }

  const { nombre, codigo } = partirProductor(cab.productor);
  return {
    lote: cab.lote ?? null,
    commodity: cab.commodity ?? null,
    productorNombre: nombre,
    productorCodigo: codigo,
    comienzo: cab.comienzo ?? null,
    tiempoMaquina: cab.tiempoMaquina ?? null,
    tiempoLote: cab.tiempoLote ?? null,
    utilizacionPct: numero(cab.utilizacionPct),
    pesoFrutaMediaG: numero(cab.pesoFrutaMediaG),
    conteoFrutaMedio: numero(cab.conteoFrutaMedio),
    binsHora: numero(cab.binsHora),
    binsEjecutados: numero(cab.binsEjecutados),
    toneladasHora: numero(cab.toneladasHora),
    cartons: numero(cab.cartons),
    cartonsHora: numero(cab.cartonsHora),
    rechazoPct: numero(cab.rechazoPct),
  };
}

/**
 * Las lineas de detalle y los totales declarados de cada bloque.
 * `bloques` sirve para autovalidar: cada uno lleva su total del informe y la
 * suma de sus propias lineas.
 */
function leerDetalle(filas, desdeFila) {
  const lineas = [];
  const bloques = [];
  let producto = null;
  let calidad = null;
  let clase = null;
  let grupo = null;
  let enTabla = false;
  let bloque = null;

  const cerrarBloque = (total) => {
    if (!bloque) return;
    bloque.totalDeclarado = total;
    bloques.push(bloque);
    bloque = null;
  };

  for (let i = desdeFila; i < filas.length; i++) {
    const celdas = filas[i];
    const noVacias = celdas.filter((c) => c !== "");
    if (noVacias.length === 0) continue;

    /**
     * El valor de una etiqueta. El Sizer las pone unas veces en la misma fila y
     * otras en la siguiente ("Grupo de Clasificación:" en una fila y
     * "EXPORTACION" en la de abajo), asi que hay que mirar las dos: leyendo solo
     * la propia fila, clase y grupo salian vacios y todo caia en "sin grupo".
     */
    const etiqueta = (nombre) => {
      const j = celdas.findIndex((c) => c === nombre);
      if (j < 0) return null;
      const mismaFila = celdas.slice(j + 1).find((c) => c !== "");
      if (mismaFila) return mismaFila;
      return filas[i + 1]?.find((c) => c !== "") ?? null;
    };

    if (esFilaProducto(celdas)) {
      cerrarBloque(null);
      producto = etiqueta("Producto:");
      enTabla = false;
      continue;
    }
    const q = etiqueta("Calidad:");
    if (q != null) { calidad = q; enTabla = false; continue; }
    const cl = etiqueta("Clase:");
    if (cl != null) { cerrarBloque(null); clase = cl; enTabla = false; continue; }
    const gr = etiqueta("Grupo de Clasificación:");
    if (gr != null) { grupo = gr; enTabla = false; continue; }

    if (CABECERA_TAMANOS.test(noVacias[0]) && noVacias.includes("Peso (kg)")) {
      enTabla = true;
      bloque = { producto, calidad, clase, grupo, suma: { piezas: 0, kg: 0, cartons: 0 } };
      continue;
    }
    if (!enTabla) continue;

    // Fila de detalle: el primer valor es el tamaño, "(03) 8/120".
    if (/^\(\d+\)/.test(noVacias[0]) && noVacias.length >= 4) {
      const [tamano, piezas, pctPiezas, kg, pctKg, cartons, pctCartons] = noVacias;
      const linea = {
        producto, calidad, clase, grupo, tamano,
        piezas: numero(piezas),
        pctPiezas: numero(pctPiezas),
        kg: numero(kg),
        pctKg: numero(pctKg),
        cartons: numero(cartons),
        pctCartons: numero(pctCartons),
      };
      lineas.push(linea);
      if (bloque) {
        bloque.suma.piezas += linea.piezas ?? 0;
        bloque.suma.kg += linea.kg ?? 0;
        bloque.suma.cartons += linea.cartons ?? 0;
      }
      continue;
    }

    // Fila de totales del bloque: como la de detalle pero sin tamaño.
    if (noVacias.length >= 3 && /^-?[\d.,]+$/.test(noVacias[0])) {
      cerrarBloque({
        piezas: numero(noVacias[0]),
        kg: numero(noVacias[2]),
        cartons: numero(noVacias[4]),
      });
      enTabla = false;
      continue;
    }
    enTabla = false;
  }
  cerrarBloque(null);
  return { lineas, bloques };
}

/** Lee un informe completo. Devuelve cabecera, lineas de detalle y bloques. */
export function parsearInformeCalibrador(bytes) {
  const filas = filasDelDocx(bytes);
  const primerProducto = filas.findIndex(esFilaProducto);
  if (primerProducto < 0) {
    throw new Error('No parece el informe esperado: no hay ninguna fila "Producto:".');
  }
  const cabecera = leerCabecera(filas, primerProducto);
  if (!cabecera.lote) {
    throw new Error('No se encontro "Nombre del Lote" en la cabecera del informe.');
  }
  const { lineas, bloques } = leerDetalle(filas, primerProducto);
  return { cabecera, lineas, bloques, filasTotales: filas.length };
}

/**
 * Comprueba que la suma de cada bloque cuadre con el total que declara el
 * informe. Si algo no cuadra es que el formato ha cambiado: mejor saberlo antes
 * de meter los numeros en la Herramienta.
 *
 * LA TOLERANCIA ES DE MEDIO KILO, no de 20 gramos. El informe imprime cada
 * linea con uno o dos decimales, asi que un bloque con varias lineas acumula
 * error de redondeo por su cuenta: el 13-08-2026 se rechazo un informe entero
 * de 23.732 kg porque un bloque de podrido declaraba 19,23 kg y sus lineas
 * sumaban 19,2 — treinta gramos. Medio kilo deja pasar el redondeo y sigue
 * cazando lo que esta validacion busca de verdad, que es un bloque mal leido:
 * eso desvia kilos o decenas de kilos, nunca gramos.
 */
export function validarBloques(bloques, tolerancia = 0.5) {
  const fallos = [];
  for (const b of bloques) {
    if (!b.totalDeclarado) continue;
    for (const campo of ["piezas", "kg", "cartons"]) {
      const dice = b.totalDeclarado[campo];
      const suma = b.suma[campo];
      if (dice == null) continue;
      if (Math.abs(dice - suma) > Math.max(tolerancia, Math.abs(dice) * 0.001)) {
        fallos.push({ producto: b.producto, clase: b.clase, campo, dice, suma });
      }
    }
  }
  return fallos;
}
