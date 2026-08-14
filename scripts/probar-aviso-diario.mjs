/**
 * Comprobación del texto del aviso diario.
 *
 * Lo que protege: los avisos de "la IP ha cambiado", "el receptor está caído" o
 * "faltan informes" saltan una vez cada mucho tiempo y tienen que funcionar
 * justo ese día. Y el asunto tiene que llevar [REVISAR] cuando hay algo que
 * mirar, porque si no se lee en diagonal.
 *
 *   node scripts/probar-aviso-diario.mjs
 */
import { componerAviso, informesSinSubir } from "./lib-aviso-diario.mjs";

const BASE = {
  fecha: "2026-08-10",
  entradas: { n: 4, kg: 21550, precalibrado: 1 },
  palets: { n: 146, kg: 72709, euros: 61234, kgFacturados: 72709, clientes: [{ cliente: "MERCADONA S.A.", kg: 40000 }] },
  cobertura: { lotes: 5, conOrigen: 3 },
  calibrador: { pasadas: 4, kgTotal: 79164, kgMujeres: 4847, kgExportacion: 50000, kgIndustria: 6000 },
  parte: {
    accion: "creado", id: "abc-123", estado: "Borrador",
    automaticos: {
      kg_produccion_calibrador: 79164.37, kg_mujeres_calibrador: 4847.34,
      kg_palets_brutos: 72709, kg_inventario_anterior_sin_alta: 1547,
    },
    dsj: { kg: 3155, pct: 4.2 },
  },
  productores: [{ productor: "ECILIMP AGRO S.L.", kg: 40000, pctExportacion: 77 }],
  correcciones: 0,
  ip: "192.168.1.237",
  log: [],
  receptor: true,
  ipEsperada: "192.168.1.237",
};

let fallos = 0;
const comprobar = (titulo, cond) => {
  if (!cond) fallos++;
  console.log(`${cond ? "OK   " : "FALLA"}  ${titulo}`);
};

const normal = componerAviso(BASE);
comprobar("un dia normal no da problema", normal.hayProblema === false);
comprobar("trae la produccion del calibrador", normal.cuerpo.includes("79.164 kg en 4 pasadas"));
comprobar("y el reparto por destino con su %", /a exportacion.*50\.000 kg  63,2%/.test(normal.cuerpo));

// El titular: lo primero que se lee tiene que decir si el dia fue normal o no.
const conContexto = componerAviso({ ...BASE, contexto: {
  media: { dias: 7, kg: 70000, mujeres: 6000, pctExp: 70 },
  serie: [
    { fecha: "2026-08-04", kg: 62000, exportacion: 43000, pctExp: 69.4 },
    { fecha: "2026-08-05", kg: 78000, exportacion: 41000, pctExp: 52.4 },
    { fecha: "2026-08-06", kg: 68000, exportacion: 44000, pctExp: 64.7 },
    { fecha: "2026-08-10", kg: 79164, exportacion: 50000, pctExp: 63.2 },
  ],
} });
comprobar("empieza diciendo de que dia habla", /^Produccion del lunes 10 de agosto/.test(conContexto.cuerpo));
comprobar("y resume el dia en una frase", /Se calibraron 79\.164 kg en 4 pasadas/.test(conContexto.cuerpo));
comprobar("comparando con la media", /13% por encima de la media de los ultimos 7 dias/.test(conContexto.cuerpo));
comprobar("y diciendo si el aprovechamiento fue bueno", /7 puntos por debajo de lo habitual \(70%\)/.test(conContexto.cuerpo));
comprobar("una diferencia pequeña se llama 'lo normal'",
  /fue a exportacion, lo normal/.test(componerAviso({ ...BASE, contexto: {
    media: { dias: 7, kg: 70000, mujeres: 6000, pctExp: 64 }, serie: [],
  } }).cuerpo));
comprobar("la produccion se compara con la media", /Calibrado.*▲ \+13% sobre la media/.test(conContexto.cuerpo));
comprobar("hay una vista de la semana", /COMO VIENE LA SEMANA/.test(conContexto.cuerpo));
comprobar("con barras para ver la forma", /█/.test(conContexto.cuerpo));
comprobar("marcando el dia del que se informa", /→ lunes 10/.test(conContexto.cuerpo));
comprobar("y el total de la serie", /Total 4 dias.*287\.164 kg/.test(conContexto.cuerpo));
comprobar("tener contexto no es una incidencia", conContexto.hayProblema === false);

comprobar("sin contexto no se inventan comparaciones",
  !/sobre la media|COMO VIENE/.test(componerAviso(BASE).cuerpo));
