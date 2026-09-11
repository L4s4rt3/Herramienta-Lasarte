/**
 * lib-revision-parte.mjs — LA REVISIÓN DEL PARTE, antes de mandar el correo.
 *
 * ENCARGO DEL DUEÑO (11-09-2026): «que los partes diarios se cuadren antes de
 * enviar los correos automáticos; se investiga y se cuadra con la información
 * que se tenga, y si no es posible, que el correo lo avise, diga una valoración
 * y qué se cree que ha podido pasar».
 *
 * QUÉ FALTABA. La tarea de la mañana ya hacía las piezas sueltas —subir los
 * informes, analizar, estimar el papel, cuadrar el parte contra su detalle—
 * pero nadie juntaba el resultado: el correo salía con el descuadre enterrado
 * en mitad del texto y sin decir si el día estaba en orden. Quien lo leía tenía
 * que reconstruirlo cada mañana. Esto pone las comprobaciones en una lista con
 * nombre, intenta arreglar lo arreglable, y lo que no se pueda arreglar lo
 * explica en cristiano.
 *
 * QUÉ SE COMPRUEBA, Y POR QUÉ SOLO ESTO. Lo COMPROBABLE: que estén los informes
 * de lote, que esté el GSTOCK, que el parte esté analizado, que cuadre con su
 * propio detalle, que no haya pasadas repetidas ni palets imposibles, y que los
 * cinco datos del papel estén puestos (tecleados o estimados).
 *
 * EL DESCUADRE (DSJ) NO ES UNA COMPROBACIÓN, es un dato que se explica. Medido
 * sobre los últimos 42 días con producción: solo 12 caen dentro del ±3% y 26
 * pasan del ±5%. No es un fallo del dato: lo que se calibra un día se paletiza
 * ese día o el siguiente, y el balance cierra con el tiempo (media diaria
 * |11,7%|, campaña entera +0,1%). Convertirlo en un reparo habría pintado de
 * rojo más de la mitad de los días por algo que se corrige solo a la semana
 * siguiente. Lo que sí se hace es DIAGNOSTICARLO: decir, con el resto de las
 * comprobaciones en la mano, qué lo explica ese día en concreto.
 *
 * ESTO NO VALIDA NADA. El estado "Validado" sigue siendo el único candado
 * humano (regla del dueño del 28-08-2026). La revisión deja su marca en la
 * columna `revision` del parte: dice "la máquina lo ha repasado", no "una
 * persona lo firma".
 *
 *   node scripts/revisar-partes.mjs --fecha=2026-09-10
 *   node scripts/revisar-partes.mjs --dias=7 --aplicar
 */
import { cuadrar, rehacerParte } from "./rehacer-parte.mjs";
import { CINCO_DEL_PAPEL } from "./lib-estimar-manuales.mjs";
import { codigoBaseLote } from "./lib-lotes.mjs";

/**
 * Un palet de más de 10 toneladas no existe: es un palet de regularización que
 * el ERP fecha con el día de su lote. Mismo umbral que generar-gstock-erp.mjs,
 * donde se descubrió.
 */
export const KG_PALET_SOSPECHOSO = 10000;

/** Días de gracia antes de estimar el papel. Espejo de lib-estimar-manuales.mjs. */
const GRACIA_PAPEL = 2;

const num = (v) => Number(v) || 0;
const miles = (n) => Math.round(n).toLocaleString("es-ES");
const kg = (n) => `${miles(n)} kg`;
const pct = (n) => `${(Math.round(n * 10) / 10).toLocaleString("es-ES")}%`;
const dd = (n) => String(n).padStart(2, "0");
const comoFecha = (d) => `${d.getFullYear()}-${dd(d.getMonth() + 1)}-${dd(d.getDate())}`;
const sumaDias = (iso, n) => comoFecha(new Date(Date.parse(`${iso}T12:00:00`) + n * 86400000));

/** Nombres de los cinco del papel tal y como los llama quien los teclea. */
const NOMBRE_PAPEL = {
  kg_industria_manual: "industria",
  kg_reciclado_malla_z1: "reciclado Z1",
  kg_reciclado_malla_z2: "reciclado Z2",
  kg_inventario_sin_alta: "inventario sin alta",
  kg_podrido_bolsa_basura: "podrido de bolsa",
};

