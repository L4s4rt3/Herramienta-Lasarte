/**
 * El texto del aviso diario. Puro: se le dan los datos ya recogidos y devuelve
 * el cuerpo, el modelo estructurado (del que lib-aviso-html.mjs pinta el correo
 * HTML) y si hay algo que revisar.
 *
 * Aparte del script que lo envia para poder probarlo sin tocar ni el ERP ni
 * Supabase — el aviso de "la IP ha cambiado" o el de "no llego ningun informe"
 * saltan una vez cada mucho tiempo y tienen que funcionar justo ese dia.
 */

const dd = (n) => String(n).padStart(2, "0");
export const comoFecha = (d) => `${d.getFullYear()}-${dd(d.getMonth() + 1)}-${dd(d.getDate())}`;
const miles = (n) => Math.round(n).toLocaleString("es-ES");
const kg = (n) => `${miles(n)} kg`;
const pct = (n) => `${(Math.round(n * 10) / 10).toLocaleString("es-ES")}%`;

/** Una linea de "clave: valor" alineada, para que el correo se lea en columna. */
const linea = (etiqueta, valor) => `  ${etiqueta.padEnd(26, ".")} ${valor}`;

/**
 * Igual pero sin recortar la etiqueta. Los productores se llaman cosas como
 * "LASARTE EXPORT S.L. Invermarmelo-FRUBEZAR" (55 caracteres el mas largo) y
 * cortarlos a la anchura de la columna se lleva justo la parte que distingue a
 * uno de otro. Si no cabe, el valor se va a la linea de abajo.
 */
const lineaLarga = (etiqueta, valor, ancho = 42) =>
  (etiqueta.length <= ancho
    ? `  ${etiqueta.padEnd(ancho, ".")} ${valor}`
    : `  ${etiqueta}\n  ${"".padEnd(ancho, " ")} ${valor}`);

export const APP = "https://controlproduccion.vercel.app";

const DIAS = ["domingo", "lunes", "martes", "miercoles", "jueves", "viernes", "sabado"];
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

/** "martes 11 de agosto" — que se lea como una fecha, no como un código. */
function fechaLarga(iso) {
  const d = new Date(`${iso}T12:00:00`);
  return `${DIAS[d.getDay()]} ${d.getDate()} de ${MESES[d.getMonth()]}`;
}

/** "+4%" / "−12%". El signo importa más que el decimal. */
const variacion = (valor, referencia) => {
  if (!(referencia > 0)) return null;
  const p = ((valor - referencia) / referencia) * 100;
  return { pct: p, texto: `${p >= 0 ? "+" : "−"}${Math.abs(Math.round(p))}%` };
};

/**
 * Comparación contra la media, con su flecha.
 *
 * Un porcentaje se compara en PUNTOS, no en tanto por ciento: decir que el 53,2%
 * está "un 12% por debajo" del 60,4% es correcto pero se lee fatal — lo que se
 * entiende es "7 puntos por debajo".
 */
function contra(valor, media, { unidad = "kg", nombre = "la media" } = {}) {
  if (!(media > 0)) return "";
  if (unidad === "%") {
    const d = valor - media;
    const flecha = Math.abs(d) < 2 ? "=" : d > 0 ? "▲" : "▼";
    const p = Math.abs(Math.round(d * 10) / 10).toLocaleString("es-ES");
    return `${flecha} ${d >= 0 ? "+" : "−"}${p} pt sobre ${nombre} (${pct(media)})`;
  }
  const v = variacion(valor, media);
  const flecha = Math.abs(v.pct) < 3 ? "=" : v.pct > 0 ? "▲" : "▼";
  return `${flecha} ${v.texto} sobre ${nombre} (${kg(media)})`;
}

/** Una barra proporcional al máximo, para ver la forma de la semana de un vistazo. */
const barra = (valor, maximo, ancho = 14) => {
  const n = maximo > 0 ? Math.max(1, Math.round((valor / maximo) * ancho)) : 0;
  return "█".repeat(n) + "·".repeat(Math.max(0, ancho - n));
};

