/**
 * Pruebas de scripts/lib-asistencia-reloj.mjs, la lógica pura del importador
 * del reloj de fichajes (scripts/importar-asistencia-reloj.mjs).
 *
 * Lo que protegen: que el export del reloj se lea igual que lo leía
 * parsear_asistencias.py, que los nombres casen como en la app (y que la capa
 * de aproximación no invente parejas), y que las filas que van a
 * asistencia_detalle tengan EXACTAMENTE la forma del volcado manual: una por
 * trabajador activo y día, presente/ausente, motivo null, sin pisar lo que ya
 * está tecleado salvo forzando.
 */
import { describe, expect, it } from "vitest";
import {
  UMBRAL_HORAS_PRESENTE,
  casarNombresReloj,
  claveTokens,
  esCabeceraReloj,
  fechaIsoDeCelda,
  fechasEntre,
  fusionarRegistros,
  horasDeCelda,
  normalizarNombre,
  planificarCarga,
  registrosDeFilas,
  sumaDias,
  type RegistroReloj,
  type TrabajadorReloj,
} from "../../scripts/lib-asistencia-reloj.mjs";

// Cabecera real del export del programa del reloj (19 columnas).
const CABECERA = ["Nº Prod.", "Productor", "Fecha", "ENT", "SAL", "ENT", "SAL", "ENT", "SAL", "ENT", "SAL", "ENT", "SAL", "ENT", "SAL", "Total", "Extra", "Acum.", "Ex.Acum."];

function fila(num: number, nombre: string, fecha: string, tramos: Array<[string, string]>, total: string): unknown[] {
  const f: unknown[] = new Array(19).fill(null);
  f[0] = num; f[1] = nombre; f[2] = fecha;
  tramos.forEach(([ent, sal], i) => { f[3 + i * 2] = ent; f[4 + i * 2] = sal; });
  f[15] = total; f[16] = total; f[17] = total; f[18] = total;
  return f;
}

const PLANTILLA: TrabajadorReloj[] = [
  { id: "t-raquel", nombre: "Raquel Prisco Díaz", activo: true },
  { id: "t-borja", nombre: "Borja Garrido", activo: true },
  { id: "t-jm", nombre: "José María Juarranz Romero", activo: true },
  { id: "t-ruben", nombre: "Rubén Chaparro", activo: true },
  { id: "t-encarni", nombre: "Encarni Minguez", activo: true },
  { id: "t-carmen", nombre: "Carmen Carmelia Oprea", activo: true },
  { id: "t-sleon", nombre: "Sandra León", activo: true },
  { id: "t-snaranjo", nombre: "Sandra Naranjo", activo: true },
  { id: "t-eli", nombre: "Eli Conde", activo: true },
  { id: "t-baja", nombre: "Antiguo Trabajador Ido", activo: false },
];

describe("celdas del export del reloj", () => {
  it("convierte el Total hh:mm a horas como el parser Python (3 decimales)", () => {
    expect(horasDeCelda("07:50")).toBe(7.833);
    expect(horasDeCelda("00:35")).toBe(0.583);
    expect(horasDeCelda("9:02:10")).toBe(9.033);
    expect(horasDeCelda("00:00")).toBe(0);
  });

  it("entiende también una hora de Excel (fracción de día) o una Date, y rechaza la basura", () => {
    expect(horasDeCelda(0.326388888)).toBe(7.833);
    expect(horasDeCelda(new Date(1899, 11, 30, 7, 50, 0))).toBe(7.833);
    expect(horasDeCelda("")).toBeNull();
    expect(horasDeCelda(null)).toBeNull();
    expect(horasDeCelda("siete")).toBeNull();
  });

  it("lee la fecha dd/mm/yyyy del programa, y también ISO, Date y serie de Excel", () => {
    expect(fechaIsoDeCelda("28/08/2026")).toBe("2026-08-28");
    expect(fechaIsoDeCelda("2026-08-28")).toBe("2026-08-28");
    expect(fechaIsoDeCelda(new Date(2026, 7, 28))).toBe("2026-08-28");
    expect(fechaIsoDeCelda(46262)).toBe("2026-08-28");
    expect(fechaIsoDeCelda("ayer")).toBeNull();
    expect(fechaIsoDeCelda(null)).toBeNull();
  });
});