/**
 * El descuadre tal y como lo calcula src/lib/cascade.ts y crear-parte-diario.mjs.
 * Se repite aquí a propósito: la revisión tiene que poder correr sobre un parte
 * cualquiera de la ventana, no solo sobre el que acaba de tocar el ERP.
 */
export function calcularDsj(parte) {
  if (!parte) return null;
  const produccionReal = num(parte.kg_produccion_calibrador) - num(parte.kg_mujeres_calibrador)
    - num(parte.kg_reciclado_malla_z1) - num(parte.kg_reciclado_malla_z2);
  if (!(produccionReal > 0) || !(num(parte.kg_palets_brutos) > 0)) return null;
  const desvio = produccionReal
    - (num(parte.kg_palets_brutos) - num(parte.kg_inventario_anterior_sin_alta))
    - num(parte.kg_inventario_sin_alta) - num(parte.kg_podrido_bolsa_basura);
  return { kg: desvio, pct: (desvio / produccionReal) * 100 };
}

/**
 * Cómo está el papel: puesto a mano, estimado por el sistema, o sin poner.
 *
 * Los CINCO a cero es "nadie lo metió" (un solo campo a 0 puede ser un 0 real),
 * misma regla que lib-estimar-manuales.mjs — y si están a cero pero hay marcas
 * de estimación, el papel está puesto por el sistema, que es lo que vale aquí.
 */
export function estadoDelPapel(parte, hoy) {
  const marcas = parte?.campos_estimados?.campos ?? null;
  const estimados = CINCO_DEL_PAPEL.filter((c) => marcas?.[c]);
  const conValor = CINCO_DEL_PAPEL.filter((c) => num(parte?.[c]) !== 0);
  // Tecleado = tiene valor y NO lleva marca de estimación.
  const tecleados = conValor.filter((c) => !marcas?.[c]);
  const puesto = tecleados.length > 0 || estimados.length > 0;
  // Cuándo le tocará la estimación si nadie lo teclea: el día del parte más los
  // días de gracia. Si ya pasó y sigue sin nada, es que la estimación no pudo.
  const estimaraEl = parte ? sumaDias(parte.date, GRACIA_PAPEL) : null;
  return {
    puesto,
    tecleados,
    estimados,
    estimaraEl,
    graciaAgotada: Boolean(hoy && estimaraEl && hoy > estimaraEl),
  };
}

/**
 * LAS COMPROBACIONES. Puro: se le dan los hechos ya reunidos y devuelve la
 * lista con su estado. "n/a" es "aquí no aplica" (un día sin confección no
 * tiene informes que echar en falta), y no cuenta como reparo.
 */
