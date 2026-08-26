// ¿Están vivos los trabajos automáticos? (compartida frontend/Deno, patrón
// fotoLotesCoherencia).
//
// /datos/fuentes ya vigila si los DATOS llegan; esto vigila si los TRABAJOS que
// los traen dan señales. La misma lógica la usan la página (para verlo) y la
// edge function `vigilante` (para AVISAR por correo cuando el portátil entero
// está apagado — justo el caso en el que el correo de las 07:10 no puede avisar,
// porque lo manda el propio portátil).
//
// Los umbrales son generosos a propósito: la idea es cazar el abandono, no dar
// la lata por unos minutos. Y cada estado malo lleva su "qué hacer" en lenguaje
// llano, porque un aviso que no dice cómo resolverse acaba ignorándose.

export interface LatidoRow {
  trabajo: string;
  visto_a: string;
  /** 'corriendo' | 'ok' | 'aviso' | 'error' — lo que dijo el propio trabajo. */
  estado: string;
  detalle: string | null;
  equipo: string | null;
}

export type EstadoTrabajo = "bien" | "atencion" | "mal" | "sin-estrenar";

export interface TrabajoSalud {
  id: string;
  nombre: string;
  /** Qué hace este trabajo, en una frase, para quien no lo conozca. */
  queHace: string;
  estado: EstadoTrabajo;
  /** El estado contado con palabras ("corrió hoy a las 07:12"). */
  titulo: string;
  /** Solo cuando hay que hacer algo: los pasos, en lenguaje llano. */
  queHacer: string | null;
  vistoA: string | null;
  detalle: string | null;
  equipo: string | null;
}

const MADRID = "Europe/Madrid";

/** El cron corre en UTC y el portátil en hora local: todo se compara en Madrid. */
function fechaMadrid(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: MADRID }).format(d);
}

