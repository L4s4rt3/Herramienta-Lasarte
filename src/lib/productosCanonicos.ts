/**
 * productosCanonicos.ts — identidad canónica de PRODUCTOS de confección, la
 * base del eje "producto" del CMV (Económico → Coste por producto).
 *
 * ─── El problema ─────────────────────────────────────────────────────────────
 * El producto lo teclea el operario del calibrador y llega como texto libre en
 * dos sitios que son la MISMA realidad vista de dos formas:
 *   - lote_clasificacion.producto  (Informe LOTE: por lote y día, toda la
 *     campaña — 257.102 filas, 1.155 textos distintos desde sept-2025)
 *   - producto_dia.producto        (Informe PRODUCTO: por día y línea, con el
 *     EMPAQUE, que el Informe LOTE no trae — solo desde may-2026)
 *
 * De esos 1.155 textos, 178 son erratas de tecleo del mismo producto:
 * "MDNA 5 K D-PACK CAL 5/6 (70/84M)", "MDNA 5 KG D-PACK CAL 5/6 (70/84MM)" y
 * "MDNA 5KG D-PACK CAL 5/6 (70/84M)." son el mismo producto escrito tres
 * veces. Sin colapsarlos, el coste y el margen de ese producto salen partidos
 * en tres filas y ninguna dice la verdad. Con `claveProducto` quedan 977
 * productos reales (medido contra la BD, ago-2026).
 *
 * ─── Qué colapsa y qué NO ────────────────────────────────────────────────────
 * Colapsa SOLO ruido de tecleo: mayúsculas, tildes, espacios, puntuación,
 * "KG"/"K", y las "M" finales de los milímetros ("(70/84M)" == "(70/84MM)").
 * NO toca los dígitos, que es donde vive la identidad del producto: el calibre
 * ("CAL 5/6" vs "CAL 3/4") y el formato ("3 KG" vs "5 KG") siguen siendo
 * productos distintos, como deben. Es la misma filosofía que
 * normalizar_nombre_productor: unir lo idéntico, jamás adivinar parecidos.
 *
 * ─── Este módulo NO decide costes ────────────────────────────────────────────
 * Decisión del dueño (07-ago-2026): cada producto tiene FICHA PROPIA con su
 * coste y su precio (no se heredan de una tabla de empaques). Lo que hace este
 * módulo es DEDUCIR los campos con los que nace esa ficha —zona, marca,
 * calibre, empaque, kg por bulto— para que las 977 fichas no nazcan vacías.
 * Todo lo deducido es una SEMILLA editable, nunca un valor calculado en
 * caliente: si el dueño corrige el kg/bulto de un producto, manda su ficha.
 *
 * Sin red y sin Supabase, para poder testearlo (ver productosCanonicos.test.ts).
 */
import {
  clasificarProductoInforme,
  type ZonaProductoInforme,
} from "@/lib/asistenciaProductoClasificacion";

// ─── Clave canónica ──────────────────────────────────────────────────────────

/**
 * Clave de igualdad de un producto: colapsa el ruido de tecleo dejando
 * intactos los dígitos. ESPEJO de `normalizar_clave_producto` en SQL (ver
 * supabase/migrations/20260807120000_productos_catalogo.sql): si cambia una,
 * hay que cambiar la otra o el catálogo y sus triggers dejarán de coincidir.
 *
 * Orden de los pasos (importa):
 *   1. Mayúsculas y fuera diacríticos.
 *   2. "KG"/"KGS" → "K" ANTES de quitar la puntuación, para que "3 KG" y
 *      "3 K" acaben iguales. El \b va SOLO al final: entre un dígito y una
 *      letra no hay frontera de palabra, así que un `\bKG\b` no casaría con
 *      "5KG" (pegado) y dejaría "5KG" y "5 KG" en claves distintas — que es
 *      justo la errata más común del calibrador.
 *   3. Fuera todo lo que no sea A-Z0-9 (espacios, puntos, guiones, paréntesis,
 *      barras): es puro ruido de tecleo.
 *   4. Fuera las "M" finales: "(70/84M)" y "(70/84MM)" son los mismos
 *      milímetros escritos con una M o con dos.
 *
 * Devuelve "" para vacío/null — el llamador decide qué hacer con eso (el
 * catálogo lo descarta, no crea un producto sin nombre).
 */
export function claveProducto(value: string | null | undefined): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/KGS?\b/g, "K")
    .replace(/[^A-Z0-9]+/g, "")
    .replace(/M+$/, "");
}

/**
 * De un conjunto de variantes del mismo producto, cuál se enseña. Gana la que
 * más kg movió (es la que el operario escribe habitualmente, así que es la que
 * reconocerá en pantalla); a igualdad de kg, la más corta y luego el orden
 * alfabético, para que la elección sea DETERMINISTA — un catálogo que cambia
 * de nombre según el orden en que llegan las filas es un catálogo que no se
 * puede diffear ni re-sembrar sin ruido.
 */