export function comprobarParte(h) {
  const c = [];
  /**
   * `titulo` es el nombre de la comprobación EN POSITIVO ("Informes de lote
   * completos") y sirve para la lista entera. `fallo` es cómo se llama cuando
   * sale mal ("falta 1 informe de lote"), y es lo que va en los resúmenes de
   * una línea: sin él, "2026-09-09: informes de lote completos" se lee como si
   * ese día estuviera bien, que es justo lo contrario de lo que pasa.
   */
  const pon = (clave, titulo, estado, detalle, fallo = null) =>
    c.push({ clave, titulo, estado, detalle, ...(estado === "reparo" && fallo ? { fallo } : {}) });
  const p = h.parte;

  if (!p) {
    // Un domingo NO tiene parte, y eso no es un fallo: sin actividad no hay
    // nada que cuadrar. Reclamarlo cada fin de semana habría llenado el correo
    // de rojo por los días en que no se trabaja.
    pon("parte", "El parte del día existe", h.hayActividad ? "reparo" : "n/a",
      h.hayActividad ? "no hay parte para ese día" : "día sin actividad: no toca parte",
      "no hay parte de ese día");
    return c;
  }
  pon("parte", "El parte del día existe", "ok", `en estado "${p.estado}"`);

  // 1. Producción. Sin kilos del calibrador el parte no es nada: ni desglose,
  //    ni descuadre, ni análisis que valga.
  if (!h.hayActividad) {
    pon("produccion", "Producción del calibrador", "n/a", "día sin actividad (festivo, fin de semana o línea parada)");
  } else if (num(p.kg_produccion_calibrador) > 0) {
    pon("produccion", "Producción del calibrador", "ok",
      `${kg(p.kg_produccion_calibrador)}${p.origen_calibrador === "docx" ? " (de informes de lote, provisional)" : ""}`);
  } else {
    pon("produccion", "Producción del calibrador", "reparo", "el parte no tiene kilos de calibrador",
      "sin kilos del calibrador");
  }

  // 2. Informes de lote. Es lo que más falla y lo que más engaña: sin un
  //    informe, la producción sale corta y el descuadre se va en negativo.
  const perd = h.informes?.perdonados;
  // Lo perdonado se DICE: si un día alguien se pregunta por qué no se reclama
  // un lote, la respuesta tiene que estar aquí y no en el código.
  const notaPerdonados = perd && (perd.precalibrado || perd.viejos)
    ? ` (sin contar ${[perd.precalibrado && `${perd.precalibrado} de precalibrado`,
      perd.viejos && `${perd.viejos} de cámara`].filter(Boolean).join(" y ")}, que no llevan informe propio)`
    : "";
  if (!h.informes || h.informes.lotesConfeccion === 0) {
    pon("informes", "Informes de lote completos", "n/a", "ese día no se confeccionó ningún lote");
  } else if (h.informes.faltan.length === 0) {
    pon("informes", "Informes de lote completos", "ok",
      `${h.informes.recibidos} informe(s) para ${h.informes.lotesConfeccion} lote(s) de confección${notaPerdonados}`);
  } else {
    pon("informes", "Informes de lote completos", "reparo",
      `faltan ${h.informes.faltan.length}: ${h.informes.faltan.join(", ")}${notaPerdonados}`,
      h.informes.faltan.length === 1
        ? `falta el informe del lote ${h.informes.faltan[0]}`
        : `faltan ${h.informes.faltan.length} informes de lote (${h.informes.faltan.join(", ")})`);
  }

  // 3. GSTOCK. Sin él no hay kilos de palets, y sin palets no hay descuadre.
  if (num(p.kg_palets_brutos) > 0) {
    pon("gstock", "GSTOCK del día (kilos de palets)", "ok", kg(p.kg_palets_brutos));
  } else if (!h.hayActividad) {
    pon("gstock", "GSTOCK del día (kilos de palets)", "n/a", "día sin actividad");
  } else {
    pon("gstock", "GSTOCK del día (kilos de palets)", "reparo", "el parte no tiene kilos de palets",
      "sin el GSTOCK del día");
  }

  // 4. Análisis. Es lo que extrae el desglose por calibre y destino de los
  //    Excel subidos: sin él los archivos están ahí sin servirle a nadie.
  pon("analisis", "Parte analizado", p.analizado ? "ok" : "reparo",
    p.analizado ? "tiene análisis" : "los informes están subidos pero sin extraer",
    "el parte sin analizar");

  // 5. El parte contra su propio detalle. Esto es EL cuadre: que producción,
  //    calibres, producto y lotes digan el mismo número, y que los palets del
  //    parte sumen lo mismo que sus filas. Pasó el 17-08-2026 con las mujeres
  //    contadas dos veces y solo se vio porque alguien se puso a mirarlo.
  if (!h.cuadre) {
    pon("detalle", "El parte cuadra con su detalle", "n/a", "sin datos que cuadrar");
  } else {
    const desviosSinRepetidas = h.cuadre.desvios.filter((d) => !d.startsWith("lotes: el detalle trae"));
    pon("detalle", "El parte cuadra con su detalle",
      desviosSinRepetidas.length ? "reparo" : "ok",
      desviosSinRepetidas.length
        ? desviosSinRepetidas.join("; ")
        : `producción ${kg(h.cuadre.prod)} = calibres = producto = lotes · palets ${kg(h.cuadre.palets)} = detalle`,
      "el parte y su detalle no dicen lo mismo");
  }

  // 6. Pasadas repetidas. La app suma TODA fila de lotes_dia sin mirar de dónde
  //    vino, así que mientras esté ahí cuenta doble en procesado, stock y merma.
  const rep = h.cuadre?.lotesRepetidas ?? [];
  pon("repetidas", "Sin pasadas repetidas", rep.length ? "reparo" : "ok",
    rep.length
      ? `${rep.length} pasada(s) dos veces (${rep.map((r) => r.lote).join(", ")}), ${kg(h.cuadre.lotesKgRepetido)} de más`
      : "cada pasada una sola vez",
    `${rep.length} pasada(s) contadas dos veces`);

  // 7. Palets imposibles.
  const sosp = h.paletsSospechosos ?? [];
  pon("palets-creibles", "Palets con kilos creíbles", sosp.length ? "reparo" : "ok",
    sosp.length
      ? `${sosp.length} palet(s) de más de ${miles(KG_PALET_SOSPECHOSO)} kg: ${sosp.slice(0, 3).map((s) => `${s.palet} (${kg(s.kg)})`).join(", ")}`
      : "ninguno por encima de las 10 toneladas",
    `${sosp.length} palet(s) de más de 10 toneladas`);

  // 8. El papel. Vale tecleado y vale estimado: lo que no vale es que no esté,
  //    porque entonces el descuadre que sale en el correo no significa nada.
  const papel = h.papel;
  if (!h.hayActividad) {
    pon("papel", "Los cinco datos del papel", "n/a", "día sin actividad");
  } else if (papel?.tecleados.length && !papel.estimados.length) {
    pon("papel", "Los cinco datos del papel", "ok", "tecleados por una persona");
  } else if (papel?.puesto) {
    pon("papel", "Los cinco datos del papel", "ok",
      `${papel.estimados.length} estimado(s) según histórico: ${papel.estimados.map((x) => NOMBRE_PAPEL[x] ?? x).join(", ")}`);
  } else {
    pon("papel", "Los cinco datos del papel", "reparo", "nadie los ha metido todavía",
      "el papel sin teclear");
  }

  return c;
}

