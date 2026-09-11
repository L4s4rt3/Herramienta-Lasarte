/**
 * Comprobación de la revisión del parte (la parte pura: comprobaciones,
 * veredicto y diagnóstico).
 *
 * Lo que protege: que un día bueno NO salga marcado, que cada fallo se
 * reconozca por su nombre, y sobre todo que la VALORACIÓN diga lo correcto —
 * es la mitad del encargo y la que más fácil es dejar mintiendo, porque nadie
 * la contrasta con nada cuando llega el correo a las siete de la mañana.
 *
 *   node scripts/probar-revision-parte.mjs
 */
import {
  calcularDsj, comprobarParte, diagnosticar, estadoDelPapel, veredictoDe,
} from "./lib-revision-parte.mjs";

let fallos = 0;
const comprobar = (titulo, cond) => {
  if (!cond) fallos++;
  console.log(`${cond ? "OK   " : "FALLA"}  ${titulo}`);
};

/** Un día entero y bien: es la referencia contra la que se rompe todo lo demás. */
const PARTE_OK = {
  id: "p1", date: "2026-09-10", estado: "Analizado", origen_calibrador: "sql",
  analizado: true, campos_estimados: null,
  kg_produccion_calibrador: 30000, kg_mujeres_calibrador: 500,
  kg_palets_brutos: 28000, kg_inventario_anterior_sin_alta: 500,
  kg_industria_manual: 0, kg_reciclado_malla_z1: 200, kg_reciclado_malla_z2: 100,
  kg_inventario_sin_alta: 1200, kg_podrido_bolsa_basura: 400,
};

const HECHOS_OK = {
  fecha: "2026-09-10",
  parte: PARTE_OK,
  hayActividad: true,
  informes: { lotesConfeccion: 3, recibidos: 3, faltan: [] },
  cuadre: { prod: 30000, palets: 28000, calibres: 30000, producto: 30000, lotes: 30000, paletsDet: 28000, desvios: [], lotesRepetidas: [], lotesKgRepetido: 0 },
  paletsSospechosos: [],
  papel: estadoDelPapel(PARTE_OK, "2026-09-11"),
  dsj: calcularDsj(PARTE_OK),
  siguiente: null,
};

const revisar = (hechos) => {
  const comprobaciones = comprobarParte(hechos);
  return { comprobaciones, veredicto: veredictoDe(comprobaciones), diagnostico: diagnosticar(hechos, comprobaciones) };
};
const de = (r, clave) => r.comprobaciones.find((c) => c.clave === clave);
const texto = (r) => r.diagnostico.join(" \n ");

// ── El día bueno ────────────────────────────────────────────────────────────
const bueno = revisar(HECHOS_OK);
comprobar("un dia completo sale EN ORDEN", bueno.veredicto === "en-orden");
comprobar("y sin ningun reparo", bueno.comprobaciones.every((c) => c.estado !== "reparo"));
comprobar("se comprueban las 8 cosas + que el parte existe", bueno.comprobaciones.length === 9);
comprobar("un dia en orden no necesita diagnostico", bueno.diagnostico.length === 0);

// ── El descuadre, que NO es un reparo ───────────────────────────────────────
// 30.000 − 500 mujeres − 300 reciclado = 29.200 producidos; 28.000 palets
// − 500 de inventario que venía de ayer + 1.200 sin alta + 400 podrido = 29.100.
comprobar("el descuadre se calcula como cascade.ts", Math.round(calcularDsj(PARTE_OK).kg) === 100);
const descuadrado = revisar({ ...HECHOS_OK, dsj: { kg: -8000, pct: -27.3 } });
comprobar("un descuadre grande NO convierte el dia en con-reparos",
  descuadrado.veredicto === "en-orden");
comprobar("pero si se explica", /descuadre sale NEGATIVO/.test(texto(descuadrado)));
comprobar("sin kilos de palets no hay descuadre que calcular",
  calcularDsj({ ...PARTE_OK, kg_palets_brutos: 0 }) === null);

// El negativo con produccion de informes de lote: la causa probable es que
// falte produccion por contar, no que sobren palets. Es EL error de lectura
// que se quiere evitar (se lee como fruta perdida).
const negDocx = revisar({ ...HECHOS_OK, parte: { ...PARTE_OK, origen_calibrador: "docx" }, dsj: { kg: -2945, pct: -27.3 } });
comprobar("negativo con informes de lote: dice que falta produccion por contar",
  /falte produccion por contar|falte producción por contar/.test(texto(negDocx)));
const negSql = revisar({ ...HECHOS_OK, dsj: { kg: -2945, pct: -27.3 } });
comprobar("negativo con el volcado del Sizer: dice que son palets del dia anterior",
  /calibrada el día anterior|calibrada el dia anterior/.test(texto(negSql)));

