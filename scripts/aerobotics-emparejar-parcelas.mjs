/**
 * Empareja las parcelas de Aerobotics con las de la báscula.
 *
 * QUÉ ENTRA. Los ZIP que Aerobotics deja descargar por finca
 * (farm_<id>_polygons.zip), ya descomprimidos: cada uno trae un shapefile
 * (polygons.shp + .dbf + .prj) con una fila por parcela y estos campos:
 * Name, Hectares, CropType, Cultivar, PlantDate, Rootstock, más el contorno
 * en coordenadas WGS84 (latitud/longitud).
 *
 * QUÉ SALE. Un CSV con cada parcela de Aerobotics y las TRES parcelas de la
 * báscula que más se le parecen, con su puntuación. NO decide nada: propone,
 * para que una persona confirme. El nombre que usa Aerobotics ("TORRECILLA
 * POWELL") y el que usa la báscula ("La Torrecilla Navel Powell") son el mismo
 * trozo de campo escrito de dos maneras, y eso no lo arregla ningún algoritmo
 * solo: hay casos en los que el nombre de Aerobotics es el del AGRICULTOR
 * ("Citricos Tarsis" = finca El Madroñal) y casos en los que una "farm" de
 * Aerobotics reúne fincas distintas de las nuestras.
 *
 * CÓMO PUNTÚA. Compara palabras, sin tildes ni mayúsculas, quitando la
 * variedad de los dos lados (la báscula la mete dentro del nombre de la
 * parcela y Aerobotics la trae en su propio campo). Suma un punto extra
 * cuando la variedad de Aerobotics y el artículo de la báscula son la misma.
 *
 * USO:
 *   node scripts/aerobotics-emparejar-parcelas.mjs <carpeta-con-los-farm_*> [salida.csv]
 *
 * No escribe NADA en la base: solo lee entradas_bascula.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

try { process.loadEnvFile(path.resolve(".env")); } catch { /* entorno */ }

// ─── Lectura del shapefile (sin dependencias) ────────────────────────────────

/** dBase III: cabecera, descriptores de campo de 32 bytes y registros de ancho fijo. */
export function leerDbf(buf) {
  const nRegistros = buf.readUInt32LE(4);
  const largoCabecera = buf.readUInt16LE(8);
  const largoRegistro = buf.readUInt16LE(10);
  const campos = [];
  let off = 32;
  while (buf[off] !== 0x0d && off < largoCabecera) {
    campos.push({
      nombre: buf.toString("latin1", off, off + 11).replace(/\0.*$/, "").trim(),
      largo: buf[off + 16],
    });
    off += 32;
  }
  const filas = [];
  for (let i = 0; i < nRegistros; i++) {
    let p = largoCabecera + i * largoRegistro;
    const borrado = buf[p] === 0x2a;
    p += 1;
    const fila = {};
    for (const c of campos) {
      fila[c.nombre] = buf.toString("latin1", p, p + c.largo).trim();
      p += c.largo;
    }
    if (!borrado) filas.push(fila);
  }
  return filas;
}

/** ESRI Shapefile, solo el tipo 5 (polígono). Devuelve los anillos como [lon, lat]. */
export function leerShp(buf) {
  const formas = [];
  let off = 100;
  while (off + 8 <= buf.length) {
    const largoContenido = buf.readInt32BE(off + 4) * 2;
    const inicio = off + 8;
    const tipo = buf.readInt32LE(inicio);
    if (tipo === 5) {
      const nPartes = buf.readInt32LE(inicio + 36);
      const nPuntos = buf.readInt32LE(inicio + 40);
      const partes = [];
      for (let i = 0; i < nPartes; i++) partes.push(buf.readInt32LE(inicio + 44 + i * 4));
      const base = inicio + 44 + nPartes * 4;
      const puntos = [];
      for (let i = 0; i < nPuntos; i++) {
        puntos.push([buf.readDoubleLE(base + i * 16), buf.readDoubleLE(base + i * 16 + 8)]);
      }
      formas.push(partes.map((ini, i) => puntos.slice(ini, i + 1 < partes.length ? partes[i + 1] : nPuntos)));
    } else {
      formas.push([]);
    }
    off = inicio + largoContenido;
  }
  return formas;
}