comprobar("trae los palets y el facturado", normal.cuerpo.includes("72.709 kg") && normal.cuerpo.includes("61.234 EUR"));
comprobar("calcula el precio medio con coma decimal", normal.cuerpo.includes("0,84 EUR/kg"));
comprobar("nombra a los clientes principales", normal.cuerpo.includes("MERCADONA"));
comprobar("lista productores con su % de exportacion", /ECILIMP.*40\.000 kg · 77%/.test(normal.cuerpo));
comprobar("dice que el parte quedo creado", /creado en borrador/.test(normal.cuerpo));
comprobar("y que falta copiar del papel", /Solo falta copiar del papel/.test(normal.cuerpo));
comprobar("con el enlace al parte concreto", normal.cuerpo.includes("/partes/abc-123"));
comprobar("y repite los automaticos para contrastar", /Produccion calibrador.*79\.164 kg/.test(normal.cuerpo));

comprobar("trae los palets del parte", /Palets confeccionados.*72\.709 kg/.test(normal.cuerpo));

const sinGstock = componerAviso({ ...BASE,
  parte: { ...BASE.parte, automaticos: { ...BASE.parte.automaticos, kg_palets_brutos: 0 }, dsj: null } });
comprobar("sin GSTOCK no se ensena un 0 kg tranquilo", /Palets confeccionados.*falta subir el GSTOCK/.test(sinGstock.cuerpo));
comprobar("y se pide junto a lo del papel", /Falta el GSTOCK del dia.*y copiar del papel/.test(sinGstock.cuerpo));
comprobar("y el descuadre provisional", /Descuadre provisional.*3155 kg · 4,2%/.test(normal.cuerpo));
comprobar("diciendo que es provisional", /solo lo bajan/.test(normal.cuerpo));
// Los tres tramos del semaforo de cascade.ts: verde <=3%, ambar <=5%, rojo >5%.
const conDsj = (pct) => componerAviso({ ...BASE, parte: { ...BASE.parte, dsj: { kg: 3000, pct } } }).cuerpo;
comprobar("un descuadre verde (<=3%) no lleva coletilla", !/\(ALTO\)|\(algo alto\)/.test(conDsj(2.4)));
comprobar("uno ambar (4,2%) avisa flojito", /\(algo alto\)/.test(conDsj(4.2)));
comprobar("uno rojo (>5%) avisa fuerte", /\(ALTO\)/.test(conDsj(12)));
comprobar("y un descuadre negativo se juzga por su valor absoluto", /\(ALTO\)/.test(conDsj(-9)));
comprobar("sin palets no se inventa descuadre",
  !/Descuadre/.test(componerAviso({ ...BASE, parte: { ...BASE.parte, dsj: null } }).cuerpo));

// El dia que no hay volcado del Sizer, los kilos salen de los informes de lote y
// pueden quedarse cortos (el DOCX solo ve la ultima pasada de cada lote). Si eso
// no se dice, el numero se lee como definitivo y nadie vuelve a mirarlo.
const provisional = componerAviso({ ...BASE, parte: { ...BASE.parte, origen: "docx", lotes: 6 } });
comprobar("los kilos sin volcado se marcan como provisionales",
  /Produccion calibrador.*79\.164 kg \(provisional\)/.test(provisional.cuerpo));
comprobar("y las mujeres tambien", /Mujeres.*4847 kg \(provisional\)/.test(provisional.cuerpo));
comprobar("y se explica de donde salen y que se corrigen solos",
  /salen de 6 informes de lote/.test(provisional.cuerpo) && /corrigen solos/.test(provisional.cuerpo));
comprobar("con volcado no se dice nada de provisional",
  !/provisional\)/.test(normal.cuerpo) && !/informes de lote,/.test(normal.cuerpo));
comprobar("y los palets no heredan la coletilla",
  !/Palets confeccionados.*provisional/.test(provisional.cuerpo));
comprobar("un descuadre sobre kilos provisionales lo dice",
  /el descuadre sale mas grande de lo que es/.test(provisional.cuerpo));
comprobar("y con volcado esa disculpa no aparece",
  !/el descuadre sale mas grande/.test(normal.cuerpo));

// Un parte que ya se habia mirado y cambia de numero tiene que decirlo, o nadie
// se entera de que los palets de ese dia ya no son los que vio.
const rehecho = componerAviso({ ...BASE,
  parte: { ...BASE.parte, gstockRehechos: [{ fecha: "2026-08-11", faltaban: 11662 }] } });
comprobar("un GSTOCK rehecho se cuenta, con dia y kilos",
  /El parte del 2026-08-11 se ha rehecho: el ERP tenia 11\.662 kg/.test(rehecho.cuerpo));
