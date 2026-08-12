/**
 * El texto del aviso diario. Puro: se le dan los datos ya recogidos y devuelve
 * el cuerpo y si hay algo que revisar.
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

const APP = "https://controlproduccion.vercel.app";

/** Lo que el operario copia del papel. Espejo de PART_DETAIL_MANUAL_FIELDS. */
const DEL_PAPEL = [
  "industria (citrica)",
  "reciclado de malla Z1 y Z2 (bruto + box)",
  "inventario final sin dar de alta",
  "podrido manual (bolsa de basura)",
  "podrido de bateas, si se han vaciado hoy",
];

export function componerAviso({
  fecha, entradas, palets, cobertura, correcciones, ip, log,
  receptor = null, informesCalibrador = null, calibrador = null,
  parte = null, productores = null, ipEsperada = "192.168.1.237",
  frescura = null, buzon = null, analizados = null,
}) {
  const secciones = [];
  const avisos = [];

  // ── Produccion del dia ──────────────────────────────────────────────────
  const hayActividad = entradas.n > 0 || palets.n > 0 || (calibrador?.pasadas ?? 0) > 0;
  if (!hayActividad) {
    secciones.push("Sin actividad registrada (festivo, fin de semana o linea parada).");
  } else {
    const prod = ["PRODUCCION"];
    if (calibrador?.pasadas) {
      prod.push(linea("Calibrado", `${kg(calibrador.kgTotal)} en ${calibrador.pasadas} pasadas`));
      if (calibrador.kgTotal > 0) {
        prod.push(linea("  a exportacion", `${kg(calibrador.kgExportacion)} (${pct(100 * calibrador.kgExportacion / calibrador.kgTotal)})`));
        prod.push(linea("  a industria", kg(calibrador.kgIndustria)));
        prod.push(linea("  a mujeres", kg(calibrador.kgMujeres)));
      }
    }
    prod.push(linea("Palets confeccionados", `${palets.n} · ${kg(palets.kg)}`));
    if (entradas.n > 0) {
      prod.push(linea("Entradas de fruta", `${entradas.n} · ${kg(entradas.kg)}` +
        (entradas.precalibrado > 0 ? ` (${entradas.precalibrado} de precalibrado)` : "")));
    } else {
      // Decirlo con palabras: en agosto es lo normal (se vacia camara), pero un
      // hueco silencioso se confunde con "no se ha sincronizado".
      prod.push(linea("Entradas de fruta", "ninguna: se calibro de camara"));
    }
    secciones.push(prod.join("\n"));

    // ── Dinero ────────────────────────────────────────────────────────────
    const dinero = ["VENTAS"];
    dinero.push(linea("Facturado de esos palets", palets.euros > 0 ? `${miles(palets.euros)} EUR` : "todavia sin facturar"));
    // Solo sobre los kilos que llevan importe: si aun falta facturar parte del
    // dia, dividir entre el total daria un precio barato que no es real.
    const kgConPrecio = palets.kgFacturados ?? palets.kg;
    if (palets.euros > 0 && kgConPrecio > 0) {
      dinero.push(linea("  precio medio", `${(palets.euros / kgConPrecio).toFixed(3)} EUR/kg`));
      if (kgConPrecio < palets.kg) {
        dinero.push(linea("  sobre", `${kg(kgConPrecio)} de ${kg(palets.kg)} ya facturados`));
      }
    }
    if (palets.clientes?.length) {
      dinero.push(linea("Principales clientes", palets.clientes.slice(0, 3)
        .map((c) => `${c.cliente} ${kg(c.kg)}`).join(" · ")));
    }
    secciones.push(dinero.join("\n"));
  }

  // ── Productores del dia ─────────────────────────────────────────────────
  if (productores?.length) {
    const filas = productores.slice(0, 5).map((p) =>
      lineaLarga(p.productor, `${kg(p.kg)} · ${pct(p.pctExportacion)} a exportacion`));
    const resto = productores.length - 5;
    if (resto > 0) filas.push(`  (y ${resto} productor(es) mas)`);
    secciones.push(["PRODUCTORES CALIBRADOS", ...filas].join("\n"));
  }

  // ── El parte ────────────────────────────────────────────────────────────
  if (parte) {
    const p = ["PARTE DIARIO"];
    const enBorrador = ["creado", "actualizado", "sin-cambios"].includes(parte.accion);

    if (parte.accion === "creado" || parte.accion === "actualizado") {
      p.push(linea("Estado", "creado en borrador con los automaticos puestos"));
    } else if (parte.accion === "sin-cambios") {
      p.push(linea("Estado", "ya estaba en borrador con los automaticos puestos"));
    } else if (parte.accion === "respetado") {
      p.push(linea("Estado", `ya existia (${parte.motivo})`));
    } else if (parte.accion === "sin-datos") {
      p.push(linea("Estado", "no se creo: sin datos del calibrador ese dia"));
    } else {
      p.push(linea("Estado", parte.accion));
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
      }
      p.push(linea(`  ${etiqueta}`, texto));
    }

    // El DSJ provisional: los manuales que faltan solo pueden bajarlo, asi que
    // un numero ya alto aqui es un dia para mirar de verdad.
    if (parte.dsj) {
      const semaforo = Math.abs(parte.dsj.pct) <= 3 ? "" : Math.abs(parte.dsj.pct) <= 5 ? " (algo alto)" : " (ALTO)";
      p.push(linea("  Descuadre provisional", `${kg(parte.dsj.kg)} · ${pct(parte.dsj.pct)}${semaforo}`));
      p.push("  Provisional porque le faltan los manuales, que solo lo bajan.");
    }

    if (enBorrador) {
      p.push("");
      const faltaGstock = !(parte.automaticos?.kg_palets_brutos > 0);
      p.push(faltaGstock
        ? "  Falta el GSTOCK del dia (reenvialo al buzon o subelo), y copiar del papel:"
        : "  Solo falta copiar del papel:");
      for (const c of DEL_PAPEL) p.push(`    - ${c}`);
      if (parte.id) p.push(`  ${APP}/partes/${parte.id}`);
    }
    if (parte.recuperados?.length) {
      p.push(`  Ademas se han recuperado partes de dias sueltos: ${parte.recuperados.join(", ")}.`);
    }
    // Partes que tenian sus informes subidos y nadie habia analizado.
    for (const a of analizados ?? []) {
      p.push(`  Analizado solo el parte del ${a.fecha} (${a.archivos} informes que estaban sin extraer` +
        `${a.reabierto ? ", sigue en borrador para los manuales" : ""}).`);
    }
    secciones.push(p.join("\n"));
  }

  // ── Trazabilidad ────────────────────────────────────────────────────────
  if (cobertura?.lotes > 0) {
    // La cobertura parcial es lo normal y NO es una averia: se ha comprobado
    // que no depende de que este facturado ni del dia. Por eso se explica en
    // una linea en vez de dejar un "0%" mudo que se lee como un fallo.
    const t = ["TRAZABILIDAD",
      linea("Lotes de confeccion", `${cobertura.lotes}`),
      linea("  con origen conocido", `${cobertura.conOrigen} (${pct(100 * cobertura.conOrigen / cobertura.lotes)})`),
    ];
    if (cobertura.conOrigen < cobertura.lotes) {
      t.push("  Del resto el ERP no encadena el palet con su entrada, asi que");
      t.push("  no se les puede poner productor. Es lo habitual, no un fallo.");
    }
    secciones.push(t.join("\n"));
  }

  // ── Lo que llegó por correo ─────────────────────────────────────────────
  if (buzon) {
    const b = ["BUZON DE CORREO"];
    if (buzon.importados.length) {
      b.push(linea("Importados solos", `${buzon.importados.length}`));
      for (const x of buzon.importados) b.push(`    ${x.etiqueta}: ${x.detalle ?? x.fichero}`);
    }
    if (buzon.esperando.length) {
      b.push(linea("Esperando en /importar", `${buzon.esperando.length}`));
      for (const x of buzon.esperando) b.push(`    ${x.etiqueta} — ${x.fichero}`);
    }
    if (buzon.noReconocidos.length) {
      b.push(linea("Sin reconocer", `${buzon.noReconocidos.length}`));
      for (const x of buzon.noReconocidos) b.push(`    ${x.fichero}`);
    }
    secciones.push(b.join("\n"));
  }

  // ── Incidencias ─────────────────────────────────────────────────────────
  if (receptor === false) {
    avisos.push("El receptor de informes del calibrador NO esta escuchando: los informes que" +
      ' mande el Sizer se perderan. Deberia levantarlo la tarea "Lasarte - Receptor calibrador".');
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
    ...secciones,
    // Un aviso que ya viene indentado es el detalle del de arriba: se sangra,
    // no se le pone otro guion (quedaba "-   Registro de camaras...").
    avisos.length
      ? ["REVISAR", ...avisos.map((a) => (a.startsWith("  ") ? `   ${a.trimStart()}` : `  - ${a}`))].join("\n")
      : "Sin incidencias.",
    ["--",
      "Aviso automatico de las 06:30. Si algun dia NO lo recibes, es que la tarea",
      "no se ejecuto: portatil apagado, suspendido o sin red.",
    ].join("\n"),
  ].join("\n\n");

  return { cuerpo, hayProblema: avisos.length > 0 };
}
