/**
 * A qué hora se termina de dar de alta, y cuánto quedó sin dar de alta.
 *
 * Puro: se le dan las fotos ya leídas (erp_palets_foto) y calcula. Así se puede
 * probar sin ERP ni Supabase.
 *
 * ─── POR QUÉ SE DEDUCE LA HORA EN VEZ DE PREGUNTARLA ────────────────────────
 * La hora de cierre se mueve: en agosto de 2026 terminan sobre las 13:00-13:10,
 * y con horario normal serán las 14:00 o las 15:00. Preguntarla obliga a que
 * alguien se acuerde de avisar cada vez que cambia el turno; deducirla de las
 * fotos no. La señal es simple: a partir del cierre, los kilos del día dejan de
 * subir.
 *
 * ─── EL INVENTARIO SIN DAR DE ALTA ──────────────────────────────────────────
 * Es lo que hoy se pesa y se cuenta a mano. Idea de las que lo hacen: si se mira
 * el listado de palets AL CERRAR y otra vez a la mañana siguiente, lo que ha
 * crecido el día anterior es justo lo que quedó sin dar de alta.
 *
 *     inventario sin alta (día D) = kg del día D visto al día siguiente
 *                                 − kg del día D visto al cerrar D
 *
 * NO se calcula si falta cualquiera de las dos fotos: sin ellas el número sería
 * inventado, y ese hueco es exactamente el que hay que ver.
 */

/** Hora local "HH:MM" de una marca de tiempo ISO con zona. */
export function horaLocal(iso, zona = "Europe/Madrid") {
  return new Date(iso).toLocaleTimeString("es-ES", {
    timeZone: zona, hour: "2-digit", minute: "2-digit", hour12: false,
  });
}

/** Día local "AAAA-MM-DD" en que se tomó la foto (no el día de los palets). */
export function diaLocal(iso, zona = "Europe/Madrid") {
  const p = new Intl.DateTimeFormat("sv-SE", {
    timeZone: zona, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(iso));
  return p;   // "sv-SE" da directamente AAAA-MM-DD
}

const minutos = (hhmm) => {
  const [h, m] = String(hhmm).split(":").map(Number);
  return h * 60 + m;
};

/**
 * La foto en que el día se dio por cerrado: la primera a partir de la cual los
 * kilos ya no suben de forma apreciable.
 *
 * @param fotos  del MISMO día, ordenadas por tomada_a. {tomada_a, kg_netos, palets}
 * @param margen kg que se toleran como ruido (correcciones sueltas de un palet).
 */
export function detectarCierre(fotos, { margen = 500 } = {}) {
  const delDia = [...(fotos ?? [])].sort((a, b) => String(a.tomada_a).localeCompare(String(b.tomada_a)));
  if (delDia.length < 3) return { estado: "pocas-fotos", fotos: delDia.length };

  const maximo = Math.max(...delDia.map((f) => Number(f.kg_netos) || 0));
  if (maximo <= 0) return { estado: "sin-palets" };

  // La primera foto que ya está a menos de `margen` del máximo del día: a partir
  // de ahí lo que entra son retoques, no produccion nueva.
  const i = delDia.findIndex((f) => (Number(f.kg_netos) || 0) >= maximo - margen);
  if (i < 0) return { estado: "sin-meseta" };

  // Si el máximo lo alcanza la ÚLTIMA foto, el día puede no haber terminado.
  const cerrado = i < delDia.length - 1;
  return {
    estado: cerrado ? "cerrado" : "quiza-abierto",
    hora: horaLocal(delDia[i].tomada_a),
    kg: Number(delDia[i].kg_netos) || 0,
    palets: Number(delDia[i].palets) || 0,
    fotosDespues: delDia.length - 1 - i,
  };
}

/**
 * Los kilos que quedaron sin dar de alta el día `dia`.
 *
 * @param dia          día de los palets, "AAAA-MM-DD".
 * @param fotosDelDia  TODAS las fotos de ese día, incluidas las tomadas al día
 *                     siguiente (que es cuando aparecen los que faltaban).
 *
 * Las fotos se separan por el DÍA EN QUE SE TOMARON, no por la hora: una foto de
 * las 07:00 puede ser de la mañana del propio día (cuando aún no ha pasado nada)
 * o de la mañana siguiente (cuando ya está todo). Mirar solo la hora las
 * confunde.
 */
export function inventarioSinAlta(dia, fotosDelDia, { horaCierre, margen = 500 } = {}) {
  const fotos = [...(fotosDelDia ?? [])].sort((a, b) => String(a.tomada_a).localeCompare(String(b.tomada_a)));
  if (fotos.length < 2) return { estado: "pocas-fotos" };

  const delDia = fotos.filter((f) => diaLocal(f.tomada_a) <= dia);
  const despues = fotos.filter((f) => diaLocal(f.tomada_a) > dia);

  const cierre = horaCierre ?? detectarCierre(delDia, { margen }).hora;
  if (!cierre) return { estado: "sin-hora-de-cierre" };

  const alCerrar = delDia.filter((f) => minutos(horaLocal(f.tomada_a)) >= minutos(cierre));
  if (alCerrar.length === 0) return { estado: "sin-foto-del-cierre", cierre };
  if (despues.length === 0) return { estado: "sin-foto-de-la-mañana", cierre };

  const kgCierre = Number(alCerrar[0].kg_netos) || 0;
  const kgDespues = Number(despues.at(-1).kg_netos) || 0;
  const kg = kgDespues - kgCierre;

  return {
    estado: "calculado",
    cierre,
    kgCierre,
    kgDespues,
    // Negativo = se anularon palets despues del cierre. No es inventario: se dice.
    kg: kg > 0 ? kg : 0,
    anulaciones: kg < 0 ? -kg : 0,
    horaMedida: horaLocal(despues.at(-1).tomada_a),
  };
}
