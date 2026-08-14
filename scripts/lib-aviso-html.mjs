/**
 * El correo diario en HTML, pintado desde el MODELO de lib-aviso-diario.mjs.
 *
 * POR QUÉ EXISTE (14-08-2026). El aviso salía solo en texto plano con columnas
 * alineadas a espacios, y los clientes de correo (letra proporcional) lo
 * destrozaban: "no lo leo ni yo de lo malo que es" — palabra del que lo recibe.
 * Un correo que no se lee no avisa de nada.
 *
 * DECISIONES:
 *   - Lo urgente ARRIBA: la caja de REVISAR va antes que nada. En el texto
 *     plano sigue al final (ahí no molesta y el orden histórico no se toca).
 *   - Cero lógica de negocio: todo sale del modelo. Qué es un aviso, qué es
 *     provisional o qué falta lo decide componerAviso — aquí solo se pinta.
 *   - HTML de correo, no de web: tablas, estilos en línea y colores claros,
 *     que es lo único que Gmail/Outlook respetan de verdad. Sin CSS externo.
 *
 * El texto plano se sigue enviando como alternativa para clientes antiguos.
 */

const esc = (s) => String(s ?? "")
  .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;");

const GRIS = "#6b7280";
const TINTA = "#1f2937";
const VERDE = "#047857";
const ROJO = "#b91c1c";
const AMBAR = "#b45309";
const AZUL = "#0369a1";

/** Colorea las flechas de comparación y los semáforos del descuadre, ya escapados. */
function adornar(t) {
  return t
    .replaceAll("▲", `<span style="color:${VERDE}">▲</span>`)
    .replaceAll("▼", `<span style="color:${ROJO}">▼</span>`)
    .replaceAll("(ALTO)", `<strong style="color:${ROJO}">(ALTO)</strong>`)
    .replaceAll("(algo alto)", `<span style="color:${AMBAR}">(algo alto)</span>`);
}

const tituloSeccion = (t) =>
  `<p style="margin:18px 0 6px;font-size:11px;font-weight:700;letter-spacing:1px;color:${GRIS};">${esc(t)}</p>`;

/** Una fila etiqueta/valor. La sangría marca sub-concepto. */
function filaPar(item) {
  const sangria = item.sangria ? "padding-left:16px;" : "";
  return `<tr>
    <td style="padding:3px 8px 3px 0;${sangria}font-size:13px;color:${GRIS};vertical-align:top;">${esc(item.etiqueta)}</td>
    <td style="padding:3px 0;font-size:13px;color:${TINTA};text-align:right;vertical-align:top;">${adornar(esc(item.valor))}</td>
  </tr>`;
}

/** Las líneas libres: explicaciones en gris, listas con su punto, enlaces como botón. */
function parrafoTexto(texto, { appUrl }) {
  if (!texto) return "";
  if (/^https?:\/\/\S+$/.test(texto)) {
    const etiqueta = texto.includes("/partes/") ? "Abrir el parte para completarlo" : texto.replace(appUrl, "la Herramienta");
    return `<p style="margin:10px 0 4px;"><a href="${esc(texto)}" style="display:inline-block;background:${AZUL};color:#ffffff;font-size:13px;font-weight:600;padding:8px 14px;border-radius:8px;text-decoration:none;">${esc(etiqueta)}</a></p>`;
  }
  if (texto.startsWith("- ")) {
    return `<p style="margin:2px 0 2px 10px;font-size:12px;color:${TINTA};">&bull; ${esc(texto.slice(2))}</p>`;
  }
  return `<p style="margin:3px 0;font-size:12px;color:${GRIS};">${adornar(esc(texto))}</p>`;
}

/** La semana como barras de verdad (tabla con celdas de color: aguanta en cualquier cliente). */
function tablaSemana(datos) {
  const filas = datos.serie.map((d) => {
    const esHoy = d.fecha === datos.fecha;
    const ancho = datos.maximo > 0 ? Math.max(2, Math.round((d.kg / datos.maximo) * 100)) : 0;
    const dia = new Date(`${d.fecha}T12:00:00`);
    const nombre = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"][dia.getDay()] + " " + dia.getDate();
    const peso = esHoy ? "font-weight:700;" : "";
    return `<tr>
      <td style="padding:2px 8px 2px 0;font-size:12px;color:${esHoy ? TINTA : GRIS};${peso}white-space:nowrap;">${esHoy ? "&rarr; " : ""}${esc(nombre)}</td>
      <td style="width:45%;padding:2px 8px 2px 0;">
        <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;"><tr>
          <td style="width:${ancho}%;background:${esHoy ? AZUL : "#7fb8d8"};height:10px;border-radius:3px;line-height:10px;font-size:0;">&nbsp;</td>
          <td style="height:10px;line-height:10px;font-size:0;">&nbsp;</td>
        </tr></table>
      </td>
      <td style="padding:2px 0;font-size:12px;color:${TINTA};text-align:right;white-space:nowrap;${peso}">${esc(Math.round(d.kg).toLocaleString("es-ES"))} kg</td>
      <td style="padding:2px 0 2px 10px;font-size:12px;color:${GRIS};text-align:right;white-space:nowrap;">${esc((Math.round(d.pctExp * 10) / 10).toLocaleString("es-ES"))}%</td>
    </tr>`;
  }).join("");
  const total = `<tr><td colspan="4" style="padding:6px 0 0;font-size:12px;color:${GRIS};">Total ${datos.serie.length} días: <strong style="color:${TINTA}">${esc(Math.round(datos.totalKg).toLocaleString("es-ES"))} kg</strong> · ${esc((Math.round(datos.totalPctExp * 10) / 10).toLocaleString("es-ES"))}% a exportación</td></tr>`;
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;">${filas}${total}</table>`;
}