/** Lo que el operario copia del papel. Espejo de PART_DETAIL_MANUAL_FIELDS. */
const DEL_PAPEL = [
  "industria (citrica)",
  "reciclado de malla Z1 y Z2 (bruto + box)",
  "inventario final sin dar de alta",
  "podrido manual (bolsa de basura)",
  "podrido de bateas, si se han vaciado hoy",
];

/**
 * Una sección del aviso que se escribe UNA VEZ y sale por dos sitios: el texto
 * plano (idéntico al de siempre, protegido por probar-aviso-diario.mjs) y el
 * modelo estructurado del que lib-aviso-html.mjs pinta el correo HTML. Una sola
 * fuente de decisiones: lo que no se apunta aquí no existe en ninguno de los dos.
 */
function nuevaSeccion(id, titulo = null) {
  const lineas = [];
  const items = [];
  return {
    id,
    titulo,
    items,
    datos: null,
    /** "clave: valor" alineado (linea de siempre). La sangría de la etiqueta marca sub-fila. */
    par(etiqueta, valor) {
      lineas.push(linea(etiqueta, valor));
      items.push({ tipo: "par", etiqueta: etiqueta.trimStart(), valor, sangria: etiqueta.startsWith(" ") });
    },
    /** Como par, pero sin recortar la etiqueta (productores con nombre kilométrico). */
    parLargo(etiqueta, valor) {
      lineas.push(lineaLarga(etiqueta, valor));
      items.push({ tipo: "par", etiqueta, valor, sangria: false });
    },
    /** Una línea libre tal cual (explicaciones, listas, enlaces, líneas en blanco). */
    texto(t) {
      lineas.push(t);
      items.push({ tipo: "texto", texto: t.trim() });
    },
    textoPlano() {
      return [...(titulo ? [titulo] : []), ...lineas].join("\n");
    },
  };
}

/**
 * Informes que el Sizer entregó y que NO acabaron en la Herramienta.
 *
 * POR QUÉ EXISTE (13-08-2026). El receptor guarda el .docx en disco ANTES de
 * intentar subirlo, a proposito: si la subida falla, el dato no se pierde. Pero
 * ese fallo solo se apuntaba en `registro.jsonl`, que no lee nadie. El receptor
 * llevaba desde el dia anterior con el codigo viejo en memoria —un proceso Node
 * no se entera de que has editado sus ficheros— y estuvo diez horas recibiendo
 * informes y descartandolos en silencio. Trece informes en disco, cero en la
 * base, y ni un aviso.
 *
 * SE LIMPIA SOLO. No mira si la subida fallo en su dia, sino si la pasada esta
 * AHORA en la base: en cuanto se reintenta con subir-informes-calibrador.mjs,
 * deja de avisar sin que nadie tenga que marcar nada. Estado derivado, no
 * guardado — por eso tampoco hace falta ventana de dias.
 *
 * @param entradas      del registro: { recibido, lote, comienzo, motivo }
 * @param clavesEnBase  Set de `lote|comienzo` que SI estan en calibrador_informe
 * @param lotesEnBase   Set de lotes, para las anotaciones viejas sin comienzo
 */
export function informesSinSubir(entradas, clavesEnBase, lotesEnBase = new Set()) {
  const vistos = new Set();
  const pendientes = [];
  for (const e of entradas ?? []) {
    if (!e?.lote) continue;
    // Sin comienzo (anotaciones anteriores a que el receptor lo guardara) solo
    // se puede comparar por lote. Se prefiere callar de mas a chillar de mas:
    // un aviso que no se puede resolver acaba ignorandose, y con el los demas.
    const dentro = e.comienzo
      ? clavesEnBase.has(`${e.lote}|${e.comienzo}`)
      : lotesEnBase.has(e.lote);
    if (dentro) continue;
    const clave = `${e.lote}|${e.comienzo ?? ""}`;
    if (vistos.has(clave)) continue;   // el mismo informe reenviado tres veces
    vistos.add(clave);
    pendientes.push({
      lote: e.lote,
      comienzo: e.comienzo ?? null,
      motivo: e.motivo ?? "sin motivo anotado",
      recibido: e.recibido ?? null,
    });
  }
  return pendientes;
}