/** El veredicto sale de las comprobaciones: si hay un solo reparo, hay reparos. */
export function veredictoDe(comprobaciones) {
  const parte = comprobaciones.find((c) => c.clave === "parte");
  if (parte?.estado === "reparo") return "sin-parte";
  // Un día sin parte y sin actividad (domingo, festivo, línea parada) no está
  // ni bien ni mal: no hay día que cuadrar, y el correo no lo menciona.
  if (parte?.estado === "n/a") return "sin-actividad";
  return comprobaciones.some((c) => c.estado === "reparo") ? "con-reparos" : "en-orden";
}

/**
 * LA VALORACIÓN: qué se cree que ha pasado.
 *
 * Esta es la mitad del encargo que no existía. Un reparo a secas ("faltan 2
 * informes") deja el trabajo de interpretar a quien lee el correo a las siete
 * de la mañana. Aquí se dice, con el resto de comprobaciones en la mano, cuál
 * es la explicación más probable — y cuándo se arregla solo, que casi siempre
 * es la respuesta.
 *
 * Cada frase dice de dónde sale lo que afirma. Si no hay forma de saberlo, se
 * dice que no se sabe; nunca se rellena con una causa inventada.
 */
export function diagnosticar(h, comprobaciones) {
  const d = [];
  const falla = (clave) => comprobaciones.find((c) => c.clave === clave)?.estado === "reparo";
  const p = h.parte;

  if (!p) {
    // Sin actividad no hay nada que explicar: es un domingo, no una avería.
    if (h.hayActividad) {
      d.push("Hubo trabajo ese día pero no hay parte. O la tarea de la mañana no llegó a correr (portátil"
        + " apagado o sin red), o el primer lote del día no llegó a engancharse. Se crea solo en cuanto la"
        + " tarea vuelva a correr, que repasa los últimos 14 días.");
    }
    return d;
  }

  // Informes que faltan: lo más frecuente, y casi siempre se arregla solo.
  if (falla("informes")) {
    const n = h.informes.faltan.length;
    d.push(`Faltan ${n} informe(s) de lote (${h.informes.faltan.join(", ")}). El Sizer manda el informe al CERRAR`
      + " el lote: si el lote se cerró de madrugada, su informe llega hoy y el parte se rehace solo."
      + " Si mañana sigue faltando, ese lote no pasó por el visor y hay que sacarlo a mano"
      + ' ("Reporte por email" en el visor del calibrador).');
  }

  // El descuadre, explicado con lo que sabemos del día. No es un reparo: es el
  // número que todo el mundo mira, y sin explicación se lee como fruta perdida.
  if (h.dsj) {
    const alto = Math.abs(h.dsj.pct) > 5;
    if (h.dsj.pct < 0 && alto) {
      const porFaltarInformes = falla("informes") || p.origen_calibrador === "docx";
      d.push(`El descuadre sale NEGATIVO (${kg(h.dsj.kg)}, ${pct(h.dsj.pct)}): se paletizaron más kilos de los que`
        + ` dice el calibrador.${porFaltarInformes
          ? " Con la producción saliendo de informes de lote (y no del volcado del Sizer), lo más probable es que"
          + " falte producción por contar, no que sobren palets: de un lote con varias pasadas el informe solo ve la última."
          : " Con la producción saliendo del volcado del Sizer, lo habitual es que sean palets de fruta calibrada"
          + " el día anterior y dada de alta hoy."}`);
    } else if (h.dsj.pct > 0 && alto) {
      const sig = h.siguiente;
      const cierraMañana = sig && sig.palets > sig.prod;
      d.push(`El descuadre sale POSITIVO (${kg(h.dsj.kg)}, ${pct(h.dsj.pct)}): se calibró más de lo que se paletizó.`
        + (cierraMañana
          ? ` Cuadra con el ritmo normal: el ${sig.fecha} hay ${kg(sig.palets)} de palets contra ${kg(sig.prod)} de`
            + " producción, o sea que parte de lo de este día se paletizó al siguiente."
          : " Lo habitual es que parte de lo calibrado se paletice al día siguiente; el balance de la campaña entera"
            + " cierra en +0,1%, así que un día suelto por encima no es fruta perdida."));
    }
  }

  if (falla("gstock")) {
    d.push("Sin el GSTOCK no hay kilos de palets y por eso no hay descuadre. Las dos causas habituales:"
      + " el ERP no respondió cuando corrió la tarea, o a esa hora todavía no habían terminado de dar de alta."
      + " Mientras el parte siga en Borrador la tarea lo rehace sola en cuanto el ERP tenga más palets.");
  }

  if (falla("analisis")) {
    d.push("El parte tiene archivos subidos pero sin extraer, así que se queda sin desglose por calibre ni por"
      + " destino. Normalmente es que le faltan los informes en Excel del calibrador (el DOCX de lote no sirve"
      + " para esto a propósito). Se fuerza con: node scripts/rehacer-parte.mjs --fecha=" + p.date + " --aplicar");
  }

  if (falla("detalle")) {
    d.push("El parte y su propio detalle no dicen el mismo número. Eso no lo provoca la fruta: es un informe"
      + " subido dos veces o un análisis que se quedó a medias. Se arregla rehaciendo el parte"
      + ` (node scripts/rehacer-parte.mjs --fecha=${p.date} --aplicar), que vuelve a montar los informes y lo reanaliza.`);
  }

  if (falla("repetidas")) {
    d.push("La misma pasada está dos veces en el detalle: una la metió el parte y otra el volcado del calibrador,"
      + " con el código escrito de forma distinta. La app suma las dos, así que son kilos de más en procesado,"
      + " stock y merma. Se limpia con: node scripts/quitar-pasadas-repetidas.mjs --aplicar"
      + " (guarda copia en CSV antes de borrar y no toca la fila que lleve datos propios).");
  }

  if (falla("palets-creibles")) {
    d.push("Hay palets de más de 10 toneladas. Casi siempre son palets de regularización del ERP, que les pone la"
      + " fecha del lote de confección y no la del día: engordan los kilos del día sin ser fruta de ese día."
      + " Conviene mirarlos antes de fiarse del descuadre.");
  }

  if (falla("papel")) {
    const papel = h.papel;
    d.push(papel?.graciaAgotada
      ? `Nadie ha tecleado el papel y la estimación automática ya debería haber entrado (tocaba el ${papel.estimaraEl}).`
        + " Que no esté puesta apunta a que el parte no cumple sus condiciones (por ejemplo, está Validado) o a que"
        + " el script de estimación falló: merece un vistazo."
      : `El papel del día todavía no se ha tecleado. Si nadie lo mete, el sistema lo estimará según histórico el`
        + ` ${papel?.estimaraEl ?? "día siguiente"}, lo marcará en ámbar, y el dato real lo pisará solo en cuanto`
        + " alguien lo escriba. Hasta entonces el descuadre está incompleto: los manuales solo pueden bajarlo.");
  }

  return d;
}