/**
 * Hectáreas del anillo, por el área esférica sobre WGS84. Sirve de comprobación
 * contra las que declara Aerobotics: si no cuadran, el contorno está mal leído.
 */
export function hectareasDeAnillo(anillo) {
  const R = 6378137;
  let suma = 0;
  for (let i = 0; i < anillo.length; i++) {
    const [x1, y1] = anillo[i];
    const [x2, y2] = anillo[(i + 1) % anillo.length];
    suma += (((x2 - x1) * Math.PI) / 180) * (2 + Math.sin((y1 * Math.PI) / 180) + Math.sin((y2 * Math.PI) / 180));
  }
  return Math.abs((suma * R * R) / 2) / 10000;
}

/** Todas las parcelas de una carpeta con los farm_<id>_polygons descomprimidos. */
export function leerParcelasAerobotics(raiz) {
  const parcelas = [];
  for (const carpeta of readdirSync(raiz, { withFileTypes: true })) {
    if (!carpeta.isDirectory()) continue;
    const dir = path.join(raiz, carpeta.name);
    const ficheros = readdirSync(dir);
    if (!ficheros.includes("polygons.dbf") || !ficheros.includes("polygons.shp")) continue;
    const farmId = /farm_(\d+)/.exec(carpeta.name)?.[1] ?? carpeta.name;
    const filas = leerDbf(readFileSync(path.join(dir, "polygons.dbf")));
    const formas = leerShp(readFileSync(path.join(dir, "polygons.shp")));
    filas.forEach((fila, i) => {
      const anillos = formas[i] ?? [];
      const exterior = anillos[0] ?? [];
      parcelas.push({
        farmId,
        nombre: fila.Name ?? "",
        hectareas: Number(String(fila.Hectares ?? "").replace(",", ".")) || null,
        cultivo: fila.CropType ?? "",
        variedad: fila.Cultivar ?? "",
        plantacion: fila.PlantDate && fila.PlantDate !== "None" ? fila.PlantDate : null,
        patron: fila.Rootstock && fila.Rootstock !== "None" ? fila.Rootstock : null,
        anillos,
        hectareasCalculadas: exterior.length > 2 ? Number(hectareasDeAnillo(exterior).toFixed(3)) : null,
        centro: exterior.length > 2
          ? [
            Number((exterior.reduce((s, p) => s + p[0], 0) / exterior.length).toFixed(6)),
            Number((exterior.reduce((s, p) => s + p[1], 0) / exterior.length).toFixed(6)),
          ]
          : null,
      });
    });
  }
  return parcelas;
}

// ─── Emparejado por nombre ───────────────────────────────────────────────────

const PALABRAS_VACIAS = new Set(["de", "del", "la", "el", "los", "las", "gg", "ha", "has", "sl", "sa", "s", "l", "cb", "scp", "sat", "y", "e"]);

/** Palabras de variedad: se quitan de los dos lados porque cada fuente las pone en un sitio distinto. */
const PALABRAS_VARIEDAD = new Set([
  "naranja", "nar", "navelina", "navelinas", "navel", "navelate", "lane", "late", "powell", "powel",
  "valencia", "val", "delta", "seedless", "midknight", "midnight", "salustiana", "salustianas",
  "barberina", "fukumoto", "chislett", "barnfield", "m7", "foyos", "caracara", "sanguinelli",
  "kirkwood", "tarocco", "rosso", "orange", "industria", "campocit", "cit",
]);
// "clemengold" NO va en la lista de arriba aunque sea una mandarina: aquí es el
// nombre de la finca (Finca Clemengold S.L.), y quitarlo dejaba la parcela sin
// una sola palabra con la que compararse.