export function nombreDisplayProducto(variantes: Array<{ texto: string; kg: number }>): string | null {
  let mejor: { texto: string; kg: number } | null = null;
  for (const v of variantes) {
    const texto = v.texto.trim().replace(/\s+/g, " ");
    if (!texto) continue;
    if (
      !mejor ||
      v.kg > mejor.kg ||
      (v.kg === mejor.kg && texto.length < mejor.texto.length) ||
      (v.kg === mejor.kg && texto.length === mejor.texto.length && texto < mejor.texto)
    ) {
      mejor = { texto, kg: v.kg };
    }
  }
  return mejor?.texto ?? null;
}

// ─── Marca / cliente ─────────────────────────────────────────────────────────

/**
 * Marcas reconocidas, en orden de prueba. El nombre del producto empieza casi
 * siempre por la marca o el cliente ("MDNA 3KG…", "LA FEA EMP…", "KOLLA LST…"),
 * que es lo que determina a quién se le vende y por tanto a qué precio.
 *
 * La lista sale de los productos reales de la campaña 2025/26 ordenados por kg
 * (cubre el 94 % de los kg confeccionados). Lo que no casa queda `null`: la
 * ficha del producto nace sin marca y el dueño la pone si le sirve de algo —
 * preferible a inventarse una marca "GENERICA" que luego nadie sabe si era
 * deducida o real.
 */
const MARCAS: Array<{ marca: string; re: RegExp }> = [
  { marca: "MERCADONA", re: /\bMDNA\b|\bMERCADONA\b/ },
  { marca: "LA FEA", re: /\bLA\s*FEA\b/ },
  { marca: "HARRIE GOESTEN", re: /\bHARRIE\s*GOESTEN\b|\bH\.?\s*GOESTEN\b|\bHG\b/ },
  { marca: "LA BELLE ANDALOUSE", re: /\bLA\s*BELL[EA]\b|\bBELLE\s*ANDALOUSE\b|\bANDALUCE\b/ },
  { marca: "D. MARTINEZ", re: /\bD\.?\s*MARTINEZ\b/ },
  { marca: "KOLLA", re: /\bKOLLA\b/ },
  { marca: "EDEKA", re: /\bEDEKA\b|\bHERZSTUCKE\b/ },
  { marca: "MASTERFRUIT", re: /\bMASTERFRUIT\b/ },
  { marca: "MORA FRERES", re: /\bMORA\s*FRERES\b/ },
  { marca: "JUARRANZ", re: /\bJUARRANZ\b|\bJZ\b/ },
  { marca: "CATARINA", re: /\bCATARINA\b/ },
  { marca: "AMETLLER", re: /\bAMETLLER\b|\bAMETLLAR\b/ },
  { marca: "GUFRESCO", re: /\bGUFRESCO\b/ },
  { marca: "COFRULY", re: /\bCOFRULY\b/ },
  { marca: "VAN OOIJEN", re: /\bVAN\s*OOIJEN\b|\bVANOOIJEN\b/ },
  { marca: "HNOS MUÑOZ", re: /\bH(NOS)?\.?\s*MUNOZ\b/ },
  { marca: "PICOLITO", re: /\bPICOLITO\b/ },
  { marca: "ALYCA", re: /\bALYCA\b/ },
  { marca: "PROSOL", re: /\bPROSOL\b/ },
  { marca: "LASARTE", re: /\bLASARTE\b|\bLST\b/ },
];

