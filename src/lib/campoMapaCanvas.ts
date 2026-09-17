// El dibujo del mapa de la parcela: lo que hace falta un navegador para hacer.
//
// El cálculo (proyección, encuadre, qué teselas y dónde cae cada cosa) está en
// campoMapa.ts y se prueba solo. Aquí se pinta: ortofoto de fondo, contorno de
// la parcela, puntos de muestreo con su rótulo, barra de escala y el crédito
// del IGN — que NO es decorativo: el PNOA es CC-BY y hay que citarlo.
//
// SI EL IGN NO RESPONDE, el mapa sale igual sobre fondo liso y se devuelve
// `conOrtofoto: false` para que la pantalla lo diga. Un servicio de fuera no
// puede dejar sin mapa a un informe.
import {
  aPixel, barraDeEscala, colocarEtiquetas, contornoEnPixeles, encuadrar, urlTeselaPnoa,
  verticesDeContorno, type Encuadre, type PuntoMapa,
} from "@/lib/campoMapa";

export interface OpcionesMapa {
  contorno: Array<Array<[number, number]>>;
  puntos: PuntoMapa[];
  /** Tamaño FIJO. Sin esto —lo normal— la imagen toma la forma de la parcela. */
  ancho?: number;
  alto?: number;
  /** Tope de la imagen cuando se ajusta a la parcela. */
  anchoMax?: number;
  altoMax?: number;
  /** Milisegundos que se espera a cada tesela antes de seguir sin ella. */
  timeoutMs?: number;
}

export interface MapaDibujado {
  blob: Blob;
  ancho: number;
  alto: number;
  zoom: number;
  /** false = el IGN no dio ninguna tesela y el mapa va sobre fondo liso. */
  conOrtofoto: boolean;
  /** Teselas que sí llegaron, de las que se pidieron. */
  teselasCargadas: number;
  teselasPedidas: number;
}

const VERDE = "#22c55e";
const AMARILLO = "#facc15";
const TINTA = "#0f172a";

/** Carga una imagen con CORS para que el canvas siga siendo exportable. */
function cargarImagen(url: string, timeoutMs: number): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    const reloj = window.setTimeout(() => { img.src = ""; resolve(null); }, timeoutMs);
    img.onload = () => { window.clearTimeout(reloj); resolve(img); };
    img.onerror = () => { window.clearTimeout(reloj); resolve(null); };
    img.src = url;
  });
}

/** Caja de texto con fondo: el rótulo de un punto y el crédito. */
function caja(ctx: CanvasRenderingContext2D, texto: string, x: number, y: number, ancho: number, alto: number, opciones: { fondo?: string; color?: string; fuente?: string } = {}) {
  ctx.fillStyle = opciones.fondo ?? "rgba(255,255,255,0.92)";
  ctx.strokeStyle = "rgba(15,23,42,0.25)";
  ctx.lineWidth = 1;
  const r = 4;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + ancho, y, x + ancho, y + alto, r);
  ctx.arcTo(x + ancho, y + alto, x, y + alto, r);
  ctx.arcTo(x, y + alto, x, y, r);
  ctx.arcTo(x, y, x + ancho, y, r);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = opciones.color ?? TINTA;
  ctx.font = opciones.fuente ?? "600 13px system-ui, sans-serif";
  ctx.textBaseline = "middle";
  ctx.fillText(texto, x + 8, y + alto / 2);
}

function dibujarContorno(ctx: CanvasRenderingContext2D, anillos: ReturnType<typeof contornoEnPixeles>) {
  if (anillos.length === 0) return;
  ctx.save();
  ctx.beginPath();
  for (const anillo of anillos) {
    anillo.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.closePath();
  }
  ctx.fillStyle = "rgba(34,197,94,0.12)";
  ctx.fill("evenodd");
  ctx.strokeStyle = VERDE;
  ctx.lineWidth = 3;
  ctx.setLineDash([]);
  ctx.stroke();
  ctx.restore();
}

function dibujarEscala(ctx: CanvasRenderingContext2D, e: Encuadre, latMedia: number) {
  const barra = barraDeEscala(latMedia, e.zoom);
  const x = 16, y = e.alto - 26;
  ctx.save();
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  ctx.fillRect(x - 6, y - 14, barra.pixeles + 60, 26);
  ctx.strokeStyle = TINTA;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x, y); ctx.lineTo(x + barra.pixeles, y);
  ctx.moveTo(x, y - 5); ctx.lineTo(x, y + 5);
  ctx.moveTo(x + barra.pixeles, y - 5); ctx.lineTo(x + barra.pixeles, y + 5);
  ctx.stroke();
  ctx.fillStyle = TINTA;
  ctx.font = "600 12px system-ui, sans-serif";
  ctx.textBaseline = "middle";
  ctx.fillText(barra.etiqueta, x + barra.pixeles + 8, y);
  ctx.restore();
}