// ─── Reunir los hechos ───────────────────────────────────────────────────────

/**
 * Cuántos días atrás se busca el informe de un lote. La fruta que se confecciona
 * hoy pudo calibrarse hace unos días y dormir en cámara: su informe lleva LA
 * FECHA EN QUE SE CALIBRÓ, no la de hoy. Buscando solo en el día, el 26083102
 * salía como "sin informe" el 09-09 teniéndolo del 07-09.
 */
const DIAS_ATRAS_INFORME = 7;

/**
 * Un lote de hace más de esto es fruta de cámara o de otra campaña: su informe,
 * si existió, es de entonces y pedirlo cada mañana no sirve de nada. El caso
 * que lo destapó: el correo llevaba meses reclamando el informe del "23041703",
 * un lote de abril de 2023.
 */
const DIAS_LOTE_VIEJO = 30;

/** Todos los códigos de 8 cifras que lleva dentro el texto del lote. */
const codigosDe = (texto) => String(texto ?? "").match(/\d{8}/g) ?? [];

/** La fecha que lleva dentro el código de lote ("26090502" → 2026-09-05). */
function fechaDelLote(codigo) {
  if (!/^\d{8}$/.test(codigo)) return null;
  const iso = `20${codigo.slice(0, 2)}-${codigo.slice(2, 4)}-${codigo.slice(4, 6)}`;
  return Number.isNaN(Date.parse(`${iso}T12:00:00`)) ? null : iso;
}

