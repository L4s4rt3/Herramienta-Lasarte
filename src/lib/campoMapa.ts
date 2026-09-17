// El mapa de la parcela, dibujado por la herramienta.
//
// POR QUÉ (17-09-2026). El informe de campo llevaba una captura de pantalla de
// Aeroview con los puntos de muestreo. Eso obliga a entrar en Aeroview, encuadrar
// a mano y recortar — justo el tipo de paso que hay que quitar para que el
// informe salga con un botón. Y la herramienta tiene lo que hace falta: el
// contorno GPS de las 70 parcelas (de los planos de Aerobotics) y las
// coordenadas de cada punto de muestreo.
//
// EL FONDO ES LA ORTOFOTO DEL PNOA DEL IGN (Instituto Geográfico Nacional):
// pública, gratuita y servida con CORS abierto, así que el navegador puede
// traerla y exportar el resultado a PNG. Comprobado el 17-09-2026.
//
// REGLA: EL MAPA NUNCA FALLA. Si el IGN no responde —o no hay red—, el dibujo
// sale igual con el contorno y los puntos sobre fondo liso. Un servicio de
// fuera no puede impedir que se haga un informe.
//
// Esto es SOLO el cálculo (proyección, encuadre, qué teselas hacen falta y
// dónde cae cada cosa en píxeles). El pintado, que necesita canvas, está en
// campoMapaCanvas.ts.

/** Lado de la tesela del PNOA, en píxeles. */
export const TAM_TESELA = 256;

/** Hasta dónde llega la ortofoto con detalle útil para una parcela. */
export const ZOOM_MAX = 19;
export const ZOOM_MIN = 10;

/**
 * Tope de teselas que se le piden al IGN por mapa. Con 48 se cubre de sobra una
 * parcela grande; más que eso sería castigar un servicio público gratuito.
 */
export const MAX_TESELAS = 48;

export interface PuntoGeo {
  lon: number;
  lat: number;
}

/** Un punto de muestreo colocado en el mapa. */
export interface PuntoMapa extends PuntoGeo {
  codigo: string;
  etiqueta: string;
}

/** Píxel dentro de la imagen del mapa (0,0 = esquina superior izquierda). */
export interface Pixel {
  x: number;
  y: number;
}

// ─── Proyección Web Mercator ─────────────────────────────────────────────────

/** Longitud → píxel global (el mismo esquema XYZ de todos los mapas de teselas). */
export function lonAPixel(lon: number, zoom: number): number {
  return ((lon + 180) / 360) * TAM_TESELA * 2 ** zoom;
}