export function normalizar(texto) {
  return String(texto ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9ñ ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function palabras(texto, { quitarVariedad = true } = {}) {
  return normalizar(texto)
    .split(" ")
    // Fuera las LETRAS sueltas: la "n" de "Parcela Nº3" no dice nada y
    // estropeaba el parecido con la "PARCELA 3" de Aerobotics. Las CIFRAS
    // sueltas se quedan: en "LAS 4 Ha" el 4 es todo el nombre.
    .filter((p) => (p.length > 1 || /^\d$/.test(p)) && !PALABRAS_VACIAS.has(p) && (!quitarVariedad || !PALABRAS_VARIEDAD.has(p)));
}

/**
 * Dice: 2·comunes / (total A + total B). 1 = las mismas palabras, 0 = ninguna.
 *
 * Con una condición: tiene que coincidir al menos UNA palabra de verdad (4
 * letras o más). Sin ella, "COVIDESA 2" y "Ganchal 2 Industria" puntuaban 0,4
 * por compartir el número 2, que no dice nada de qué trozo de campo es.
 *
 * La excepción son las parcelas que se llaman con un número y ya está: "Las 16"
 * (Aerobotics) y "Las 16 Ha Navelinas" (báscula) son la misma, y ahí el número
 * SÍ es el nombre. Vale cuando uno de los dos lados no tiene más palabra que esa.
 */
/** Distancia de edición (cuántas letras hay que cambiar para pasar de una a otra). */
export function distancia(a, b) {
  if (a === b) return 0;
  const fila = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let anterior = fila[0];
    fila[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const guardado = fila[j];
      fila[j] = Math.min(fila[j] + 1, fila[j - 1] + 1, anterior + (a[i - 1] === b[j - 1] ? 0 : 1));
      anterior = guardado;
    }
  }
  return fila[b.length];
}

/**
 * ¿Son la misma palabra escrita de dos maneras? Una letra de diferencia en
 * palabras de 5 letras o más. Los casos reales: "Borego" por Borrego,
 * "BARRAGAN" por Barrangan, "CERREZUELA" por Serrezuela. Las cifras y las
 * palabras cortas exigen coincidencia exacta: entre "LAS 4" y "LAS 5" hay una
 * letra de diferencia y son dos parcelas distintas.
 */
export function mismaPalabra(a, b) {
  if (a === b) return true;
  if (a.length < 5 || b.length < 5) return false;
  if (/\d/.test(a) || /\d/.test(b)) return false;
  return distancia(a, b) <= 1;
}

export function parecido(a, b) {
  if (a.length === 0 || b.length === 0) return 0;
  const sa = [...new Set(a)];
  const sb = [...new Set(b)];
  let comunes = 0;
  let algunaDeVerdad = false;
  const usadas = new Set();
  for (const p of sa) {
    const pareja = sb.find((q) => !usadas.has(q) && mismaPalabra(p, q));
    if (!pareja) continue;
    usadas.add(pareja);
    comunes += 1;
    const esNumero = /^\d+$/.test(p);
    if ((p.length >= 4 && !esNumero) || (esNumero && (sa.length === 1 || sb.length === 1))) algunaDeVerdad = true;
  }
  if (!algunaDeVerdad) return 0;
  return (2 * comunes) / (sa.length + sb.length);
}

/** La variedad de Aerobotics y el artículo de la báscula, ¿son lo mismo? */
export function mismaVariedad(cultivarAero, articuloBascula) {
  const a = new Set(normalizar(cultivarAero).split(" ").filter(Boolean));
  const b = new Set(normalizar(articuloBascula).split(" ").filter(Boolean));
  for (const p of a) if (p.length > 2 && b.has(p)) return true;
  // Equivalencias que no comparten palabra.
  const equivale = [["delta", "seedless"], ["midknight", "midnight"], ["powell", "powel"], ["m7", "clemengold"]];
  for (const [x, y] of equivale) if ((a.has(x) && b.has(y)) || (a.has(y) && b.has(x))) return true;
  return false;
}

// ─── Los informes de calibre (yield_measurement_report.xlsx) ────────────────
//
// Sirven para DOS cosas. La primera es el calibre en sí: milímetros de la fruta
// por bloque y semana, medidos y previstos. La segunda, aquí, es que traen algo
// que a los planos les falta: el NOMBRE de la finca. Los shapefiles solo llevan
// el número (farm_26248), y con el nombre —"Torrecilla"— emparejar con la
// báscula deja de ser adivinar.

/** Una fila por bloque, con todas sus medidas de calibre en milímetros. */
export function leerInformesCalibre(ficheros, xlsx) {
  const porBloque = new Map();
  for (const fichero of ficheros) {
    const wb = xlsx.readFile(fichero);
    const filas = xlsx.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: null });
    const semanas = (filas[0] ?? []).slice(4).map((c) => String(c ?? "").trim());
    for (const f of filas.slice(1)) {
      if (!f?.[3]) continue;
      const fila = {
        cultivo: String(f[0] ?? "").trim(),
        variedad: String(f[1] ?? "").trim(),
        finca: String(f[2] ?? "").trim(),
        bloque: String(f[3] ?? "").trim(),
        // OJO CON EL CERO (16-09-2026): el Excel de Aerobotics no deja la celda
        // vacía cuando esa semana no se midió — escribe 0. Un diámetro de 0 mm
        // no existe, así que un 0 es "no hay medida" y NO entra: si entra, la
        // última medida de la finca pasa a ser 0 mm y se lleva por delante la
        // previsión y el informe (187 de 232 filas de la primera carga eran 0).
        medidas: semanas
          .map((semana, i) => ({ semana, mm: f[4 + i] == null ? null : Number(f[4 + i]) }))
          .filter((m) => m.semana && m.mm != null && Number.isFinite(m.mm) && m.mm > 0),
      };
      const k = `${normalizar(fila.finca)}|${normalizar(fila.bloque)}`;
      const previo = porBloque.get(k);
      if (!previo) porBloque.set(k, fila);
      else for (const m of fila.medidas) if (!previo.medidas.some((x) => x.semana === m.semana)) previo.medidas.push(m);
    }
  }
  return [...porBloque.values()];
}