/**
 * Dibuja el mapa y lo devuelve como imagen lista para el informe.
 *
 * Devuelve null si no hay ni contorno ni puntos con coordenadas: sin geografía
 * no hay mapa que dibujar, y es mejor decirlo que sacar un rectángulo vacío.
 */
export async function dibujarMapaParcela(opciones: OpcionesMapa): Promise<MapaDibujado | null> {
  const timeoutMs = opciones.timeoutMs ?? 8000;

  const geo = [...verticesDeContorno(opciones.contorno), ...opciones.puntos];
  // El tamaño lo decide el encuadre a partir de la forma de la parcela, salvo
  // que se pida uno fijo: una finca alta y estrecha en una caja apaisada obliga
  // a alejarse tanto que la fruta se pierde en medio del término.
  const e = encuadrar(geo, {
    ancho: opciones.ancho, alto: opciones.alto,
    anchoMax: opciones.anchoMax ?? 1000, altoMax: opciones.altoMax ?? 1000,
  });
  if (!e) return null;
  const { ancho, alto } = e;

  const lienzo = document.createElement("canvas");
  lienzo.width = ancho;
  lienzo.height = alto;
  const ctx = lienzo.getContext("2d");
  if (!ctx) return null;

  // Fondo liso primero: si una tesela no llega, no queda un agujero negro.
  ctx.fillStyle = "#e7e5e4";
  ctx.fillRect(0, 0, ancho, alto);

  const teselas = await Promise.all(e.teselas.map(async (t) => ({ t, img: await cargarImagen(urlTeselaPnoa(t.z, t.x, t.y), timeoutMs) })));
  let cargadas = 0;
  for (const { t, img } of teselas) {
    if (!img) continue;
    ctx.drawImage(img, t.px, t.py);
    cargadas += 1;
  }

  dibujarContorno(ctx, contornoEnPixeles(opciones.contorno, e));

  // Los puntos, encima del contorno y debajo de los rótulos.
  for (const p of opciones.puntos) {
    const px = aPixel(p, e);
    ctx.beginPath();
    ctx.arc(px.x, px.y, 7, 0, Math.PI * 2);
    ctx.fillStyle = AMARILLO;
    ctx.fill();
    ctx.strokeStyle = TINTA;
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  for (const et of colocarEtiquetas(opciones.puntos, e)) {
    // Una línea fina del punto a su rótulo cuando el rótulo se ha tenido que ir lejos.
    ctx.save();
    ctx.strokeStyle = "rgba(15,23,42,0.5)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(et.punto.x, et.punto.y);
    ctx.lineTo(et.caja.x + (et.caja.x < et.punto.x ? et.ancho : 0), et.caja.y + et.alto / 2);
    ctx.stroke();
    ctx.restore();
    caja(ctx, et.texto, et.caja.x, et.caja.y, et.ancho, et.alto);
  }

  const latMedia = geo.reduce((s, p) => s + p.lat, 0) / geo.length;
  dibujarEscala(ctx, e, latMedia);

  // Crédito del IGN: el PNOA es CC-BY, citarlo no es opcional.
  if (cargadas > 0) {
    ctx.save();
    ctx.font = "11px system-ui, sans-serif";
    const texto = "Ortofoto PNOA © Instituto Geográfico Nacional de España";
    const anchoTexto = ctx.measureText(texto).width + 12;
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.fillRect(ancho - anchoTexto - 8, alto - 22, anchoTexto, 18);
    ctx.fillStyle = "#334155";
    ctx.textBaseline = "middle";
    ctx.fillText(texto, ancho - anchoTexto - 2, alto - 13);
    ctx.restore();
  }

  const blob = await new Promise<Blob | null>((resolve) => lienzo.toBlob(resolve, "image/jpeg", 0.92));
  if (!blob) return null;

  return {
    blob, ancho, alto, zoom: e.zoom,
    conOrtofoto: cargadas > 0,
    teselasCargadas: cargadas,
    teselasPedidas: e.teselas.length,
  };
}