describe("registrosDeFilas", () => {
  it("reconoce la cabecera del reloj y rechaza otros Excel que caigan en la carpeta", () => {
    expect(esCabeceraReloj(CABECERA)).toBe(true);
    expect(esCabeceraReloj(["Productor", "Actividad", "Fecha", "HI", "HF", "HN", "HE", "Total"])).toBe(false);
    expect(registrosDeFilas([["Fecha", "Lote", "Kg Entrada"], ["01/08/2026", "26080101", 12000]])).toBeNull();
    expect(registrosDeFilas([])).toBeNull();
  });

  it("saca un registro por fila con horas, primera entrada y ÚLTIMA salida, saltando filas vacías", () => {
    const filas = [
      CABECERA,
      fila(5, "PRISCO DIAZ, RAQUEL", "03/08/2026", [["5:11:57", "12:20:39"], ["12:20:39", "12:24:08"], ["12:24:08", "13:04:32"]], "07:50"),
      fila(1, "JUARRANZ ROMERO, JOSE MARIA", "04/08/2026", [["7:34:35", "8:09:59"]], "00:35"),
      [null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null],
      [null, "TOTAL", null],
    ];
    const registros = registrosDeFilas(filas, { fichero: "asistencias.xlsx" });
    expect(registros).toHaveLength(2);
    expect(registros?.[0]).toEqual({
      num: 5, nombre: "PRISCO DIAZ, RAQUEL", fecha: "2026-08-03", horas: 7.833,
      entrada: "5:11:57", salida: "13:04:32", fichero: "asistencias.xlsx",
    });
    expect(registros?.[1].horas).toBe(0.583);
  });

  it("al fusionar exports, el mismo (nombre, día) del fichero más nuevo pisa al viejo", () => {
    const viejo = registrosDeFilas([CABECERA, fila(5, "PRISCO DIAZ, RAQUEL", "03/08/2026", [["5:11", "12:00"]], "06:49")]) ?? [];
    const nuevo = registrosDeFilas([CABECERA, fila(5, "PRISCO DIAZ, RAQUEL", "03/08/2026", [["5:11", "13:04"]], "07:50"), fila(7, "GARRIDO, BORJA", "03/08/2026", [["6:00", "14:00"]], "08:00")]) ?? [];
    const fusion = fusionarRegistros([viejo, nuevo]);
    expect(fusion).toHaveLength(2);
    expect(fusion.find((r) => r.nombre === "PRISCO DIAZ, RAQUEL")?.horas).toBe(7.833);
  });
});