/**
 * Número de finca de Aerobotics → su nombre, deducido de los informes: si un
 * bloque del informe se llama igual que una parcela dibujada, la finca de ese
 * bloque es la de esa parcela. Con 0,8 de parecido se pide casi el mismo
 * nombre: aquí equivocarse sale caro, porque el nombre de finca luego pesa en
 * todos los emparejamientos de esa finca.
 */
export function nombresDeFincaAerobotics(parcelas, bloques) {
  const nombres = new Map();
  for (const b of bloques) {
    const pb = palabras(b.bloque);
    const mejor = parcelas
      .map((p) => ({ p, puntos: parecido(pb, palabras(p.nombre)) }))
      .sort((x, y) => y.puntos - x.puntos)[0];
    if (mejor && mejor.puntos >= 0.8 && !nombres.has(mejor.p.farmId)) {
      nombres.set(mejor.p.farmId, b.finca);
    }
  }
  return nombres;
}

/**
 * Los tres mejores candidatos de la báscula para una parcela de Aerobotics.
 *
 * La puntuación es 85 % nombre + 15 % variedad, no nombre + un extra: la
 * variedad tiene que DESEMPATAR. Quitando las palabras de variedad, las cinco
 * parcelas de "La Torrecilla" se parecen exactamente igual al "VALENCIA
 * TORRECILLA" de Aerobotics, y sin este peso ganaba la que más kilos tuviera
 * (la Salustiana) en vez de la que es (la Delta Seedless).
 */
export function candidatosPara(parcelaAero, combosBascula, n = 3, fincaAerobotics = null) {
  const pAero = palabras(parcelaAero.nombre);
  // Con el nombre de la finca de Aerobotics (sale de los informes de calibre),
  // se compara también "finca + bloque" contra "finca + parcela": es lo que
  // distingue el "ALMARJA" de Moratalla del "ALMARJA" de cualquier otro.
  const pAeroConFinca = fincaAerobotics
    ? [...new Set([...palabras(fincaAerobotics), ...pAero])]
    : null;
  return combosBascula
    .map((c) => {
      const pParcela = palabras(c.parcela);
      const pFinca = palabras(c.finca);
      const pAgricultor = palabras(c.agricultor);
      const pTodo = [...new Set([...pFinca, ...pParcela])];
      const nombre = Math.max(
        parecido(pAero, pParcela),
        parecido(pAero, pFinca),
        parecido(pAero, pTodo),
        // El nombre de Aerobotics es a veces el del agricultor (Citricos Tarsis).
        parecido(pAero, pAgricultor) * 0.9,
        ...(pAeroConFinca
          ? [
            parecido(pAeroConFinca, pTodo),
            parecido(pAeroConFinca, [...new Set([...pAgricultor, ...pParcela])]) * 0.9,
          ]
          : []),
      );
      const variedad = mismaVariedad(parcelaAero.variedad, c.articulo);
      return {
        ...c,
        variedadCoincide: variedad,
        puntuacionNombre: Number(nombre.toFixed(3)),
        puntuacion: Number((nombre * 0.85 + (variedad ? 0.15 : 0)).toFixed(3)),
      };
    })
    .filter((c) => c.puntuacionNombre > 0)
    .sort((x, y) => y.puntuacion - x.puntuacion || y.kg - x.kg)
    .slice(0, n);
}