/** Latitud → píxel global. */
export function latAPixel(lat: number, zoom: number): number {
  const rad = (Math.max(-85.05112878, Math.min(85.05112878, lat)) * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * TAM_TESELA * 2 ** zoom;
}

// ─── Encuadre ────────────────────────────────────────────────────────────────

export interface Encuadre {
  zoom: number;
  /** Tamaño de la imagen final, en píxeles. */
  ancho: number;
  alto: number;
  /** Píxel global de la esquina superior izquierda de la imagen. */
  origenX: number;
  origenY: number;
  /** Teselas que hay que pedir, ya acotadas. */
  teselas: Array<{ z: number; x: number; y: number; px: number; py: number }>;
  /** true si el encuadre tuvo que bajar de zoom para no pasarse de teselas. */
  recortado: boolean;
}

export interface OpcionesEncuadre {
  /**
   * Tamaño FIJO de la imagen. Si no se da, la imagen se ajusta a la forma de la
   * parcela (ver `encuadrar`), que es lo que se quiere casi siempre.
   */
  ancho?: number;
  alto?: number;
  /** Tope de la imagen cuando se ajusta a la parcela. */
  anchoMax?: number;
  altoMax?: number;
  /** Aire alrededor de la parcela, en tanto por uno del lado. */
  margen?: number;
  zoomMax?: number;
}

/** Por debajo de esto un mapa no se lee, por estrecha que sea la parcela. */
const ANCHO_MINIMO = 420;
const ALTO_MINIMO = 320;

/**
 * Calcula a qué zoom y con qué encuadre cabe todo lo que hay que enseñar.
 *
 * Se parte del rectángulo que contiene el contorno de la parcela Y los puntos
 * de muestreo: si alguien midió fuera del polígono dibujado (pasa, porque el
 * contorno de Aerobotics a veces es solo un trozo), el punto se ve igual en vez
 * de quedarse fuera del papel.
 */
export function encuadrar(geo: PuntoGeo[], opciones: OpcionesEncuadre = {}): Encuadre | null {
  const puntos = geo.filter((p) => Number.isFinite(p.lon) && Number.isFinite(p.lat));
  if (puntos.length === 0) return null;

  const margen = opciones.margen ?? 0.08;
  const zoomMax = Math.min(opciones.zoomMax ?? ZOOM_MAX, ZOOM_MAX);
  const anchoTope = opciones.ancho ?? opciones.anchoMax ?? 1000;
  const altoTope = opciones.alto ?? opciones.altoMax ?? 1000;

  const lons = puntos.map((p) => p.lon);
  const lats = puntos.map((p) => p.lat);
  const oeste = Math.min(...lons), este = Math.max(...lons);
  const sur = Math.min(...lats), norte = Math.max(...lats);

  const necesario = (z: number) => ({
    ancho: (lonAPixel(este, z) - lonAPixel(oeste, z)) * (1 + 2 * margen),
    alto: (latAPixel(sur, z) - latAPixel(norte, z)) * (1 + 2 * margen),
  });

  let zoom = zoomMax;
  for (; zoom > ZOOM_MIN; zoom--) {
    const n = necesario(zoom);
    // Una parcela de un solo punto (o un contorno vacío) no tiene tamaño: a ese
    // zoom se queda, que es el de más detalle.
    if (n.ancho <= anchoTope && n.alto <= altoTope) break;
  }

  // La imagen se ajusta a la FORMA de la parcela salvo que se pida un tamaño
  // fijo. Con una caja apaisada fija, una finca alta y estrecha obligaba a
  // alejarse tanto que la parcela quedaba perdida en medio del término: se veía
  // el pueblo entero y la fruta no. (Ganchal, 17-09-2026.)
  const n = necesario(zoom);
  const ancho = opciones.ancho ?? Math.min(anchoTope, Math.max(ANCHO_MINIMO, Math.round(n.ancho)));
  const alto = opciones.alto ?? Math.min(altoTope, Math.max(ALTO_MINIMO, Math.round(n.alto)));

  const centroX = (lonAPixel(oeste, zoom) + lonAPixel(este, zoom)) / 2;
  const centroY = (latAPixel(norte, zoom) + latAPixel(sur, zoom)) / 2;
  let origenX = centroX - ancho / 2;
  let origenY = centroY - alto / 2;

  // Teselas que tocan el rectángulo visible.
  const construirTeselas = () => {
    const desdeX = Math.floor(origenX / TAM_TESELA);
    const hastaX = Math.floor((origenX + ancho) / TAM_TESELA);
    const desdeY = Math.floor(origenY / TAM_TESELA);
    const hastaY = Math.floor((origenY + alto) / TAM_TESELA);
    const lista: Encuadre["teselas"] = [];
    const limite = 2 ** zoom;
    for (let x = desdeX; x <= hastaX; x++) {
      for (let y = desdeY; y <= hastaY; y++) {
        if (x < 0 || y < 0 || x >= limite || y >= limite) continue;
        lista.push({ z: zoom, x, y, px: x * TAM_TESELA - origenX, py: y * TAM_TESELA - origenY });
      }
    }
    return lista;
  };

  let teselas = construirTeselas();
  let recortado = false;
  // Si se dispara el número de teselas, se baja un zoom: se ve menos detalle,
  // pero el mapa sale y el IGN no recibe una ráfaga.
  while (teselas.length > MAX_TESELAS && zoom > ZOOM_MIN) {
    zoom -= 1;
    recortado = true;
    const cx = (lonAPixel(oeste, zoom) + lonAPixel(este, zoom)) / 2;
    const cy = (latAPixel(norte, zoom) + latAPixel(sur, zoom)) / 2;
    origenX = cx - ancho / 2;
    origenY = cy - alto / 2;
    teselas = construirTeselas();
  }

  return { zoom, ancho, alto, origenX, origenY, teselas, recortado };
}

/** Dónde cae una coordenada dentro de la imagen. */
export function aPixel(p: PuntoGeo, e: Encuadre): Pixel {
  return { x: lonAPixel(p.lon, e.zoom) - e.origenX, y: latAPixel(p.lat, e.zoom) - e.origenY };
}

/** El contorno de la parcela en píxeles: un array por anillo (el primero es el exterior). */
export function contornoEnPixeles(contorno: Array<Array<[number, number]>>, e: Encuadre): Pixel[][] {
  return contorno
    .filter((anillo) => anillo.length >= 3)
    .map((anillo) => anillo.map(([lon, lat]) => aPixel({ lon, lat }, e)));
}

/** Los vértices del contorno como puntos geográficos, para el encuadre. */
export function verticesDeContorno(contorno: Array<Array<[number, number]>>): PuntoGeo[] {
  return contorno.flat().map(([lon, lat]) => ({ lon, lat }));
}

// ─── La ortofoto del IGN ─────────────────────────────────────────────────────

/**
 * URL de una tesela de la ortofoto PNOA del IGN.
 *
 * Servicio público y gratuito (https://www.ign.es/wmts/pnoa-ma), en el mismo
 * esquema de teselas que el resto de mapas web, y con CORS abierto: por eso el
 * navegador puede componer la imagen y exportarla.
 */
export function urlTeselaPnoa(z: number, x: number, y: number): string {
  const params = new URLSearchParams({
    service: "WMTS", request: "GetTile", version: "1.0.0",
    layer: "OI.OrthoimageCoverage", style: "default",
    tilematrixset: "GoogleMapsCompatible", format: "image/jpeg",
    TileMatrix: String(z), TileRow: String(y), TileCol: String(x),
  });
  return `https://www.ign.es/wmts/pnoa-ma?${params.toString()}`;
}

// ─── Escala ──────────────────────────────────────────────────────────────────

/** Metros por píxel a esa latitud y zoom (para la barra de escala). */
export function metrosPorPixel(lat: number, zoom: number): number {
  return (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom;
}

export interface BarraEscala {
  metros: number;
  pixeles: number;
  etiqueta: string;
}

/**
 * Una barra de escala con un número redondo (25, 50, 100, 250 m…) que ocupe
 * como mucho el ancho pedido. Sin esto, un mapa sin referencias no dice si la
 * parcela tiene una hectárea o veinte.
 */
export function barraDeEscala(lat: number, zoom: number, maxPixeles = 160): BarraEscala {
  const mpp = metrosPorPixel(lat, zoom);
  const opciones = [10, 25, 50, 100, 250, 500, 1000, 2000];
  let elegida = opciones[0];
  for (const m of opciones) {
    if (m / mpp <= maxPixeles) elegida = m;
  }
  return {
    metros: elegida,
    pixeles: Math.round(elegida / mpp),
    etiqueta: elegida >= 1000 ? `${elegida / 1000} km` : `${elegida} m`,
  };
}

// ─── Colocación de las etiquetas ─────────────────────────────────────────────

export interface EtiquetaColocada {
  codigo: string;
  texto: string;
  /** El punto en sí. */
  punto: Pixel;
  /** Esquina superior izquierda del rótulo. */
  caja: Pixel;
  ancho: number;
  alto: number;
}

/**
 * Coloca el rótulo de cada punto sin que se pisen ni se salgan de la imagen.
 *
 * Se prueban cuatro posiciones alrededor del punto (derecha, izquierda, arriba,
 * abajo) y se elige la primera que no choque con otro rótulo ya puesto. Es lo
 * mismo que se hace a mano al montar la captura, pero sin tener que hacerlo.
 */
export function colocarEtiquetas(puntos: PuntoMapa[], e: Encuadre, anchoCaracter = 7.2, altoCaja = 22): EtiquetaColocada[] {
  const puestas: EtiquetaColocada[] = [];
  for (const p of puntos) {
    const punto = aPixel(p, e);
    const ancho = Math.max(48, p.etiqueta.length * anchoCaracter + 16);
    const separacion = 12;
    const candidatas: Pixel[] = [
      { x: punto.x + separacion, y: punto.y - altoCaja / 2 },
      { x: punto.x - separacion - ancho, y: punto.y - altoCaja / 2 },
      { x: punto.x - ancho / 2, y: punto.y - separacion - altoCaja },
      { x: punto.x - ancho / 2, y: punto.y + separacion },
    ];
    const cabe = (c: Pixel) => c.x >= 2 && c.y >= 2 && c.x + ancho <= e.ancho - 2 && c.y + altoCaja <= e.alto - 2;
    const choca = (c: Pixel) => puestas.some((q) =>
      c.x < q.caja.x + q.ancho && c.x + ancho > q.caja.x && c.y < q.caja.y + q.alto && c.y + altoCaja > q.caja.y);

    const caja = candidatas.find((c) => cabe(c) && !choca(c)) ?? candidatas.find(cabe) ?? candidatas[0];
    puestas.push({ codigo: p.codigo, texto: p.etiqueta, punto, caja, ancho, alto: altoCaja });
  }
  return puestas;
}