/**
 * Qué lotes se confeccionaron ese día y cuáles trajeron su informe del calibrador.
 *
 * Se saca de aquí (y no del correo, donde vivía suelto para "ayer") para poder
 * preguntarlo por cualquier día de la ventana y para que el correo y la revisión
 * no puedan discrepar: es el mismo cálculo o no es ninguno.
 *
 * TRES COSAS QUE HAY QUE PERDONAR, o la lista es puro ruido (medido el 11-09-2026
 * sobre la semana: de 7 lotes "sin informe" del 07-09, 6 eran falsos):
 *
 *   1. UN INFORME PUEDE LLEVAR DOS LOTES. Planta escribe en ese campo lo que le
 *      cabe: "26090401  -  26090501", "26082901 19 BOX+ 26083106 4 BOX". Leer
 *      solo el primer código dejaba al segundo como desaparecido para siempre.
 *   2. EL INFORME PUEDE SER DE DÍAS ANTES (fruta que durmió en cámara).
 *   3. EL PRECALIBRADO NO TIENE INFORME PROPIO. Lo que vuelve del almacén de
 *      precalibrado se dio de alta como entrada nueva, pero no pasa por el visor
 *      como un lote: pedirle informe es pedir algo que no existe.
 *
 * Lo que queda después de perdonar eso sí es un informe que falta de verdad.
 */
export async function informesDelDia(supabase, fecha) {
  const { data: pal } = await supabase.from("erp_palet")
    .select("lote_confeccion").eq("fecha", fecha);
  const lotesDia = [...new Set((pal ?? []).map((p) => p.lote_confeccion).filter(Boolean))];

  let origenes = [];
  if (lotesDia.length) {
    const { data } = await supabase.from("erp_confeccion_origen")
      .select("lote_confeccion, lote_entrada").in("lote_confeccion", lotesDia);
    origenes = data ?? [];
  }
  const cobertura = { lotes: lotesDia.length, conOrigen: new Set(origenes.map((r) => r.lote_confeccion)).size };

  // Solo los lotes confeccionados ESE día (el código lleva la fecha dentro):
  // un palet con lote de otro día no pide informe de hoy.
  const yymmdd = fecha.slice(2, 4) + fecha.slice(5, 7) + fecha.slice(8, 10);
  const delDia = new Set(lotesDia.filter((l) => /^\d{8}$/.test(l) && l.slice(2) === yymmdd));
  const esperados = [...new Set(origenes.filter((o) => delDia.has(o.lote_confeccion)).map((o) => o.lote_entrada))];

  // Los informes del día (los que cuentan como "hoy llegó algo") y los de la
  // ventana hacia atrás (los que valen para dar un lote por medido).
  const desde = sumaDias(fecha, -DIAS_ATRAS_INFORME);
  const { data: inf } = await supabase.from("calibrador_informe")
    .select("lote, fecha").gte("fecha", desde).lte("fecha", fecha);
  const filas = inf ?? [];
  const lotes = [...new Set(filas.filter((r) => r.fecha === fecha).map((r) => codigoBaseLote(r.lote)))].sort();
  const medidos = new Set(filas.flatMap((r) => codigosDe(r.lote)));

  // El precalibrado se reconoce por el nombre del "agricultor" de su entrada.
  const precalibrado = new Set();
  if (esperados.length) {
    for (let i = 0; i < esperados.length; i += 200) {
      const { data } = await supabase.from("entradas_bascula")
        .select("lote, agricultor").in("lote", esperados.slice(i, i + 200));
      for (const e of data ?? []) if (/precalibrado/i.test(e.agricultor ?? "")) precalibrado.add(e.lote);
    }
  }

  const limiteViejo = sumaDias(fecha, -DIAS_LOTE_VIEJO);
  const perdonados = { precalibrado: 0, viejos: 0 };
  const faltan = [];
  for (const l of esperados) {
    if (medidos.has(l)) continue;
    if (precalibrado.has(l)) { perdonados.precalibrado++; continue; }
    const f = fechaDelLote(l);
    if (f && f < limiteViejo) { perdonados.viejos++; continue; }
    faltan.push(l);
  }

  return {
    n: lotes.length, lotes, recibidos: lotes.length,
    lotesConfeccion: delDia.size,
    faltan: faltan.sort(), perdonados,
    origenesDia: origenes, cobertura,
  };
}