comprobar("y no es una incidencia: es el sistema poniendose al dia",
  rehecho.hayProblema === false);
comprobar("sin rehacer nada no aparece la linea", !/se ha rehecho/.test(normal.cuerpo));

const sinErp = componerAviso({ ...BASE, parte: { ...BASE.parte, erpCaido: "connect ETIMEDOUT" } });
comprobar("el ERP caido SI es incidencia", sinErp.hayProblema === true);
comprobar("y explica que hay que subir el GSTOCK a mano", /Excel del GSTOCK a mano/.test(sinErp.cuerpo));

const arrastrePendiente = componerAviso({ ...BASE,
  parte: { ...BASE.parte, anteriorPendiente: true, automaticos: { ...BASE.parte.automaticos, kg_inventario_anterior_sin_alta: 0 } } });
comprobar("un arrastre aun sin cerrar no se ensena como 0 kg",
  /Inventario del dia antes.*a falta de cerrar/.test(arrastrePendiente.cuerpo));
comprobar("da la cobertura de trazabilidad", normal.cuerpo.includes("3 (60%)"));
comprobar("y explica el resto sin que parezca una averia", /no un fallo/.test(normal.cuerpo));
comprobar("si estan todos, no sobra la explicacion",
  !/no un fallo/.test(componerAviso({ ...BASE, cobertura: { lotes: 5, conOrigen: 5 } }).cuerpo));
comprobar("el correo no tiene lineas en blanco de sobra", !/\n\n\n/.test(normal.cuerpo));

const parteExistente = componerAviso({ ...BASE, parte: { accion: "respetado", motivo: 'ya existe y esta en "Validado"' } });
comprobar("un parte ya validado se respeta y se dice", /ya existia.*Validado/.test(parteExistente.cuerpo));
comprobar("y entonces no pide copiar nada del papel", !/copiar del papel/.test(parteExistente.cuerpo));

const conHuecos = componerAviso({ ...BASE, parte: { ...BASE.parte, recuperados: ["2026-08-06", "2026-08-07"] } });
comprobar("los partes recuperados de dias sueltos se nombran", /recuperado.*2026-08-06, 2026-08-07/.test(conHuecos.cuerpo));

const parteRoto = componerAviso({ ...BASE, parte: { accion: "error", motivo: "no hay user_id" } });
comprobar("si el parte falla, es incidencia", parteRoto.hayProblema === true && /crearlo a mano/.test(parteRoto.cuerpo));

const nombreLargo = componerAviso({ ...BASE,
  productores: [{ productor: "LASARTE EXPORT S.L. Invermarmelo-FRUBEZAR", kg: 78689, pctExportacion: 53.2 }] });
comprobar("el nombre largo de productor NO se corta",
  nombreLargo.cuerpo.includes("LASARTE EXPORT S.L. Invermarmelo-FRUBEZAR"));

const ipMala = componerAviso({ ...BASE, ip: "192.168.1.99" });
comprobar("la IP distinta SI da problema", ipMala.hayProblema === true);
comprobar("y dice las dos IPs y la consecuencia", ipMala.cuerpo.includes("192.168.1.99") && /NO estan llegando/.test(ipMala.cuerpo));

comprobar("no poder leer la IP tambien es problema", componerAviso({ ...BASE, ip: null }).hayProblema === true);

const caido = componerAviso({ ...BASE, receptor: false });
comprobar("el receptor caido SI da problema", caido.hayProblema === true && /se perderan/.test(caido.cuerpo));
comprobar("si no se comprueba (null) no se inventa alarma", componerAviso({ ...BASE, receptor: null }).hayProblema === false);

// ── Informes recibidos que no llegaron a la base ────────────────────────────
// La averia real del 13-08-2026: el receptor guardaba los .docx y las subidas
// fallaban en silencio. Se comprueba que se avise, que se nombren los lotes y,
// sobre todo, que el aviso se apague solo cuando la pasada ya esta en la base.
const REG = [
  { recibido: "2026-08-13T10:36:23Z", lote: "26051905", comienzo: "13-Aug-26 07:12 AM", motivo: "no unique constraint" },
  { recibido: "2026-08-13T10:36:35Z", lote: "26052004", comienzo: "13-Aug-26 09:40 AM", motivo: "no unique constraint" },
];

const nada = informesSinSubir(REG, new Set(), new Set());
comprobar("dos subidas fallidas dan dos pendientes", nada.length === 2);

const unaDentro = informesSinSubir(REG, new Set(["26051905|13-Aug-26 07:12 AM"]), new Set(["26051905"]));
comprobar("la que ya esta en la base deja de contar", unaDentro.length === 1 && unaDentro[0].lote === "26052004");