describe("casarNombresReloj (mismas capas que la app)", () => {
  it("normaliza y compara por conjunto de tokens: 'APELLIDO, NOMBRE' casa con 'Nombre Apellido'", () => {
    expect(normalizarNombre("  Rubén  CHAPARRO ")).toBe("ruben chaparro");
    expect(claveTokens("GARRIDO, BORJA")).toBe(claveTokens("Borja Garrido"));
    const r = casarNombresReloj(["GARRIDO, BORJA", "PRISCO DIAZ, RAQUEL"], PLANTILLA);
    expect(r.get("GARRIDO, BORJA")).toMatchObject({ estado: "casado", via: "tokens", trabajador: { id: "t-borja" } });
    expect(r.get("PRISCO DIAZ, RAQUEL")).toMatchObject({ estado: "casado", via: "tokens", trabajador: { id: "t-raquel" } });
  });

  it("el nombre legal con dos apellidos casa con el corto de la plantilla por subconjunto (≥2 tokens)", () => {
    const r = casarNombresReloj(["CHAPARRO CARMONA, RUBEN"], PLANTILLA);
    expect(r.get("CHAPARRO CARMONA, RUBEN")).toMatchObject({ estado: "casado", via: "subconjunto", trabajador: { id: "t-ruben" } });
  });

  it("un alias aprendido en la app manda antes que cualquier heurística", () => {
    const alias = new Map([[normalizarNombre("CONDE GARCIA, ELISABETH"), "t-eli"]]);
    const r = casarNombresReloj(["CONDE GARCIA, ELISABETH"], PLANTILLA, alias);
    expect(r.get("CONDE GARCIA, ELISABETH")).toMatchObject({ estado: "casado", via: "alias", trabajador: { id: "t-eli" } });
  });

  it("la aproximación casa 'ENCARNACION' con 'Encarni' y lo marca, pero no inventa CARMONA ~ Carmen", () => {
    const r = casarNombresReloj(["MINGUEZ LOPEZ, ENCARNACION", "CHAPARRO CARMONA, RUBEN"], PLANTILLA);
    expect(r.get("MINGUEZ LOPEZ, ENCARNACION")).toMatchObject({ estado: "aproximado", via: "aproximado", trabajador: { id: "t-encarni" } });
    // Rubén casa estricto por subconjunto: la capa tolerante ni entra, y Carmen no aparece
    expect(r.get("CHAPARRO CARMONA, RUBEN")?.trabajador?.id).toBe("t-ruben");
    const soloEstrictos = casarNombresReloj(["MINGUEZ LOPEZ, ENCARNACION"], PLANTILLA, new Map(), { aproximado: false });
    expect(soloEstrictos.get("MINGUEZ LOPEZ, ENCARNACION")?.estado).toBe("sin-casar");
  });

  it("no decide entre varios candidatos, ni carga a un inactivo, ni casa a un desconocido", () => {
    const r = casarNombresReloj(["SANDRA", "TRABAJADOR IDO, ANTIGUO", "PEREZ PEREZ, NADIE"], PLANTILLA);
    expect(r.get("SANDRA")?.estado).toBe("sin-casar"); // un solo token nunca identifica
    expect(r.get("TRABAJADOR IDO, ANTIGUO")).toMatchObject({ estado: "inactivo", trabajador: { id: "t-baja" } });
    expect(r.get("PEREZ PEREZ, NADIE")).toMatchObject({ estado: "sin-casar", trabajador: null });
    const ambiguo = casarNombresReloj(["LEON NARANJO, SANDRA"], PLANTILLA);
    expect(ambiguo.get("LEON NARANJO, SANDRA")?.estado).toBe("ambiguo");
    expect(ambiguo.get("LEON NARANJO, SANDRA")?.candidatos.map((c) => c.id).sort()).toEqual(["t-sleon", "t-snaranjo"]);
  });
});