/** Palets de kilos imposibles dentro del parte (los del GSTOCK ya subido). */
async function paletsSospechosos(supabase, partId) {
  const { data } = await supabase.from("palets_dia")
    .select("palet_id, kg_neto").eq("part_id", partId).gt("kg_neto", KG_PALET_SOSPECHOSO);
  return (data ?? []).map((p) => ({ palet: p.palet_id ?? "(sin id)", kg: num(p.kg_neto) }));
}

const COLUMNAS_PARTE = "id, date, estado, origen_calibrador, campos_estimados, revision,"
  + " kg_produccion_calibrador, kg_mujeres_calibrador, kg_palets_brutos,"
  + " kg_inventario_anterior_sin_alta, " + CINCO_DEL_PAPEL.join(", ");

/**
 * Todo lo que la revisión necesita saber de un día. Se lee de una vez para que
 * las comprobaciones y el diagnóstico sean puros y se puedan probar sin base.
 */
export async function reunirHechos(supabase, fecha, { hoy = null, informes = null } = {}) {
  const { data: fila, error } = await supabase.from("partes_diarios")
    .select(COLUMNAS_PARTE + ", resumen_ia").eq("date", fecha).maybeSingle();
  if (error) throw new Error(`parte del ${fecha}: ${error.message}`);

  const inf = informes ?? await informesDelDia(supabase, fecha);
  if (!fila) {
    // Sin parte no hay nada que cuadrar, pero sí se puede saber si hubo día.
    return { fecha, parte: null, hayActividad: inf.lotesConfeccion > 0, informes: inf,
      cuadre: null, paletsSospechosos: [], papel: null, dsj: null, siguiente: null };
  }

  const parte = { ...fila, analizado: fila.resumen_ia != null };
  delete parte.resumen_ia;   // pesa y no se usa: solo importa si existe

  const [cuadre, sosp] = await Promise.all([
    cuadrar(supabase, parte).catch(() => null),
    paletsSospechosos(supabase, parte.id),
  ]);

  // El día siguiente, solo para poder decir "esto se paletizó mañana" en vez de
  // dejar el descuadre positivo sin explicación.
  const { data: sig } = await supabase.from("partes_diarios")
    .select("date, kg_produccion_calibrador, kg_palets_brutos").eq("date", sumaDias(fecha, 1)).maybeSingle();

  return {
    fecha,
    parte,
    hayActividad: num(parte.kg_produccion_calibrador) > 0 || num(parte.kg_palets_brutos) > 0 || inf.lotesConfeccion > 0,
    informes: inf,
    cuadre,
    paletsSospechosos: sosp,
    papel: estadoDelPapel(parte, hoy),
    dsj: calcularDsj(parte),
    siguiente: sig ? { fecha: sig.date, prod: num(sig.kg_produccion_calibrador), palets: num(sig.kg_palets_brutos) } : null,
  };
}

// ─── La revisión entera ──────────────────────────────────────────────────────