/**
 * La serie de dias de "COMO VIENE LA SEMANA", con el PARTE como respaldo.
 *
 * POR QUE. La serie sale de las pasadas del calibrador, y el volcado puede no
 * llegar: del 12 al 14-08-2026 el parte se creo solo con los informes DOCX y
 * esos tres dias DESAPARECIERON del correo. El del 17-08 hablaba de "547.707 kg
 * en 7 dias" acabados el martes 11 mientras el almacen habia trabajado tres
 * dias mas — y el parte si tenia los kilos. Un correo que se deja fuera lo
 * ultimo que paso no sirve para saber como va la semana, que es para lo que
 * esta la grafica.
 *
 * MANDA LA PASADA cuando existe: trae el dia partido pasada por pasada y el
 * respaldo solo trae el dia entero. Los dias del respaldo van marcados
 * (`origen: "informes"`) para poder distinguirlos, y los de kg 0 no entran: un
 * dia a cero no es un dia flojo, es un dia sin datos.
 */
export function mezclarSerie(dePasadas = [], deLosPartes = []) {
  const porDia = new Map();
  for (const d of deLosPartes) if (d.kg > 0) porDia.set(d.fecha, { ...d, origen: "informes" });
  for (const d of dePasadas) if (d.kg > 0) porDia.set(d.fecha, { ...d, origen: "pasadas" });
  return [...porDia.values()]
    .map((d) => ({ ...d, pctExp: d.kg > 0 ? (d.exportacion / d.kg) * 100 : 0 }))
    .sort((a, b) => a.fecha.localeCompare(b.fecha));
}