/** La caja de REVISAR: los avisos con sus detalles anidados. */
function cajaRevisar(avisos) {
  const grupos = [];
  for (const a of avisos) {
    if (a.startsWith("  ") && grupos.length) grupos.at(-1).detalles.push(a.trim());
    else grupos.push({ texto: a, detalles: [] });
  }
  const cuerpo = grupos.map((g) =>
    `<p style="margin:6px 0 2px;font-size:13px;color:${TINTA};">&bull; ${esc(g.texto)}</p>` +
    g.detalles.map((d) => `<p style="margin:1px 0 1px 14px;font-size:12px;color:${GRIS};">${esc(d)}</p>`).join(""),
  ).join("");
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin:14px 0 4px;"><tr>
    <td style="background:#fef2f2;border:1px solid #fecaca;border-radius:10px;padding:12px 16px;">
      <p style="margin:0;font-size:13px;font-weight:700;letter-spacing:0.5px;color:${ROJO};">REVISAR (${grupos.length})</p>
      ${cuerpo}
    </td>
  </tr></table>`;
}

/**
 * El correo entero. Devuelve el HTML como cadena; el texto plano viaja aparte
 * como alternativa (Resend admite html + text en el mismo envío).
 */
export function renderAvisoHtml(modelo, { appUrl = "https://controlproduccion.vercel.app" } = {}) {
  const chip = modelo.hayProblema
    ? `<span style="display:inline-block;background:#fef2f2;color:${ROJO};border:1px solid #fecaca;font-size:12px;font-weight:700;padding:3px 10px;border-radius:999px;">Hay cosas que revisar</span>`
    : `<span style="display:inline-block;background:#ecfdf5;color:${VERDE};border:1px solid #a7f3d0;font-size:12px;font-weight:700;padding:3px 10px;border-radius:999px;">Sin incidencias</span>`;

  const titular = modelo.titular.length
    ? `<p style="margin:14px 0 0;font-size:15px;line-height:1.5;color:${TINTA};">${modelo.titular.map((t) => adornar(esc(t))).join("<br>")}</p>`
    : "";

  const secciones = modelo.secciones.map((s) => {
    if (s.id === "titular") return "";
    let cuerpo;
    if (s.id === "semana" && s.datos?.serie?.length) {
      cuerpo = tablaSemana(s.datos);
    } else {
      const pares = s.items.filter((i) => i.tipo === "par");
      const textos = s.items.filter((i) => i.tipo === "texto");
      cuerpo =
        (pares.length
          ? `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;">${pares.map(filaPar).join("")}</table>`
          : "") +
        textos.map((i) => parrafoTexto(i.texto, { appUrl })).join("");
    }
    return (s.titulo ? tituloSeccion(s.titulo) : "") + cuerpo;
  }).join("");

  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f3f4f6;">
<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;background:#f3f4f6;border-collapse:collapse;"><tr><td align="center" style="padding:16px 8px;">
<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;max-width:620px;background:#ffffff;border-radius:12px;border-collapse:collapse;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<tr><td style="padding:20px 22px 24px;">
  <p style="margin:0 0 4px;font-size:11px;font-weight:700;letter-spacing:1px;color:${GRIS};">HERRAMIENTA LASARTE &middot; AVISO DIARIO</p>
  <p style="margin:0 0 8px;font-size:20px;font-weight:700;color:${TINTA};">Producci&oacute;n del ${esc(modelo.fechaTexto)}</p>
  ${chip}
  ${modelo.avisos.length ? cajaRevisar(modelo.avisos) : ""}
  ${titular}
  ${secciones}
  <p style="margin:22px 0 0;padding-top:12px;border-top:1px solid #e5e7eb;font-size:11px;color:${GRIS};line-height:1.5;">
    Aviso autom&aacute;tico de las 07:10. Si un d&iacute;a NO llega, la tarea no corri&oacute; (port&aacute;til apagado,
    dormido o sin red) y el vigilante avisar&aacute; hacia las 13:45. El estado de todos los trabajos
    autom&aacute;ticos est&aacute; en <a href="${esc(appUrl)}/datos/fuentes" style="color:${AZUL};">Datos &rarr; Estado de las fuentes</a>.
  </p>
</td></tr>
</table>
</td></tr></table>
</body></html>`;
}