// El positivo se explica con el dia siguiente si lo hay: eso es medible, no
// una excusa. Sin dia siguiente se dice la regla de la campaña.
const posConManana = revisar({ ...HECHOS_OK, dsj: { kg: 9000, pct: 30 },
  siguiente: { fecha: "2026-09-11", prod: 5000, palets: 14000 } });
// Sin punto en "5000": el español no separa los miles con cuatro cifras, y el
// resto del correo se escribe igual ("Descuadre provisional... -2945 kg").
comprobar("positivo: se contrasta con lo que se paletizo al dia siguiente",
  /el 2026-09-11 hay 14\.000 kg de palets contra 5000 kg de/.test(texto(posConManana)));
const posSinManana = revisar({ ...HECHOS_OK, dsj: { kg: 9000, pct: 30 } });
comprobar("positivo sin dia siguiente: se dice que la campaña cierra en +0,1%",
  /\+0,1%/.test(texto(posSinManana)));
comprobar("un descuadre pequeño no se comenta",
  revisar({ ...HECHOS_OK, dsj: { kg: 200, pct: 0.7 } }).diagnostico.length === 0);

// ── Informes de lote ────────────────────────────────────────────────────────
const sinInformes = revisar({ ...HECHOS_OK, informes: { lotesConfeccion: 3, recibidos: 1, faltan: ["26091001", "26091002"] } });
comprobar("faltar informes es un reparo", de(sinInformes, "informes").estado === "reparo");
comprobar("y se nombran los lotes", /26091001, 26091002/.test(de(sinInformes, "informes").detalle));
comprobar("el diagnostico dice que el Sizer los manda al cerrar el lote",
  /al CERRAR/.test(texto(sinInformes)));
comprobar("y que si se cerro de madrugada llega hoy solo",
  /llega hoy y el parte se rehace solo/.test(texto(sinInformes)));
comprobar("un dia sin confeccion no echa de menos informes",
  de(revisar({ ...HECHOS_OK, informes: { lotesConfeccion: 0, recibidos: 0, faltan: [] } }), "informes").estado === "n/a");

// ── GSTOCK ──────────────────────────────────────────────────────────────────
const sinGstock = revisar({ ...HECHOS_OK, parte: { ...PARTE_OK, kg_palets_brutos: 0 }, dsj: null });
comprobar("sin GSTOCK hay reparo", de(sinGstock, "gstock").estado === "reparo");
comprobar("y se explica que el ERP puede no haber respondido",
  /el ERP no respondió|todavía no habían terminado de dar de alta/.test(texto(sinGstock)));

// ── Analisis y cuadre del detalle ───────────────────────────────────────────
const sinAnalisis = revisar({ ...HECHOS_OK, parte: { ...PARTE_OK, analizado: false } });
comprobar("un parte sin analizar es reparo", de(sinAnalisis, "analisis").estado === "reparo");
comprobar("y el diagnostico da el comando con su fecha",
  /rehacer-parte\.mjs --fecha=2026-09-10 --aplicar/.test(texto(sinAnalisis)));

const detalleMal = revisar({ ...HECHOS_OK, cuadre: { ...HECHOS_OK.cuadre,
  desvios: ["calibres: el parte dice 30.000 kg y el detalle 26.000"] } });
comprobar("el detalle descuadrado es reparo", de(detalleMal, "detalle").estado === "reparo");
comprobar("y se dice que eso no lo provoca la fruta",
  /no lo provoca la fruta/.test(texto(detalleMal)));

// ── Pasadas repetidas: reparo propio, no mezclado con el cuadre del detalle ──
const repetidas = revisar({ ...HECHOS_OK, cuadre: { ...HECHOS_OK.cuadre,
  desvios: ["lotes: el detalle trae 2 pasada(s) dos veces (el parte y el volcado: 26091001, 26091002), 4.000 kg de mas"],
  lotesRepetidas: [{ lote: "26091001", kg: 2000 }, { lote: "26091002", kg: 2000 }], lotesKgRepetido: 4000 } });
comprobar("las pasadas repetidas son su propio reparo", de(repetidas, "repetidas").estado === "reparo");
comprobar("y NO ensucian el cuadre del detalle", de(repetidas, "detalle").estado === "ok");
// Desde el 11-09 la limpieza corre SOLA cada mañana, asi que el diagnostico no
// puede decir "ejecuta el limpiador": ya se ejecuto y decidio no borrar esta.
// Decir lo contrario mandaria a una persona a repetir algo que ya paso.
comprobar("el diagnostico no manda ejecutar el limpiador a mano",
  !/quitar-pasadas-repetidas\.mjs/.test(texto(repetidas)));
comprobar("dice que la limpieza automatica ya paso y por que esta sobrevivio",
  /limpieza automática de cada mañana/.test(texto(repetidas))
  && /tiene algo que la del parte no/.test(texto(repetidas)));