/** Texto listo para casar marcas: mayúsculas, sin tildes, espacios colapsados. */
function textoBusqueda(value: string | null | undefined): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Marca/cliente del producto, o `null` si no se reconoce ninguna. "LASARTE"
 * va la ÚLTIMA a propósito: "LST" aparece pegado a otras marcas ("KOLLA LST
 * CAL 1/36", "MORA FRERES LST…") indicando el empaque de Lasarte, no que el
 * cliente sea Lasarte — quien manda ahí es la marca de delante.
 */
export function deducirMarcaProducto(producto: string | null | undefined): string | null {
  const t = textoBusqueda(producto);
  if (!t) return null;
  for (const { marca, re } of MARCAS) {
    if (re.test(t)) return marca;
  }
  return null;
}

// ─── Calibre ─────────────────────────────────────────────────────────────────

/**
 * Calibre del producto tal y como lo escribe el calibrador ("5/6", "1/24--1/36",
 * "3/60-3/54"), normalizado a un separador único. `null` si el nombre no trae
 * "CAL".
 *
 * Se queda con el texto TAL CUAL (no lo interpreta a números): los formatos
 * conviven ("CAL 4/5 (73/92M)" mezcla calibre y milímetros) y para el CMV el
 * calibre solo sirve para distinguir productos y para que el dueño los
 * reconozca en la tabla, no para calcular nada.
 */
export function deducirCalibreProducto(producto: string | null | undefined): string | null {
  const t = textoBusqueda(producto);
  const m = /\bCAL[.:]?\s*([0-9][0-9/\-. ]*)/.exec(t);
  if (!m) return null;
  const calibre = m[1]
    .replace(/[.\s]+$/g, "")
    .replace(/\s+/g, "")
    .replace(/-{2,}/g, "-")
    .trim();
  return calibre || null;
}

// ─── Empaque y kg por bulto ──────────────────────────────────────────────────

/**
 * Kg de fruta que lleva un bulto, leídos del NOMBRE del empaque del Informe
 * PRODUCTO: "12 K MDNA 618 LOGIFRUIT" → 12, "10 K PLAST FINO 50X30" → 10,
 * "LA BELLA ANDALOUSE 11 KG" → 11.
 *
 * El número que interesa es el que va pegado a K/KG, no cualquier número del
 * nombre: "10 K JZ 44X30" son 10 kg en una caja de 44×30 cm, y
 * "20 K CARTON NEGRO COLUMNA 60X40X24" son 20 kg — nunca 44 ni 60. Por eso el
 * patrón exige la K y por eso se descartan las medidas de la caja (dos o tres
 * números pegados por X).
 *
 * Devuelve `null` si el empaque no declara kg (box de industria, "NADA",
 * "IFCOBLL 6416"): esos productos nacen sin kg/bulto y el material no se puede
 * imputar hasta que el dueño lo rellene en la ficha — que es justo lo que la
 * página marca como "incompleto" en vez de imputar 0.
 */
export function kgPorBultoDesdeEmpaque(empaque: string | null | undefined): number | null {
  const t = textoBusqueda(empaque);
  if (!t) return null;
  // Fuera las medidas de caja (50X30, 60X40X24, 9X2): no son kg de fruta. El
  // "9X2" de los girsacs SÍ es información de producto, pero son 9 mallas de
  // 2 kg = 18 kg, no "9 kg" ni "2 kg": lo resuelve piezasPorBulto, no esto.
  const sinMedidas = t.replace(/\b\d+\s*X\s*\d+(\s*X\s*\d+)?\b/g, " ");
  const m = /(\d+(?:[.,]\d+)?)\s*KG?\b/.exec(sinMedidas);
  if (!m) return null;
  const kg = Number(m[1].replace(",", "."));
  // Guard de cordura: un bulto de fruta está entre 1 y 500 kg (el box grande
  // de industria ronda los 350). Fuera de ahí es que el patrón pilló otra cosa.
  if (!Number.isFinite(kg) || kg <= 0 || kg > 500) return null;
  return kg;
}

/**
 * Girsacs: cuántas mallas lleva el bulto y de cuántos kg cada una, leído del
 * nombre del PRODUCTO ("HARRIE GOESTEN GIRSAC 9X2 K C.3/4" → 9 mallas de 2 kg;
 * "LASARTE GIRSAC 10 X 2 KG CRT" → 10 de 2 kg). `null` si el producto no
 * declara ese patrón.
 *
 * Hace falta para el coste de MATERIAL: en un girsac el material que se
 * consume es por MALLA (9 mallas por bulto), no por bulto — cobrar una sola
 * malla por bulto dejaría el material 9 veces corto.
 */
export function piezasPorBultoDesdeProducto(
  producto: string | null | undefined,
): { piezas: number; kgPorPieza: number } | null {
  const t = textoBusqueda(producto);
  const m = /\b(\d{1,2})\s*X\s*(\d{1,2}(?:[.,]\d+)?)\s*KG?\b/.exec(t);
  if (!m) return null;
  const piezas = Number(m[1]);
  const kgPorPieza = Number(m[2].replace(",", "."));
  if (!Number.isFinite(piezas) || !Number.isFinite(kgPorPieza)) return null;
  if (piezas <= 0 || piezas > 50 || kgPorPieza <= 0 || kgPorPieza > 30) return null;
  return { piezas, kgPorPieza };
}

// ─── Método de venta (solo Mercadona: es lo único deducible) ────────────────

/**
 * Método de venta de Mercadona al que corresponde el producto, leído de su
 * propio nombre. `null` para todo lo demás.
 *
 * Solo Mercadona porque solo ahí el nombre del producto DICE el método: los
 * cuatro códigos (MA3KGC/MA4KGC/MA5KGC/MA12KGC) son 1:1 con los cuatro
 * formatos que Mercadona compra, y el producto los nombra ("MDNA 5KG D-PACK…",
 * "MDNA GRANEL CAL 3/4"). Para el resto de clientes el nombre del producto no
 * contiene el código del ERP (nada en "KOLLA LST CAL 1/36" dice LN680), así
 * que adivinarlo sería inventar: esos productos llevan el método en su ficha,
 * puesto a mano.
 *
 * Importa porque el método trae el precio REAL facturado: con esta deducción,
 * la mitad de los kg de una semana típica (50,8 % en la del 27-jul al 2-ago de
 * 2026) tiene precio de verdad sin que nadie haya tocado una ficha.
 *
 * El granel se comprueba ANTES que los formatos: "MDNA GRANEL CAL 3/4" lleva
 * un "3/4" que el patrón de formato confundiría con una malla de 3 kg.
 */
// (03-09-2026) La implementación vive en _shared/mdnaMix.ts, junto al mix de
// clasificación que la usa en la página de campaña, los scripts y las edge
// functions. Aquí se re-exporta para que los consumidores no cambien.
import { deducirMetodoVentaMdna } from "./mdnaMix";
export { deducirMetodoVentaMdna };

// ─── Ficha deducida ──────────────────────────────────────────────────────────

/**
 * Semilla de la ficha de un producto: todo lo que se puede deducir del texto
 * del calibrador. Lo que no se deduce va `null` — nunca 0 ni "" — para que la
 * página distinga "no lo sabemos" de "vale cero" (regla del repo).
 */
export interface ProductoDeducido {
  /** Clave canónica (claveProducto): la identidad, lo que agrupa las erratas. */
  clave: string;
  /** Nombre que se enseña: la variante con más kg (ver nombreDisplayProducto). */
  nombre: string;
  /** Zona de confección — reutiliza el criterio ya validado de RRHH. */
  zona: ZonaProductoInforme;
  /** true si la zona es "Excluir" (podrido, muestras, precalibrado, totales). */
  excluido: boolean;
  marca: string | null;
  calibre: string | null;
  /** Nombre del empaque del Informe PRODUCTO. `null` si ese informe no lo cubre. */
  empaque: string | null;
  /** Kg de fruta por bulto. `null` si el empaque no lo declara o no hay empaque. */
  kgPorBulto: number | null;
  /** Mallas por bulto y kg de cada una, en girsacs. `null` en el resto. */
  piezasPorBulto: { piezas: number; kgPorPieza: number } | null;
  /** Método de venta de Mercadona deducido del nombre. `null` en el resto. */
  metodoVenta: string | null;
}

/**
 * Deduce la ficha de un producto a partir de su nombre y (si se conoce) su
 * empaque. Función pura y determinista: mismos textos, misma ficha.
 */
export function deducirProducto(
  nombre: string,
  empaque: string | null | undefined,
): ProductoDeducido {
  const { zona } = clasificarProductoInforme({ producto: nombre, empaque: empaque ?? undefined });
  const empaqueLimpio = (empaque ?? "").trim().replace(/\s+/g, " ") || null;
  return {
    clave: claveProducto(nombre),
    nombre: nombre.trim().replace(/\s+/g, " "),
    zona,
    excluido: zona === "Excluir",
    marca: deducirMarcaProducto(nombre),
    calibre: deducirCalibreProducto(nombre),
    empaque: empaqueLimpio,
    kgPorBulto: kgPorBultoDesdeEmpaque(empaqueLimpio),
    piezasPorBulto: piezasPorBultoDesdeProducto(nombre),
    metodoVenta: deducirMetodoVentaMdna(nombre),
  };
}

// ─── Índice de confección por zona (semilla del reparto de tratamiento) ──────
//
// El coste de tratamiento del día (personal + suministros + consumibles) se
// reparte entre los productos POR KG PONDERADO (decisión del dueño,
// 07-ago-2026): cada kg pesa lo que diga el índice de su producto, no todos
// igual. Confeccionar una malla de 3 kg lleva manos que tirar un box de
// industria no lleva, y un reparto plano se lo cobraría a la industria.
//
// Estos valores son la SEMILLA con la que nace la ficha de cada producto
// según su zona; el índice vive en la ficha y el dueño lo edita producto a
// producto. Son relativos entre sí (no €/kg): lo único que importa es la
// proporción. Graneleras = 1,0 es el ancla.

export const INDICE_CONFECCION_SEMILLA: Record<ZonaProductoInforme, number | null> = {
  // Malla y girsac: la línea que más mano de obra concentra.
  Mallas: 2.5,
  // Mesas de envasado: manual, pero sin el ritmo de la malladora.
  Mesas: 2.0,
  // Granel a caja: el ancla del índice.
  Graneleras: 1.0,
  // Industria: la fruta cae al box, casi no se toca.
  Industria: 0.3,
  // Excluido (podrido, muestras, precalibrado): no consume confección. `null`,
  // no 0 — el precalibrado SÍ volverá a línea y consumirá tratamiento el día
  // que se confeccione, bajo el producto que salga entonces.
  Excluir: null,
};