/**
 * Tres cajones, no un sí/no: el nombre solo no basta para firmar un
 * emparejamiento, pero tampoco hay que revisar a mano lo que es evidente.
 *
 * Y una regla que costó una cifra absurda: para ser CLARA, la propuesta tiene
 * que ser ÚNICA. "TORRECILLA FUKUMOTO" puntuaba 0,85 contra las CINCO parcelas
 * de La Torrecilla —todas empatadas, porque quitando la variedad se llaman
 * igual— y se quedaba con la Salustiana, que era la que más kilos tenía. De ahí
 * salía un rendimiento de 87.556 kg/ha. Si hay empate arriba, no es clara: la
 * decide una persona.
 *
 * Lo usan este script y el cargador (aerobotics-cargar-parcelas.mjs): un solo
 * criterio, para que la propuesta del CSV y la que se guarda sean la misma.
 */
export function veredictoDe(top) {
  const m = top[0];
  if (!m) return "a mano";
  const empate = top[1] && Math.abs(top[1].puntuacion - m.puntuacion) < 0.001;
  if (m.puntuacion >= 0.85 && !empate) return "clara";
  if (m.puntuacion >= 0.5) return "probable";
  return "a mano";
}

/** Las filas de entradas_bascula agrupadas en combinaciones finca+parcela. */
export function agruparCombos(filas) {
  const porCombo = new Map();
  for (const e of filas ?? []) {
    const finca = String(e.finca ?? "").trim();
    const parcela = String(e.parcela ?? "").trim();
    if (!finca) continue;
    const clave = `${finca}||${parcela}`;
    const c = porCombo.get(clave) ?? { finca, parcela, agricultor: "", articulo: "", entradas: 0, kg: 0 };
    c.agricultor = c.agricultor || String(e.agricultor ?? "").trim();
    c.articulo = c.articulo || String(e.articulo ?? "").trim();
    c.entradas += 1;
    c.kg += Number(e.kg_entrada) || 0;
    porCombo.set(clave, c);
  }
  return [...porCombo.values()];
}

// ─── Programa ────────────────────────────────────────────────────────────────