export function componerAviso({
  fecha, entradas, palets, cobertura, correcciones, ip, log,
  receptor = null, informesCalibrador = null, calibrador = null,
  sinSubir = null,
  parte = null, productores = null, ipEsperada = "192.168.1.237",
  frescura = null, buzon = null, analizados = null, alta = null, contexto = null,
}) {
  const secciones = [];
  const avisos = [];

  // ── El titular: el dia en dos frases ────────────────────────────────────
  // Un correo que empieza con una tabla obliga a interpretarlo entero. Esto
  // dice de entrada si el dia fue normal o no, y por que.
  const hayActividad = entradas.n > 0 || palets.n > 0 || (calibrador?.pasadas ?? 0) > 0;
  const titular = [];
  if (hayActividad && calibrador?.kgTotal > 0) {
    const m = contexto?.media;
    const vKg = m ? variacion(calibrador.kgTotal, m.kg) : null;
    const pctExp = 100 * calibrador.kgExportacion / calibrador.kgTotal;
    const vExp = m ? pctExp - m.pctExp : null;

    let f1 = `Se calibraron ${kg(calibrador.kgTotal)} en ${calibrador.pasadas} pasada${calibrador.pasadas === 1 ? "" : "s"}`;
    if (vKg) {
      f1 += Math.abs(vKg.pct) < 5
        ? ", en linea con la media de los ultimos dias."
        : `, un ${Math.abs(Math.round(vKg.pct))}% ${vKg.pct > 0 ? "por encima" : "por debajo"} de la media de los ultimos ${m.dias} dias.`;
    } else f1 += ".";
    titular.push(f1);

    let f2 = `El ${pct(pctExp)} fue a exportacion`;
    if (vExp != null) {
      const p = Math.abs(Math.round(vExp));
      f2 += Math.abs(vExp) < 2
        ? ", lo normal."
        : `, ${p} punto${p === 1 ? "" : "s"} ${vExp > 0 ? "por encima" : "por debajo"} de lo habitual (${pct(m.pctExp)}).`;
    } else f2 += ".";
    // Lo peor/mejor de la serie merece decirse: es lo que se recuerda.
    const serie = contexto?.serie ?? [];
    if (serie.length >= 4) {
      const peor = serie.every((d) => d.fecha === fecha || pctExp <= d.pctExp);
      const mejor = serie.every((d) => d.fecha === fecha || pctExp >= d.pctExp);
      if (peor) f2 += " Es el aprovechamiento mas bajo de la serie.";
      else if (mejor) f2 += " Es el mejor aprovechamiento de la serie.";
    }
    titular.push(f2);
  }
  if (titular.length) {
    const s = nuevaSeccion("titular");
    for (const t of titular) s.texto(`  ${t}`);
    secciones.push(s);
  }

  // ── Produccion del dia ──────────────────────────────────────────────────
  if (!hayActividad) {
    const s = nuevaSeccion("sin-actividad");
    s.texto("Sin actividad registrada (festivo, fin de semana o linea parada).");
    secciones.push(s);
  } else {
    const prod = nuevaSeccion("produccion", "PRODUCCION");
    if (calibrador?.pasadas) {
      const m = contexto?.media;
      prod.par("Calibrado", `${kg(calibrador.kgTotal)} en ${calibrador.pasadas} pasadas` +
        (m ? `   ${contra(calibrador.kgTotal, m.kg)}` : ""));
      if (calibrador.kgTotal > 0) {
        const p = (n) => pct(100 * n / calibrador.kgTotal);
        prod.par("  a exportacion", `${kg(calibrador.kgExportacion)}  ${p(calibrador.kgExportacion)}` +
          (m ? `   ${contra(100 * calibrador.kgExportacion / calibrador.kgTotal, m.pctExp, { unidad: "%" })}` : ""));
        prod.par("  a industria", `${kg(calibrador.kgIndustria)}  ${p(calibrador.kgIndustria)}`);
        prod.par("  a mujeres", `${kg(calibrador.kgMujeres)}  ${p(calibrador.kgMujeres)}` +
          (m ? `   ${contra(calibrador.kgMujeres, m.mujeres)}` : ""));
      }
    }
    prod.par("Palets confeccionados", `${palets.n} · ${kg(palets.kg)}`);
    if (entradas.n > 0) {
      prod.par("Entradas de fruta", `${entradas.n} · ${kg(entradas.kg)}` +
        (entradas.precalibrado > 0 ? ` (${entradas.precalibrado} de precalibrado)` : ""));
    } else {
      // Decirlo con palabras: en agosto es lo normal (se vacia camara), pero un
      // hueco silencioso se confunde con "no se ha sincronizado".
      prod.par("Entradas de fruta", "ninguna: se calibro de camara");
    }
    secciones.push(prod);

    // ── Dinero ────────────────────────────────────────────────────────────
    const dinero = nuevaSeccion("ventas", "VENTAS");
    dinero.par("Facturado de esos palets", palets.euros > 0 ? `${miles(palets.euros)} EUR` : "todavia sin facturar");
    // Solo sobre los kilos que llevan importe: si aun falta facturar parte del
    // dia, dividir entre el total daria un precio barato que no es real.
    const kgConPrecio = palets.kgFacturados ?? palets.kg;
    if (palets.euros > 0 && kgConPrecio > 0) {
      // Con coma decimal: "1.130 EUR/kg" se lee como mil ciento treinta.
      const precio = (palets.euros / kgConPrecio).toLocaleString("es-ES", {
        minimumFractionDigits: 2, maximumFractionDigits: 2,
      });
      dinero.par("  precio medio", `${precio} EUR/kg`);
      if (kgConPrecio < palets.kg) {
        dinero.par("  sobre", `${kg(kgConPrecio)} de ${kg(palets.kg)} ya facturados`);
      }
    }
    if (palets.clientes?.length) {
      dinero.par("Principales clientes", palets.clientes.slice(0, 3)
        .map((c) => `${c.cliente} ${kg(c.kg)}`).join(" · "));
    }
    secciones.push(dinero);
  }

  // ── Como viene la semana ────────────────────────────────────────────────
  // La forma de la serie dice cosas que ningun numero suelto puede: si el dia
  // flojo es un bache o una tendencia.
  if (contexto?.serie?.length >= 3) {
    const s = contexto.serie;
    const maximo = Math.max(...s.map((d) => d.kg));
    const sem = nuevaSeccion("semana", "COMO VIENE LA SEMANA");
    for (const d of s) {
      const marca = d.fecha === fecha ? "→" : " ";
      const dia = fechaLarga(d.fecha).split(" ").slice(0, 2).join(" ").padEnd(12);
      sem.texto(`  ${marca} ${dia} ${barra(d.kg, maximo)} ${kg(d.kg).padStart(10)}` +
        `  ${pct(d.pctExp).padStart(6)} export.`);
    }
    const total = s.reduce((a, d) => a + d.kg, 0);
    const totalExp = s.reduce((a, d) => a + d.exportacion, 0);
    sem.texto("");
    sem.par(`  Total ${s.length} dias`, `${kg(total)} · ${pct(100 * totalExp / total)} a exportacion`);
    // Para el HTML: barras de verdad en vez de caracteres █.
    sem.datos = { serie: s, maximo, fecha, totalKg: total, totalPctExp: total > 0 ? 100 * totalExp / total : 0 };
    secciones.push(sem);
  }

  // ── Productores del dia ─────────────────────────────────────────────────
  if (productores?.length) {
    // Con la media del dia al lado se ve de un golpe quien tira del % hacia
    // arriba y quien lo hunde, que es para lo que sirve esta lista.
    const mediaDia = calibrador?.kgTotal > 0
      ? 100 * calibrador.kgExportacion / calibrador.kgTotal : null;
    const qs = nuevaSeccion("productores", "QUIEN ENTRO EN LINEA");
    for (const p of productores.slice(0, 6)) {
      let marca = "";
      if (mediaDia != null && p.kg > 1000) {
        const d = p.pctExportacion - mediaDia;
        marca = Math.abs(d) < 3 ? "" : d > 0 ? "  ▲ tira del dia" : "  ▼ lastra el dia";
      }
      qs.parLargo(p.productor, `${kg(p.kg)} · ${pct(p.pctExportacion)} export.${marca}`);
    }
    const resto = productores.length - 6;
    if (resto > 0) qs.texto(`  (y ${resto} productor(es) mas)`);
    secciones.push(qs);
  }

  // ── El parte ────────────────────────────────────────────────────────────
  if (parte) {
    const p = nuevaSeccion("parte", "PARTE DIARIO");
    const enBorrador = ["creado", "actualizado", "sin-cambios"].includes(parte.accion);

    if (parte.accion === "creado" || parte.accion === "actualizado") {
      p.par("Estado", "creado en borrador con los automaticos puestos");
    } else if (parte.accion === "sin-cambios") {
      p.par("Estado", "ya estaba en borrador con los automaticos puestos");
    } else if (parte.accion === "respetado") {
      p.par("Estado", `ya existia (${parte.motivo})`);
    } else if (parte.accion === "sin-datos") {
      p.par("Estado", "no se creo: ese dia el calibrador no dejo ni volcado ni informes");
    } else {
      p.par("Estado", parte.accion);
    }

    // Los automaticos con su cifra: se contrastan con el papel sin abrir nada.
    for (const [campo, etiqueta] of [
      ["kg_produccion_calibrador", "Produccion calibrador"],
      ["kg_mujeres_calibrador", "Mujeres"],
      ["kg_palets_brutos", "Palets confeccionados"],
      ["kg_inventario_anterior_sin_alta", "Inventario del dia antes"],
    ]) {
      const v = parte.automaticos?.[campo];
      if (v == null) continue;
      // Un 0 aqui no es "cero kilos", es "todavia no se sabe": decirlo con
      // palabras, que es lo unico que distingue un dia flojo de un dato que falta.
      let texto = kg(v);
      if (campo === "kg_inventario_anterior_sin_alta" && parte.anteriorPendiente) {
        texto = "a falta de cerrar el dia anterior";
      } else if (campo === "kg_palets_brutos" && !(v > 0)) {
        texto = "falta subir el GSTOCK del dia";
      } else if (parte.origen === "docx"
        && (campo === "kg_produccion_calibrador" || campo === "kg_mujeres_calibrador")) {
        // Sin volcado del Sizer, el numero sale de los informes de lote y puede
        // quedarse corto (de un lote con varias pasadas el DOCX solo ve la
        // ultima). Decirlo aqui es lo que evita que alguien lo de por cerrado.
        texto = `${texto} (provisional)`;
      }
      p.par(`  ${etiqueta}`, texto);
    }

    if (parte.origen === "docx") {
      p.texto(`  Los kilos del calibrador salen de ${parte.lotes} informes de lote,`);
      p.texto("  no del volcado del Sizer, que ese dia no llego. Se corrigen solos");
      p.texto("  cuando se exporte el volcado desde el visor.");
    }

    // El DSJ provisional: los manuales que faltan solo pueden bajarlo, asi que
    // un numero ya alto aqui es un dia para mirar de verdad.
    if (parte.dsj) {
      const semaforo = Math.abs(parte.dsj.pct) <= 3 ? "" : Math.abs(parte.dsj.pct) <= 5 ? " (algo alto)" : " (ALTO)";
      p.par("  Descuadre provisional", `${kg(parte.dsj.kg)} · ${pct(parte.dsj.pct)}${semaforo}`);
      p.texto("  Provisional porque le faltan los manuales, que solo lo bajan.");
      // Sin volcado, la produccion puede estar corta (faltan pasadas que no
      // mandaron informe), y eso hincha el descuadre — hasta darlo la vuelta.
      // Sin esta linea, un −21% se lee como fruta perdida en vez de como lo que
      // suele ser: informes que no han llegado.
      if (parte.origen === "docx") {
        p.texto("  Y porque la produccion sale de los informes de lote: si falta");
        p.texto("  alguno, el descuadre sale mas grande de lo que es (o negativo).");
      }
    }

    if (enBorrador) {
      p.texto("");
      const faltaGstock = !(parte.automaticos?.kg_palets_brutos > 0);
      p.texto(faltaGstock
        ? "  Falta el GSTOCK del dia (reenvialo al buzon o subelo), y copiar del papel:"
        : "  Solo falta copiar del papel:");
      for (const c of DEL_PAPEL) p.texto(`    - ${c}`);
      if (parte.id) p.texto(`  ${APP}/partes/${parte.id}`);
    }
    if (parte.recuperados?.length) {
      p.texto(`  Ademas se han recuperado partes de dias sueltos: ${parte.recuperados.join(", ")}.`);
    }
    if (parte.gstockRecuperados?.length) {
      p.texto(`  Y se les ha subido el GSTOCK que les faltaba: ${parte.gstockRecuperados.join(", ")}.`);
    }
    // Palets que se dieron de alta despues de generar el Excel. Se dice el dia y
    // los kilos: es la unica forma de que alguien note que un parte que ya habia
    // mirado ha cambiado de numero.
    for (const r of parte.gstockRehechos ?? []) {
      p.texto(`  El parte del ${r.fecha} se ha rehecho: el ERP tenia ${kg(r.faltaban)}`);
      p.texto("  de palets que no estaban cuando se genero su Excel.");
    }
    // Partes que tenian sus informes subidos y nadie habia analizado.
    for (const a of analizados ?? []) {
      p.texto(`  Analizado solo el parte del ${a.fecha} (${a.archivos} informes que estaban sin extraer` +
        `${a.reabierto ? ", sigue en borrador para los manuales" : ""}).`);
    }
    secciones.push(p);
  }

  // ── Trazabilidad ────────────────────────────────────────────────────────
  if (cobertura?.lotes > 0) {
    // La cobertura parcial es lo normal y NO es una averia: se ha comprobado
    // que no depende de que este facturado ni del dia. Por eso se explica en
    // una linea en vez de dejar un "0%" mudo que se lee como un fallo.
    const t = nuevaSeccion("trazabilidad", "TRAZABILIDAD");
    t.par("Lotes de confeccion", `${cobertura.lotes}`);
    t.par("  con origen conocido", `${cobertura.conOrigen} (${pct(100 * cobertura.conOrigen / cobertura.lotes)})`);
    if (cobertura.conOrigen < cobertura.lotes) {
      t.texto("  Del resto el ERP no encadena el palet con su entrada, asi que");
      t.texto("  no se les puede poner productor. Es lo habitual, no un fallo.");
    }
    secciones.push(t);
  }

  // ── El alta de palets, deducida de las fotos del ERP ────────────────────
  // Todavia NO se escribe en el parte: se enseña al lado del que se apunta a
  // mano para poder compararlos unos dias. Hasta que coincidan, manda el suyo.
  if (alta) {
    const a = nuevaSeccion("alta", "ALTA DE PALETS (en pruebas, no se usa todavia)");
    if (alta.cierre?.hora) {
      a.par("Terminaron de dar de alta", `${alta.cierre.hora}` +
        (alta.cierre.estado === "quiza-abierto" ? " (o mas tarde: seguia subiendo)" : ""));
    } else {
      a.par("Hora de cierre", `no se pudo deducir (${alta.cierre?.estado ?? "sin fotos"})`);
    }
    if (alta.inventario?.estado === "calculado") {
      a.par("Quedo sin dar de alta", `${kg(alta.inventario.kg)} (medido a las ${alta.inventario.horaMedida})`);
      if (alta.inventario.anulaciones > 0) {
        a.par("  y se anularon", kg(alta.inventario.anulaciones));
      }
      a.texto("  Comparalo con lo que hayan pesado ellas: si cuadra unos dias,");
      a.texto("  se deja de contar a mano.");
    } else {
      a.par("Sin dar de alta", `todavia no se puede calcular (${alta.inventario?.estado ?? "sin datos"})`);
    }
    a.par("Fotos", `${alta.fotosDelDia ?? alta.fotos} del dia` +
      (alta.fotos > (alta.fotosDelDia ?? alta.fotos) ? ` + ${alta.fotos - alta.fotosDelDia} del dia siguiente` : ""));
    secciones.push(a);
  }

  // ── Lo que llegó por correo ─────────────────────────────────────────────
  if (buzon) {
    const b = nuevaSeccion("buzon", "BUZON DE CORREO");
    if (buzon.importados.length) {
      b.par("Importados solos", `${buzon.importados.length}`);
      for (const x of buzon.importados) b.texto(`    ${x.etiqueta}: ${x.detalle ?? x.fichero}`);
    }
    if (buzon.esperando.length) {
      b.par("Esperando en /importar", `${buzon.esperando.length}`);
      for (const x of buzon.esperando) b.texto(`    ${x.etiqueta} — ${x.fichero}`);
    }
    if (buzon.noReconocidos.length) {
      b.par("Sin reconocer", `${buzon.noReconocidos.length}`);
      for (const x of buzon.noReconocidos) b.texto(`    ${x.fichero}`);
    }
    secciones.push(b);
  }

  // ── Incidencias ─────────────────────────────────────────────────────────
  if (receptor === false) {
    avisos.push("El receptor de informes del calibrador NO esta escuchando: los informes que" +
      ' mande el Sizer se perderan. Deberia levantarlo la tarea "Lasarte - Receptor calibrador".');
  }
  // Recibido no es lo mismo que guardado: el .docx puede estar en disco y no
  // haber entrado en la base. Se nombran los lotes para poder buscarlos.
  if (sinSubir?.length) {
    const n = sinSubir.length;
    avisos.push(`${n} informe(s) del calibrador llegaron al receptor pero NO estan en la` +
      " Herramienta. El .docx esta a salvo en outputs/calibrador: se recuperan con" +
      " node scripts/subir-informes-calibrador.mjs --aplicar");
    for (const p of sinSubir.slice(0, 6)) {
      avisos.push(`  lote ${p.lote}${p.comienzo ? ` (${p.comienzo})` : ""}: ${p.motivo}`);
    }
    if (n > 6) avisos.push(`  y ${n - 6} mas.`);
  }
  if (parte?.accion === "error") {
    avisos.push(`No se pudo dejar listo el parte de ayer: ${parte.motivo}. Habra que crearlo a mano.`);
  }
  if (parte?.erpCaido) {
    avisos.push(`No se pudo leer el ERP (${parte.erpCaido}), asi que el parte se ha quedado` +
      " sin los kilos de palets y sin descuadre. Hay que subir el Excel del GSTOCK a mano," +
      " o volver a lanzar la tarea cuando haya red de oficina.");
  }
  if (ip == null) avisos.push("No se pudo leer la IP de este equipo.");
  else if (ip !== ipEsperada) {
    avisos.push(`La IP de este equipo es ${ip} y se esperaba ${ipEsperada}. El Sizer sigue enviando` +
      " a la vieja, asi que los informes del calibrador NO estan llegando.");
  }
  if (correcciones == null) avisos.push("No se pudo comprobar si hay correcciones pendientes.");
  else if (correcciones > 0) {
    avisos.push(`Hay ${correcciones} campos que el ERP tiene distintos de la app` +
      " (outputs/correcciones-entradas-erp-*.csv). No se han tocado: revisar a mano.");
  }
  if (informesCalibrador && informesCalibrador.lotesConfeccion > 0) {
    if (informesCalibrador.n === 0) {
      avisos.push(`Ayer se confeccionaron ${informesCalibrador.lotesConfeccion} lotes y no llego ningun` +
        ' informe DOCX del calibrador. Se recuperan con el boton "Reporte por email" del visor,' +
        " o con el export SQL, que es la via buena.");
    } else if (informesCalibrador.faltan.length > 0) {
      avisos.push(`Sin informe DOCX del calibrador: ${informesCalibrador.faltan.join(", ")}.`);
    }
  }
  if (calibrador?.desfaseExport) {
    avisos.push(`Los datos del calibrador son de hace ${calibrador.desfaseExport} dias.` +
      " Ejecutar export-sizer.ps1 en la maquina del Sizer con la linea parada.");
  }
  // Datos que se han quedado atrás. La herramienta sigue enseñando el último
  // dato como si fuera de hoy, así que un abandono no se nota solo: aquí sí.
  const atrasadas = (frescura ?? []).filter((f) => f.retraso == null || f.retraso > f.dias);
  if (atrasadas.length) {
    avisos.push("Datos que llevan tiempo sin actualizarse:");
    for (const f of atrasadas) {
      avisos.push(f.ultimo
        ? `  ${f.que}: nada desde el ${f.ultimo} (${f.retraso} dias)`
        : `  ${f.que}: no hay ningun dato todavia`);
    }
  }

  // Un archivo esperando no es una avería, pero si nadie lo abre no sirve de
  // nada haberlo recibido: sube a REVISAR para que no se quede ahí.
  if (buzon?.esperando?.length) {
    avisos.push(`Hay ${buzon.esperando.length} archivo(s) del correo esperando a que alguien` +
      " los confirme en /importar. Se reconocieron, pero piden revision humana.");
  }
  if (buzon?.noReconocidos?.length) {
    avisos.push(`Y ${buzon.noReconocidos.length} archivo(s) que el buzon no supo reconocer:` +
      ` ${buzon.noReconocidos.map((x) => x.fichero).join(", ")}.`);
  }

  const errores = (log ?? []).filter((l) => /ERROR|Error:|no se pudo/i.test(l));
  if (errores.length) avisos.push("Errores de esta noche:", ...errores.map((e) => `  ${e}`));

  const cuerpo = [
    `Produccion del ${fechaLarga(fecha)}`,
    ...secciones.map((s) => s.textoPlano()),
    // Un aviso que ya viene indentado es el detalle del de arriba: se sangra,
    // no se le pone otro guion (quedaba "-   Registro de camaras...").
    avisos.length
      ? ["REVISAR", ...avisos.map((a) => (a.startsWith("  ") ? `   ${a.trimStart()}` : `  - ${a}`))].join("\n")
      : "Sin incidencias.",
    ["--",
      "Aviso automatico de las 07:10. Si algun dia NO lo recibes, es que la tarea",
      "no se ejecuto: portatil apagado, suspendido o sin red.",
    ].join("\n"),
  ].join("\n\n");

  // El modelo estructurado del que lib-aviso-html.mjs pinta el correo HTML:
  // mismas decisiones, otra presentación (y lo urgente ARRIBA).
  const modelo = {
    fecha,
    fechaTexto: fechaLarga(fecha),
    titular,
    secciones: secciones
      .filter((s) => s.id !== "titular")
      .map(({ id, titulo, items, datos }) => ({ id, titulo, items, datos })),
    avisos,
    hayProblema: avisos.length > 0,
  };

  return { cuerpo, hayProblema: avisos.length > 0, modelo };
}