const reenviado = informesSinSubir([...REG, { ...REG[0] }, { ...REG[0] }], new Set(), new Set());
comprobar("el mismo informe reenviado 3 veces cuenta una", reenviado.length === 2);

const otraPasada = informesSinSubir(
  [{ lote: "26051506", comienzo: "12-Aug-26 10:01 AM", motivo: "x" }],
  new Set(["26051506|11-Aug-26 12:03 PM"]), new Set(["26051506"]));
comprobar("otra pasada del mismo lote NO se da por subida", otraPasada.length === 1);

const vieja = informesSinSubir(
  [{ lote: "26051506", comienzo: null, motivo: "x" }], new Set(), new Set(["26051506"]));
comprobar("anotacion vieja sin comienzo: se resuelve por lote", vieja.length === 0);

comprobar("sin registro no se inventa nada", informesSinSubir(null, new Set()).length === 0);

const pend = componerAviso({ ...BASE, sinSubir: nada });
comprobar("informes sin subir SI dan problema", pend.hayProblema === true);
comprobar("y dicen el lote y como recuperarlos",
  /26051905/.test(pend.cuerpo) && /subir-informes-calibrador\.mjs --aplicar/.test(pend.cuerpo));
comprobar("sin pendientes no hay alarma", componerAviso({ ...BASE, sinSubir: [] }).hayProblema === false);

const viejo = componerAviso({ ...BASE, calibrador: { ...BASE.calibrador, desfaseExport: 5 } });
comprobar("datos del calibrador viejos: alarma con instrucciones", viejo.hayProblema === true && /export-sizer\.ps1/.test(viejo.cuerpo));

const sinInformes = componerAviso({ ...BASE, informesCalibrador: { n: 0, lotes: [], lotesConfeccion: 4, faltan: [] } });
comprobar("hubo lotes y cero informes DOCX: alarma", sinInformes.hayProblema === true);

const faltanAlgunos = componerAviso({ ...BASE, informesCalibrador: { n: 2, lotes: ["a"], lotesConfeccion: 3, faltan: ["26052207"] } });
comprobar("faltan informes concretos: los nombra", /26052207/.test(faltanAlgunos.cuerpo));

const conErrores = componerAviso({ ...BASE, log: ["normal", "ERROR: fallo la sincronizacion"] });
comprobar("un ERROR del log sube al aviso", conErrores.hayProblema === true && /fallo la sincronizacion/.test(conErrores.cuerpo));

comprobar("las correcciones pendientes se avisan",
  componerAviso({ ...BASE, correcciones: 12 }).cuerpo.includes("12 campos"));

const parado = componerAviso({
  ...BASE, entradas: { n: 0, kg: 0, precalibrado: 0 },
  palets: { n: 0, kg: 0, euros: 0, clientes: [] },
  calibrador: null, productores: null, cobertura: { lotes: 0, conOrigen: 0 },
});
comprobar("un dia parado se dice con palabras, no con ceros", /Sin actividad registrada/.test(parado.cuerpo));
comprobar("y un dia parado no es una incidencia", parado.hayProblema === false);

comprobar("sin facturar no se muestra como 0 EUR",
  componerAviso({ ...BASE, palets: { n: 10, kg: 5000, euros: 0, clientes: [] } }).cuerpo.includes("todavia sin facturar"));

// Facturado a medias: el precio medio va sobre lo facturado, no sobre el total.
const aMedias = componerAviso({ ...BASE,
  palets: { n: 146, kg: 72709, euros: 30000, kgFacturados: 36000, clientes: [] } });
comprobar("el precio medio se divide entre lo facturado", aMedias.cuerpo.includes("0,83 EUR/kg"));
comprobar("y dice sobre cuantos kilos va", /sobre.*36\.000 kg de 72\.709 kg/.test(aMedias.cuerpo));
comprobar("si esta todo facturado no sobra la aclaracion", !/ya facturados/.test(normal.cuerpo));

const analizadoSolo = componerAviso({ ...BASE,
  analizados: [{ fecha: "2026-08-10", archivos: 8, reabierto: true }] });