/**
 * Revisa un día: comprueba, INTENTA CUADRAR lo que se pueda, vuelve a comprobar
 * y deja la marca en el parte.
 *
 * QUÉ REPARA SOLA, Y POR QUÉ SOLO ESO. Rehacer el parte (volver a montar los
 * informes y reanalizarlo) es la única reparación que arregla de verdad las dos
 * cosas que se atascan solas: un parte sin analizar y un detalle que no cuadra
 * con su cabecera. Es idempotente, respeta los cinco del papel (rehacerParte
 * avisa si se pisa alguno) y JAMÁS toca un parte Validado.
 *
 * Lo que NO se repara sola, a propósito:
 *   · las pasadas repetidas — borrar filas sin que nadie mire es justo lo que
 *     el script de limpieza evita (hay casos donde la fila del volcado lleva
 *     notas que la del parte no tiene). Se diagnostica y se da el comando.
 *   · los informes que faltan — no están, no hay nada que reparar aquí; la
 *     tarea ya reintenta los que llegaron y no subieron.
 *   · el papel — lo estima estimar-manuales-parte.mjs con sus días de gracia.
 */
export async function revisarParte(supabase, fecha, { hoy = null, aplicar = false, url = null, key = null, informes = null } = {}) {
  let hechos = await reunirHechos(supabase, fecha, { hoy, informes });
  let comprobaciones = comprobarParte(hechos);
  const reparaciones = [];

  const necesitaRehacer = comprobaciones.some((c) => (c.clave === "detalle" || c.clave === "analisis") && c.estado === "reparo");
  const puedeRehacer = aplicar && url && key && hechos.parte && hechos.parte.estado !== "Validado";
  if (necesitaRehacer && puedeRehacer) {
    try {
      const r = await rehacerParte(supabase, fecha, { url, key, aplicar: true });
      if (r.accion === "rehecho") {
        reparaciones.push(`Se rehizo el parte del ${fecha}: informes ${r.informes}, análisis ${r.analisis}.`);
        for (const p of r.pisados) reparaciones.push(`OJO: al rehacerlo cambió un dato del papel — ${p}.`);
        // Se vuelve a mirar con los datos nuevos: la marca tiene que reflejar
        // cómo quedó el parte, no cómo estaba antes de arreglarlo.
        hechos = await reunirHechos(supabase, fecha, { hoy, informes });
        comprobaciones = comprobarParte(hechos);
      } else if (r.accion === "intocable") {
        reparaciones.push(`No se rehizo el parte del ${fecha}: ${r.motivo}.`);
      }
    } catch (e) {
      reparaciones.push(`No se pudo rehacer el parte del ${fecha}: ${e.message}`);
    }
  } else if (necesitaRehacer && aplicar && hechos.parte?.estado === "Validado") {
    reparaciones.push(`El parte del ${fecha} está Validado: no se toca aunque no cuadre (lo firmó una persona).`);
  }

  const veredicto = veredictoDe(comprobaciones);
  const diagnostico = diagnosticar(hechos, comprobaciones);
  const revision = {
    revisado_at: new Date().toISOString(),
    veredicto,
    comprobaciones,
    reparaciones,
    diagnostico,
    dsj: hechos.dsj ? { kg: Math.round(hechos.dsj.kg), pct: Math.round(hechos.dsj.pct * 10) / 10 } : null,
  };

  // La marca va al parte aunque tenga reparos: "revisado y no cuadra" es
  // información, y sin ella no se puede saber si alguien lo miró.
  if (aplicar && hechos.parte) {
    const { error } = await supabase.from("partes_diarios").update({ revision }).eq("id", hechos.parte.id);
    if (error) reparaciones.push(`No se pudo guardar la marca de revisión del ${fecha}: ${error.message}`);
  }

  return { fecha, id: hechos.parte?.id ?? null, estado: hechos.parte?.estado ?? null, hechos, ...revision };
}

/**
 * La ventana entera, del día más viejo al más nuevo. Se devuelve en orden para
 * que el correo pueda hablar de "ayer" y resumir el resto.
 */
export async function revisarVentana(supabase, fechas, opciones = {}) {
  const out = [];
  // `informes` es de UN día: colarlo aquí daría a los 14 los informes del
  // mismo, y la lista de "faltan" saldría inventada. Cada día pregunta el suyo.
  const { informes: _ignorado, ...comunes } = opciones;
  for (const f of fechas) {
    try {
      out.push(await revisarParte(supabase, f, comunes));
    } catch (e) {
      out.push({ fecha: f, veredicto: "error", motivo: e.message, comprobaciones: [], reparaciones: [], diagnostico: [] });
    }
  }
  return out;
}