describe("planificarCarga", () => {
  const reg = (nombre: string, fecha: string, horas: number | null): RegistroReloj =>
    ({ num: null, nombre, fecha, horas, entrada: null, salida: null, fichero: null });
  const registros = [
    reg("PRISCO DIAZ, RAQUEL", "2026-08-05", 7.8),
    reg("GARRIDO, BORJA", "2026-08-05", 8.1),
    reg("JUARRANZ ROMERO, JOSE MARIA", "2026-08-05", 0.583), // 35 min: no es un día trabajado
    reg("TRABAJADOR IDO, ANTIGUO", "2026-08-05", 8), // inactivo: no se escribe
    reg("PEREZ PEREZ, NADIE", "2026-08-05", 8), // sin casar: no se escribe
    reg("PRISCO DIAZ, RAQUEL", "2026-08-06", 7.9),
    reg("PRISCO DIAZ, RAQUEL", "2026-08-04", 7.7), // fuera del rango
  ];
  const casados = casarNombresReloj(registros.map((r) => r.nombre), PLANTILLA);
  const base = { registros, casados, trabajadores: PLANTILLA, desde: "2026-08-05", hasta: "2026-08-09", userId: "u-dueno" } as const;

  it("escribe una fila por trabajador ACTIVO y día con la forma exacta de la app, presente solo con ≥ 1 h", () => {
    const plan = planificarCarga({ ...base });
    expect(UMBRAL_HORAS_PRESENTE).toBe(1);
    expect(plan.aCargar.map((d) => d.fecha)).toEqual(["2026-08-05", "2026-08-06"]);
    const dia = plan.aCargar[0];
    expect(dia.filas).toHaveLength(PLANTILLA.filter((t) => t.activo).length);
    expect(dia.filas.every((f) => f.user_id === "u-dueno" && f.date === "2026-08-05" && f.motivo_ausencia === null)).toBe(true);
    expect(Object.keys(dia.filas[0]).sort()).toEqual(["date", "motivo_ausencia", "presente", "trabajador_id", "user_id"]);
    const presentes = dia.filas.filter((f) => f.presente).map((f) => f.trabajador_id).sort();
    expect(presentes).toEqual(["t-borja", "t-raquel"]);
    // fichó 35 min: se escribe su fila, pero AUSENTE (no es un día trabajado)
    expect(dia.filas.find((f) => f.trabajador_id === "t-jm")?.presente).toBe(false);
    expect(dia.filas.some((f) => f.trabajador_id === "t-baja")).toBe(false);
    expect(dia.presentesReloj).toBe(4); // 4 con ≥1 h en el reloj…
    expect(dia.presentesCasados).toBe(2); // …de los que 2 casan con activos
  });

  it("no inventa los días sin fichajes y distingue laborables de fin de semana", () => {
    const plan = planificarCarga({ ...base });
    expect(plan.sinDatos.map((d) => d.fecha)).toEqual(["2026-08-07", "2026-08-08", "2026-08-09"]);
    expect(plan.sinDatos.map((d) => d.finDeSemana)).toEqual([false, true, true]);
    expect(plan.dias).toHaveLength(5);
  });

  it("salta un día que ya tiene asistencia y lo compara; solo --forzar lo pisa", () => {
    const diasExistentes = new Map([["2026-08-05", { filas: 58, presentes: 30 }]]);
    const plan = planificarCarga({ ...base, diasExistentes });
    expect(plan.yaCargados.map((d) => d.fecha)).toEqual(["2026-08-05"]);
    expect(plan.yaCargados[0].existente).toEqual({ filas: 58, presentes: 30 });
    expect(plan.yaCargados[0].filas).toHaveLength(0);
    expect(plan.aCargar.map((d) => d.fecha)).toEqual(["2026-08-06"]);
    const forzado = planificarCarga({ ...base, diasExistentes, forzar: true });
    expect(forzado.aCargar.map((d) => d.fecha)).toEqual(["2026-08-05", "2026-08-06"]);
  });

  it("agrega lo que hay que revisar: sin casar, inactivos con horas y activos que nunca fichan", () => {
    const plan = planificarCarga({ ...base });
    expect(plan.nombres.sinCasar.map((x) => x.nombre)).toEqual(["PEREZ PEREZ, NADIE"]);
    expect(plan.nombres.inactivos.map((x) => x.nombre)).toEqual(["TRABAJADOR IDO, ANTIGUO"]);
    expect(plan.nombres.casados.map((x) => x.nombre)).toEqual(["PRISCO DIAZ, RAQUEL", "GARRIDO, BORJA", "JUARRANZ ROMERO, JOSE MARIA"]);
    expect(plan.nombres.casados.find((x) => x.nombre === "PRISCO DIAZ, RAQUEL")).toMatchObject({ dias: 2, diasConHoras: 2, horas: 15.7 });
    // José María ficha, pero nunca ≥1 h: cuenta como "no ficha" y se queda ausente todos los días
    expect(plan.activosNuncaEnReloj.map((t) => t.id).sort()).toEqual(["t-carmen", "t-eli", "t-encarni", "t-jm", "t-ruben", "t-sleon", "t-snaranjo"]);
  });

  it("rechaza un rango al revés", () => {
    expect(() => planificarCarga({ ...base, desde: "2026-08-09", hasta: "2026-08-05" })).toThrow(/rango/);
  });
});

describe("fechas", () => {
  it("suma días y enumera rangos sin líos de zona horaria", () => {
    expect(sumaDias("2026-08-31", 1)).toBe("2026-09-01");
    expect(sumaDias("2026-09-01", -1)).toBe("2026-08-31");
    expect(fechasEntre("2026-08-30", "2026-09-01")).toEqual(["2026-08-30", "2026-08-31", "2026-09-01"]);
  });
});