comprobar("dice que analizo un parte que estaba sin extraer", /Analizado solo el parte del 2026-08-10 \(8 informes/.test(analizadoSolo.cuerpo));
comprobar("y que sigue editable para los manuales", /sigue en borrador para los manuales/.test(analizadoSolo.cuerpo));
comprobar("analizar solo no es una incidencia", analizadoSolo.hayProblema === false);

// El alta de palets deducida de las fotos: en pruebas, no debe escribir nada.
const conAlta = componerAviso({ ...BASE, alta: {
  fotos: 14, fotosDelDia: 12,
  cierre: { estado: "cerrado", hora: "13:00", kg: 66000 },
  inventario: { estado: "calculado", kg: 5500, anulaciones: 0, horaMedida: "07:00", cierre: "13:00" },
} });
comprobar("dice a que hora terminaron de dar de alta", /Terminaron de dar de alta.*13:00/.test(conAlta.cuerpo));
comprobar("y cuanto quedo sin dar de alta", /Quedo sin dar de alta.*5500 kg/.test(conAlta.cuerpo));
comprobar("dejando claro que aun no se usa", /en pruebas, no se usa todavia/.test(conAlta.cuerpo));
comprobar("y pidiendo que se contraste", /Comparalo con lo que hayan pesado/.test(conAlta.cuerpo));
comprobar("estar en pruebas no es una incidencia", conAlta.hayProblema === false);

const altaIncompleta = componerAviso({ ...BASE, alta: {
  fotos: 3, fotosDelDia: 3, cierre: { estado: "quiza-abierto", hora: "12:00" },
  inventario: { estado: "sin-foto-de-la-mañana" },
} });
comprobar("si falta la foto de la mañana NO se inventa el numero", /todavia no se puede calcular/.test(altaIncompleta.cuerpo));
comprobar("y avisa de que el dia quiza no habia cerrado", /o mas tarde: seguia subiendo/.test(altaIncompleta.cuerpo));

// El buzon de correo: lo que llego, lo que entro solo y lo que espera.
const conBuzon = componerAviso({ ...BASE, buzon: {
  importados: [{ fichero: "guadex.xlsx", etiqueta: "Registro de camara externa", detalle: "12 camion(es) importado(s)" }],
  esperando: [{ fichero: "ventas julio.xlsx", etiqueta: "Ventas mensuales — lineas detalladas" }],
  noReconocidos: [{ fichero: "cosas.xlsx" }],
} });
comprobar("dice lo que entro solo", /12 camion\(es\) importado/.test(conBuzon.cuerpo));
comprobar("y lo que espera confirmacion", /Ventas mensuales.*ventas julio\.xlsx/.test(conBuzon.cuerpo));
comprobar("lo que espera SI sube a revisar", /esperando a que alguien/.test(conBuzon.cuerpo));
comprobar("y lo no reconocido se nombra", /cosas\.xlsx/.test(conBuzon.cuerpo));
comprobar("un buzon con cosas pendientes es incidencia", conBuzon.hayProblema === true);

const buzonLimpio = componerAviso({ ...BASE, buzon: {
  importados: [{ fichero: "guadex.xlsx", etiqueta: "Registro de camara externa", detalle: "12 camiones" }],
  esperando: [], noReconocidos: [],
} });
comprobar("si todo entro solo, no hay nada que revisar", buzonLimpio.hayProblema === false);
comprobar("sin buzon no aparece la seccion", !/BUZON/.test(componerAviso(BASE).cuerpo));

// Datos abandonados: lo que la herramienta seguiria enseñando como si fuera de hoy.
const conAtraso = componerAviso({ ...BASE, frescura: [
  { que: "Informes de calidad", ultimo: "2026-06-01", retraso: 72, dias: 14 },
  { que: "Palets del ERP", ultimo: "2026-08-11", retraso: 1, dias: 5 },
  { que: "Partes de limpieza de box", ultimo: null, retraso: null, dias: 21 },
] });
comprobar("un dato abandonado SI es incidencia", conAtraso.hayProblema === true);
comprobar("y dice desde cuando y cuantos dias", /Informes de calidad: nada desde el 2026-06-01 \(72 dias\)/.test(conAtraso.cuerpo));
comprobar("una fuente vacia tambien se nombra", /limpieza de box: no hay ningun dato/.test(conAtraso.cuerpo));
comprobar("lo que esta al dia no da la lata", !/Palets del ERP/.test(conAtraso.cuerpo));
comprobar("sin datos de frescura no se inventa alarma", componerAviso(BASE).hayProblema === false);

const sinEntradas = componerAviso({ ...BASE, entradas: { n: 0, kg: 0, precalibrado: 0 } });
comprobar("cero entradas se explica, no se calla", /se calibro de camara/.test(sinEntradas.cuerpo));
comprobar("y no es una incidencia", sinEntradas.hayProblema === false);

console.log(fallos === 0 ? "\nTodo correcto." : `\n${fallos} comprobacion(es) fallidas.`);
process.exit(fallos === 0 ? 0 : 1);