// ── Palets imposibles ───────────────────────────────────────────────────────
const sospechosos = revisar({ ...HECHOS_OK, paletsSospechosos: [{ palet: "P-9001", kg: 24000 }] });
comprobar("un palet de mas de 10 t es reparo", de(sospechosos, "palets-creibles").estado === "reparo");
comprobar("y se explica que suelen ser regularizaciones del ERP",
  /regularización del ERP|regularizaci/.test(texto(sospechosos)));

// ── El papel ────────────────────────────────────────────────────────────────
const PARTE_SIN_PAPEL = { ...PARTE_OK,
  kg_industria_manual: 0, kg_reciclado_malla_z1: 0, kg_reciclado_malla_z2: 0,
  kg_inventario_sin_alta: 0, kg_podrido_bolsa_basura: 0 };
const sinPapel = revisar({ ...HECHOS_OK, parte: PARTE_SIN_PAPEL,
  papel: estadoDelPapel(PARTE_SIN_PAPEL, "2026-09-11"), dsj: calcularDsj(PARTE_SIN_PAPEL) });
comprobar("el papel sin meter es reparo", de(sinPapel, "papel").estado === "reparo");
comprobar("y se dice QUE DIA se estimara solo", /el 2026-09-12/.test(texto(sinPapel)));
comprobar("y que los manuales solo bajan el descuadre",
  /solo pueden bajarlo/.test(texto(sinPapel)));

const PARTE_ESTIMADO = { ...PARTE_SIN_PAPEL, kg_reciclado_malla_z1: 206, kg_podrido_bolsa_basura: 387,
  campos_estimados: { estimado_at: "2026-09-12T05:00:00Z", campos: {
    kg_reciclado_malla_z1: { valor: 206, metodo: "mediana-14d" },
    kg_podrido_bolsa_basura: { valor: 387, metodo: "mediana-14d" } } } };
const estimado = revisar({ ...HECHOS_OK, parte: PARTE_ESTIMADO, papel: estadoDelPapel(PARTE_ESTIMADO, "2026-09-13") });
comprobar("el papel ESTIMADO cuenta como puesto (decision del dueño)",
  de(estimado, "papel").estado === "ok");
comprobar("pero la marca dice que es estimado y con que metodo",
  /estimado\(s\) según histórico: reciclado Z1, podrido de bolsa/.test(de(estimado, "papel").detalle));
comprobar("el papel tecleado a mano se distingue del estimado",
  de(bueno, "papel").detalle === "tecleados por una persona");

// Si la gracia paso y sigue sin nada, la estimacion es la que ha fallado.
const graciaAgotada = revisar({ ...HECHOS_OK, parte: PARTE_SIN_PAPEL,
  papel: estadoDelPapel(PARTE_SIN_PAPEL, "2026-09-20") });
comprobar("con la gracia agotada se apunta a la estimacion, no al operario",
  /ya debería haber entrado/.test(texto(graciaAgotada)));

// ── Casos de borde ──────────────────────────────────────────────────────────
const sinActividad = revisar({ ...HECHOS_OK,
  parte: { ...PARTE_SIN_PAPEL, kg_produccion_calibrador: 0, kg_palets_brutos: 0 },
  hayActividad: false, informes: { lotesConfeccion: 0, recibidos: 0, faltan: [] },
  cuadre: null, papel: estadoDelPapel(PARTE_SIN_PAPEL, "2026-09-11"), dsj: null });
comprobar("un festivo sale en orden, no con reparos", sinActividad.veredicto === "en-orden");
comprobar("y sus comprobaciones quedan en 'no aplica'",
  ["produccion", "gstock", "papel"].every((k) => de(sinActividad, k).estado === "n/a"));

const sinParte = revisar({ fecha: "2026-09-10", parte: null, hayActividad: true,
  informes: { lotesConfeccion: 2, recibidos: 0, faltan: [] }, cuadre: null,
  paletsSospechosos: [], papel: null, dsj: null, siguiente: null });
comprobar("sin parte el veredicto lo dice con su nombre", sinParte.veredicto === "sin-parte");
comprobar("y no se inventa el resto de comprobaciones", sinParte.comprobaciones.length === 1);
comprobar("el diagnostico apunta a la tarea que no corrio",
  /no llegó a correr/.test(texto(sinParte)));

// ── estadoDelPapel ──────────────────────────────────────────────────────────
comprobar("un 0 real tecleado en un solo campo no es 'papel sin meter'",
  estadoDelPapel({ ...PARTE_SIN_PAPEL, kg_inventario_sin_alta: 1200 }, "2026-09-11").puesto === true);
comprobar("los cinco a cero si es 'papel sin meter'",
  estadoDelPapel(PARTE_SIN_PAPEL, "2026-09-11").puesto === false);
comprobar("la fecha de estimacion son dos dias despues del parte",
  estadoDelPapel(PARTE_SIN_PAPEL, "2026-09-11").estimaraEl === "2026-09-12");

console.log(fallos === 0 ? "\nTodo correcto." : `\n${fallos} comprobacion(es) fallidas.`);
process.exit(fallos === 0 ? 0 : 1);