function horaMadrid(d: Date): string {
  return new Intl.DateTimeFormat("es-ES", {
    timeZone: MADRID, hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).format(d);
}

function minutoDelDiaMadrid(d: Date): number {
  const [h, m] = horaMadrid(d).split(":").map(Number);
  return h * 60 + m;
}

function minutosDesde(iso: string, ahora: Date): number {
  return Math.max(0, Math.floor((ahora.getTime() - new Date(iso).getTime()) / 60_000));
}

function haceTexto(min: number): string {
  if (min < 1) return "ahora mismo";
  if (min < 60) return `hace ${min} min`;
  if (min < 48 * 60) return `hace ${Math.round(min / 60)} h`;
  return `hace ${Math.round(min / 1440)} días`;
}

interface Veredicto {
  estado: EstadoTrabajo;
  titulo: string;
  queHacer: string | null;
}

interface DefTrabajo {
  id: string;
  nombre: string;
  queHace: string;
  evaluar: (l: LatidoRow, ahora: Date) => Veredicto;
}

const QUE_HACER_TAREA =
  "Comprueba que el portátil de la oficina esté encendido y con red. Para recuperar el día: " +
  "Programador de tareas → «Lasarte - Sincronizar ERP» → botón Ejecutar. El parte y el correo " +
  "del día se crean solos al correr; no se pierde nada que el ERP y el Sizer ya tengan guardado.";

const QUE_HACER_RECEPTOR =
  "Tranquilidad: desde el 18-08 los informes del Sizer llegan por CORREO (buzón Gmail), así que con " +
  "el receptor caído no se pierde nada — es el respaldo de la LAN. La tarea «Lasarte - Receptor " +
  "calibrador» lo relanza sola cada 5 minutos en cuanto el portátil de la oficina esté encendido.";

/** La tarea de las 07:10 con reintentos cada 20 min hasta las 12:10 (ver tarea-diaria-erp.cmd). */
function evaluarTareaDiaria(l: LatidoRow, ahora: Date): Veredicto {
  const minuto = minutoDelDiaMadrid(ahora);
  const finVentana = 12 * 60 + 30; // el último reintento es a las 12:10; margen para que termine
  const esDeHoy = fechaMadrid(new Date(l.visto_a)) === fechaMadrid(ahora);
  const hora = horaMadrid(new Date(l.visto_a));

  if (esDeHoy) {
    if (l.estado === "corriendo") {
      return minutosDesde(l.visto_a, ahora) > 120
        ? { estado: "atencion", titulo: `empezó a las ${hora} y no ha dicho que terminara`, queHacer: QUE_HACER_TAREA }
        : { estado: "bien", titulo: `está corriendo ahora mismo (empezó a las ${hora})`, queHacer: null };
    }
    if (l.estado === "error") {
      return minuto < finVentana
        ? { estado: "atencion", titulo: `terminó con error a las ${hora}; se reintenta sola cada 20 min hasta las 12:10`, queHacer: null }
        : { estado: "mal", titulo: `hoy terminó con error (a las ${hora}) y ya no quedan reintentos`, queHacer: QUE_HACER_TAREA };
    }
    return {
      estado: "bien",
      titulo: l.estado === "aviso"
        ? `corrió hoy a las ${hora} (su correo salió con cosas que revisar)`
        : `corrió hoy a las ${hora}`,
      queHacer: null,
    };
  }
  if (minuto < 7 * 60 + 30) {
    return { estado: "bien", titulo: "aún no le toca: corre a las 07:10", queHacer: null };
  }
  if (minuto < finVentana) {
    return {
      estado: "atencion",
      titulo: "hoy aún no ha corrido; se reintenta sola cada 20 min hasta las 12:10",
      queHacer: "Si a mediodía sigue igual, comprueba que el portátil de la oficina esté encendido y con red.",
    };
  }
  return {
    estado: "mal",
    titulo: "hoy no ha corrido, y ya pasó su ventana de reintentos (de 07:10 a 12:10)",
    queHacer: QUE_HACER_TAREA,
  };
}

/** El receptor escucha de 06:00 a 22:00 y da un latido cada 5 minutos. */
function evaluarReceptor(l: LatidoRow, ahora: Date): Veredicto {
  const min = minutosDesde(l.visto_a, ahora);
  const hora = horaMadrid(new Date(l.visto_a));
  const minuto = minutoDelDiaMadrid(ahora);
  const enHorario = minuto >= 6 * 60 + 30 && minuto <= 22 * 60;

  if (!enHorario) {
    return min <= 26 * 60
      ? { estado: "bien", titulo: `fuera de su horario (escucha de 06:00 a 22:00); última señal a las ${hora}`, queHacer: null }
      : { estado: "mal", titulo: `no dio señales en toda la última jornada (lo último, ${haceTexto(min)})`, queHacer: QUE_HACER_RECEPTOR };
  }
  if (min <= 45) {
    return { estado: "bien", titulo: `escuchando (última señal ${haceTexto(min)})`, queHacer: null };
  }
  if (min <= 90) {
    return { estado: "atencion", titulo: `sin señales desde las ${hora}; su tarea lo relanza cada 5 min`, queHacer: null };
  }
  return {
    estado: "mal",
    // Desde el 18-08 los informes llegan por correo: un receptor caído ya no
    // pierde nada, pero un respaldo apagado tampoco es un respaldo.
    titulo: `no da señales desde las ${hora} (no se pierde nada: los informes llegan por correo, pero el respaldo está apagado)`,
    queHacer: QUE_HACER_RECEPTOR,
  };
}

/** Trabajos que corren cada cierto tiempo: fotos de palets, buzón, el propio vigilante. */
function periodico(cadaTexto: string, bienMin: number, malMin: number, queHacer: string) {
  return (l: LatidoRow, ahora: Date): Veredicto => {
    const min = minutosDesde(l.visto_a, ahora);
    // Sin señal en mucho tiempo es "parado" diga lo que diga la última señal:
    // lo que pide correo es el silencio, no el contenido.
    if (min > malMin) {
      return { estado: "mal", titulo: `parado: la última señal fue ${haceTexto(min)}`, queHacer };
    }
    if (l.estado === "error") {
      return { estado: "atencion", titulo: `la última vez terminó con error (${haceTexto(min)}): ${l.detalle ?? "sin detalle"}`, queHacer };
    }
    if (l.estado === "aviso") {
      // Un pendiente conocido (p. ej. el buzón sin credenciales): se ve, pero
      // mientras el trabajo siga dando señales no despierta a nadie.
      return { estado: "atencion", titulo: `${l.detalle ?? "terminó con aviso"} (${haceTexto(min)})`, queHacer: null };
    }
    if (min <= bienMin) return { estado: "bien", titulo: `corrió ${haceTexto(min)}`, queHacer: null };
    return { estado: "atencion", titulo: `lleva ${haceTexto(min).replace("hace ", "")} sin correr (lo normal es ${cadaTexto})`, queHacer: null };
  };
}

/**
 * El directorio de trabajos. El orden es el de importancia: lo primero que se
 * mira es lo que más duele si falta.
 */
const TRABAJOS: DefTrabajo[] = [
  {
    id: "tarea-diaria",
    nombre: "Tarea diaria (ERP + partes + correo de las 07:10)",
    queHace: "Sincroniza entradas, trazabilidad y precalibrado del ERP, deja el parte de ayer en borrador y manda el correo del día.",
    evaluar: evaluarTareaDiaria,
  },
  {
    id: "receptor",
    nombre: "Receptor LAN del calibrador (respaldo)",
    queHace: "Escucha en la red de la oficina por si el Sizer volviera a mandar por LAN. Desde el 18-08 los informes llegan por correo (buzón Gmail): esta vía es solo el respaldo.",
    evaluar: evaluarReceptor,
  },
  {
    id: "foto-palets",
    nombre: "Foto horaria de palets del ERP",
    queHace: "Guarda cada hora el total de palets del día, para deducir la hora de cierre y el inventario sin dar de alta.",
    evaluar: periodico(
      "cada hora",
      6 * 60,
      26 * 60,
      "Comprueba el portátil de la oficina; su tarea es «Lasarte - Foto palets ERP». Sin fotos no se " +
      "puede deducir la hora de cierre ni el inventario sin alta, pero no se pierde nada que el ERP tenga.",
    ),
  },
  // REACTIVADO 18-08-2026: Tomra configuró el auto-envío del Sizer contra
  // Gmail, así que los informes de lote viajan ahora por correo y este lector
  // es quien los mete en la Herramienta. (Estuvo apagado del 14 al 18-08.)
  {
    id: "leer-buzon",
    nombre: "Buzón del calibrador (Gmail)",
    queHace: "Lee lasartecitricos@gmail.com e importa lo que el Sizer envía: informes de lote, exports SQL y Excel reconocidos.",
    evaluar: periodico(
      "cada 30 min en horario de trabajo",
      12 * 60,
      26 * 60,
      "Comprueba el portátil de la oficina; su tarea es «Lasarte - Leer buzon». Mientras esté parado, " +
      "los informes se quedan en el buzón de Gmail sin importar (no se pierden: se recuperan al arrancar).",
    ),
  },
  {
    id: "copia-seguridad",
    nombre: "Copia de seguridad diaria",
    queHace: "Baja cada noche (21:30) todas las tablas y los archivos nuevos del storage a outputs/copias — OneDrive los sube a la nube — y se verifica releyéndose entera.",
    evaluar: periodico(
      "una vez al día (21:30)",
      26 * 60,
      50 * 60,
      "Comprueba el portátil de la oficina; su tarea es «Lasarte - Copia de seguridad» (también vale " +
      "a mano: node scripts/copia-seguridad.mjs). No se pierde nada todavía, pero un desastre de la " +
      "base solo se cubre con la última copia buena — cuanto más vieja, más días perdidos.",
    ),
  },
  {
    id: "vigilante",
    nombre: "Vigilante (corre en Supabase)",
    queHace: "Comprueba cada día a las 13:45, desde fuera del portátil, que todo lo de arriba ha corrido; si no, avisa por correo.",
    evaluar: periodico(
      "una vez al día",
      26 * 60,
      50 * 60,
      "Es el único trabajo que NO corre en el portátil. Si está parado, nadie avisa cuando el portátil " +
      "falle: hay que revisar el job «vigilante-diario» de pg_cron en Supabase.",
    ),
  },
];

export function evaluarTrabajos(latidos: LatidoRow[], ahora: Date): TrabajoSalud[] {
  const porTrabajo = new Map(latidos.map((l) => [l.trabajo, l]));
  return TRABAJOS.map((def) => {
    const l = porTrabajo.get(def.id) ?? null;
    const base = {
      id: def.id,
      nombre: def.nombre,
      queHace: def.queHace,
      vistoA: l?.visto_a ?? null,
      detalle: l?.detalle ?? null,
      equipo: l?.equipo ?? null,
    };
    if (!l) {
      // Sin estrenar no es una avería: se ve aquí, pero no despierta a nadie.
      return { ...base, estado: "sin-estrenar" as const, titulo: "todavía no ha dado ninguna señal", queHacer: null };
    }
    return { ...base, ...def.evaluar(l, ahora) };
  });
}

/** El correo del vigilante: solo los trabajos en "mal", con su qué hacer. */
export function renderAvisoVigilante(problemas: TrabajoSalud[]): { asunto: string; cuerpo: string } {
  const n = problemas.length;
  const asunto = `[SISTEMA] ${n} trabajo${n === 1 ? "" : "s"} del portátil de la oficina sin dar señales`;
  const lineas = [
    "Soy el vigilante que corre en Supabase, fuera del portátil de la oficina.",
    "Este correo solo llega cuando algún trabajo automático deja de dar señales",
    "— casi siempre porque el portátil está apagado, dormido o sin red.",
    "",
    "QUE FALLA",
    "",
  ];
  for (const p of problemas) {
    lineas.push(`- ${p.nombre}: ${p.titulo}.`);
    if (p.queHacer) lineas.push(`  Qué hacer: ${p.queHacer}`);
    lineas.push("");
  }
  lineas.push("El detalle de todos los trabajos y fuentes está en:");
  lineas.push("https://controlproduccion.vercel.app/datos/fuentes");
  lineas.push("");
  lineas.push("--");
  lineas.push("Vigilante diario (13:45). Mientras el problema siga, avisará una vez al día.");
  return { asunto, cuerpo: lineas.join("\n") };
}