async function main() {
  const argumentos = process.argv.slice(2);
  const raiz = argumentos.find((a) => !a.endsWith(".xlsx") && !a.endsWith(".csv"));
  const informes = argumentos.filter((a) => a.endsWith(".xlsx"));
  const salida = argumentos.find((a) => a.endsWith(".csv"))
    ?? `outputs/Aerobotics_parcelas_emparejadas_${new Date().toISOString().slice(0, 10)}.csv`;
  if (!raiz) {
    console.error("Uso: node scripts/aerobotics-emparejar-parcelas.mjs <carpeta-con-los-farm_*> [salida.csv] [informes.xlsx...]");
    process.exit(1);
  }

  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Faltan SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY en el entorno.");
    process.exit(1);
  }
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  const aero = leerParcelasAerobotics(raiz);
  console.log(`Aerobotics: ${aero.length} parcelas de ${new Set(aero.map((p) => p.farmId)).size} fincas · ${aero.reduce((s, p) => s + (p.hectareas ?? 0), 0).toFixed(2)} ha`);

  // Comprobación: las hectáreas declaradas contra las del contorno.
  const descuadres = aero.filter((p) => p.hectareas && p.hectareasCalculadas && Math.abs(p.hectareas - p.hectareasCalculadas) / p.hectareas > 0.02);
  console.log(descuadres.length === 0
    ? "Contornos: las hectáreas del dibujo cuadran con las declaradas en todas."
    : `Contornos: ${descuadres.length} parcela(s) con más de un 2 % de diferencia entre lo declarado y el dibujo.`);

  const { data, error } = await supabase
    .from("entradas_bascula")
    .select("finca, parcela, agricultor, articulo, kg_entrada")
    .order("fecha", { ascending: true })
    .limit(10000);
  if (error) throw new Error(error.message);

  const combos = agruparCombos(data);
  console.log(`Báscula: ${combos.length} combinaciones finca+parcela.`);

  // Los informes de calibre, si se han pasado: de ahí salen los nombres de finca.
  let nombresFinca = new Map();
  if (informes.length > 0) {
    const xlsx = (await import("xlsx")).default;
    const bloques = leerInformesCalibre(informes, xlsx);
    nombresFinca = nombresDeFincaAerobotics(aero, bloques);
    console.log(`Informes de calibre: ${bloques.length} bloques · ${nombresFinca.size} de ${new Set(aero.map((p) => p.farmId)).size} fincas se quedan con nombre.`);
  }

  const filas = [];
  for (const p of aero.sort((a, b) => (b.hectareas ?? 0) - (a.hectareas ?? 0))) {
    const top = candidatosPara(p, combos, 3, nombresFinca.get(p.farmId) ?? null);
    filas.push({ aero: p, top, veredicto: veredictoDe(top) });
  }

  const cuenta = (v) => filas.filter((f) => f.veredicto === v).length;
  const haDe = (v) => filas.filter((f) => f.veredicto === v).reduce((s, f) => s + (f.aero.hectareas ?? 0), 0);
  console.log("");
  for (const v of ["clara", "probable", "a mano"]) {
    console.log(`${v.padEnd(9)}: ${String(cuenta(v)).padStart(2)} parcelas · ${haDe(v).toFixed(2).padStart(7)} ha`);
  }
  console.log("\nLas 15 primeras por hectáreas:\n");
  for (const { aero: p, top, veredicto: v } of filas.slice(0, 15)) {
    const m = top[0];
    console.log(`${v.padEnd(9)} ${(p.nombre + " (farm " + p.farmId + ")").padEnd(40)} ${String(p.hectareas).padStart(6)} ha ${p.variedad.padEnd(16)} → ${m ? `${String(m.puntuacion).padEnd(5)} ${m.finca} / ${m.parcela}` : "sin candidato"}`);
  }

  // ─── Lo que esto desbloquea: los kilos por hectárea ────────────────────────
  // La báscula sabe los kilos y Aerobotics las hectáreas; hasta ahora no se
  // podían dividir porque nadie tenía las dos cosas en el mismo sitio. Solo con
  // los emparejamientos CLAROS: sobre una pareja dudosa, el cociente miente.
  // Las hectáreas se AGRUPAN por parcela de la báscula: Aerobotics parte "LAS
  // TERESAS" en dos polígonos (0,64 + 1,50 ha) que para la báscula son una sola
  // parcela. Dividir los kilos entre uno solo de los dos daba 110.000 kg/ha.
  const porParcela = new Map();
  for (const f of filas) {
    if (f.veredicto !== "clara" || !(f.aero.hectareas > 0) || !(f.top[0]?.kg > 0)) continue;
    const clave = `${f.top[0].finca} / ${f.top[0].parcela}`;
    const r = porParcela.get(clave) ?? { parcela: clave, variedad: f.aero.variedad, ha: 0, kg: f.top[0].kg, trozos: 0 };
    r.ha += f.aero.hectareas;
    r.trozos += 1;
    porParcela.set(clave, r);
  }
  // Una naranja en regadío da del orden de 25.000-45.000 kg/ha. Fuera de esta
  // horquilla no se concluye nada: o el emparejamiento está mal, o Aerobotics
  // solo tiene dibujado un trozo de lo que la báscula llama esa parcela.
  const PLAUSIBLE = [10000, 60000];
  const rendimientos = [...porParcela.values()]
    .map((r) => ({ ...r, kgHa: r.kg / r.ha }))
    .sort((a, b) => b.kgHa - a.kgHa);
  const creibles = rendimientos.filter((r) => r.kgHa >= PLAUSIBLE[0] && r.kgHa <= PLAUSIBLE[1]);
  const revisar = rendimientos.filter((r) => r.kgHa < PLAUSIBLE[0] || r.kgHa > PLAUSIBLE[1]);

  if (rendimientos.length > 0) {
    const kgTot = creibles.reduce((s, r) => s + r.kg, 0);
    const haTot = creibles.reduce((s, r) => s + r.ha, 0);
    const linea = (r) => `   ${r.parcela.padEnd(50).slice(0, 50)} ${r.variedad.padEnd(15)} ${String(Math.round(r.kgHa)).padStart(7)} kg/ha  (${Math.round(r.kg).toLocaleString("es-ES")} kg / ${r.ha.toFixed(2)} ha${r.trozos > 1 ? `, ${r.trozos} trozos` : ""})`;
    console.log(`\nKILOS POR HECTÁREA. ${creibles.length} parcelas dan una cifra creíble: ${Math.round(kgTot).toLocaleString("es-ES")} kg en ${haTot.toFixed(2)} ha, media ${Math.round(kgTot / haTot).toLocaleString("es-ES")} kg/ha.\n`);
    console.log("  Las 5 que más dan:");
    creibles.slice(0, 5).forEach((r) => console.log(linea(r)));
    console.log("  Las 5 que menos:");
    creibles.slice(-5).forEach((r) => console.log(linea(r)));
    if (revisar.length > 0) {
      console.log(`\n  ${revisar.length} se salen de lo posible (menos de ${PLAUSIBLE[0].toLocaleString("es-ES")} o más de ${PLAUSIBLE[1].toLocaleString("es-ES")} kg/ha).`);
      console.log("  No son parcelas raras: es que el emparejamiento está mal, o que Aerobotics solo tiene");
      console.log("  dibujado un trozo de lo que la báscula llama esa parcela. Son las primeras que revisar:");
      revisar.slice(0, 8).forEach((r) => console.log(linea(r)));
    }
  }

  const cabecera = [
    "veredicto", "farm_id", "parcela_aerobotics", "hectareas", "variedad", "plantacion", "patron",
    "puntos_contorno", "centro_lon", "centro_lat",
    "puntuacion_1", "misma_variedad_1", "finca_1", "parcela_1", "kg_1",
    "puntuacion_2", "finca_2", "parcela_2",
    "puntuacion_3", "finca_3", "parcela_3",
    "CONFIRMADA_finca", "CONFIRMADA_parcela",
  ];
  const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const csv = [cabecera.join(";")];
  for (const { aero: p, top, veredicto: v } of filas) {
    csv.push([
      v, p.farmId, p.nombre, p.hectareas ?? "", p.variedad, p.plantacion ?? "", p.patron ?? "",
      p.anillos[0]?.length ?? 0, p.centro?.[0] ?? "", p.centro?.[1] ?? "",
      top[0]?.puntuacion ?? "", top[0]?.variedadCoincide ? "sí" : "no", top[0]?.finca ?? "", top[0]?.parcela ?? "", Math.round(top[0]?.kg ?? 0),
      top[1]?.puntuacion ?? "", top[1]?.finca ?? "", top[1]?.parcela ?? "",
      top[2]?.puntuacion ?? "", top[2]?.finca ?? "", top[2]?.parcela ?? "",
      // Dos columnas vacías a la derecha: es donde Luis escribe la buena
      // cuando la propuesta no vale. El importador leerá estas dos.
      "", "",
    ].map(esc).join(";"));
  }
  writeFileSync(salida, "﻿" + csv.join("\r\n"), "utf8");
  console.log(`\nPropuesta escrita en ${salida}`);
}

// pathToFileURL y no una plantilla a mano: en Windows la ruta es C:\... y la
// comparación con `file://${argv[1]}` nunca casa (sobran/faltan barras).
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
