import { describe, expect, it } from "vitest";
import {
  coberturaDelPeriodo,
  contarDias,
  contarMarcasPorDia,
  enumerarDias,
  formatFechaLarga,
  mesesDeCobertura,
  resumirCobertura,
  resumirTrabajadoresPeriodo,
  totalesPeriodo,
  trocear,
  type DiaCoberturaRow,
} from "./asistenciaPeriodo";
import type { FaltasSemanalesRow } from "./asistenciaSemanal";

function dia(fecha: string, presentes: number, ausentes = 0): DiaCoberturaRow {
  return { fecha, registros: presentes + ausentes, presentes, ausentes };
}

describe("enumerarDias / contarDias", () => {
  it("devuelve el rango completo con los dos extremos dentro", () => {
    expect(enumerarDias("2026-05-18", "2026-05-21")).toEqual([
      "2026-05-18",
      "2026-05-19",
      "2026-05-20",
      "2026-05-21",
    ]);
    expect(contarDias("2026-05-18", "2026-05-21")).toBe(4);
  });

  it("un solo día es un día, no cero", () => {
    expect(enumerarDias("2026-05-18", "2026-05-18")).toEqual(["2026-05-18"]);
    expect(contarDias("2026-05-18", "2026-05-18")).toBe(1);
  });

  it("cruza meses, años y el cambio de hora sin perder ni repetir días", () => {
    expect(enumerarDias("2026-12-30", "2027-01-02")).toEqual([
      "2026-12-30",
      "2026-12-31",
      "2027-01-01",
      "2027-01-02",
    ]);
    // Último domingo de octubre de 2026 (atrasan los relojes): 4 días, no 3 ni 5.
    expect(enumerarDias("2026-10-24", "2026-10-27")).toHaveLength(4);
    expect(enumerarDias("2026-01-01", "2026-12-31")).toHaveLength(365);
  });

  it("un rango del revés no inventa días", () => {
    expect(enumerarDias("2026-05-21", "2026-05-18")).toEqual([]);
    expect(contarDias("2026-05-21", "2026-05-18")).toBe(0);
  });
});

describe("resumirCobertura", () => {
  it("saca los extremos y separa días volcados de días trabajados", () => {
    // El domingo se volcó entero con todo el mundo ausente: tiene registros
    // pero nadie trabajó. Son dos cuentas distintas a propósito.
    const cobertura = resumirCobertura([
      dia("2026-05-20", 30, 5),
      dia("2026-05-18", 28, 7),
      dia("2026-05-24", 0, 35),
    ]);
    expect(cobertura.primera).toBe("2026-05-18");
    expect(cobertura.ultima).toBe("2026-05-24");
    expect(cobertura.diasConRegistros).toBe(3);
    expect(cobertura.diasConPresencia).toBe(2);
    expect(cobertura.porFecha.get("2026-05-18")?.presentes).toBe(28);
  });

  it("sin ninguna fila no hay extremos que enseñar", () => {
    const cobertura = resumirCobertura([]);
    expect(cobertura.primera).toBeNull();
    expect(cobertura.ultima).toBeNull();
    expect(cobertura.diasConRegistros).toBe(0);
  });
});

describe("coberturaDelPeriodo", () => {
  // Semana del lunes 18 al domingo 24 de mayo de 2026. HOY es un día muy
  // posterior, salvo donde se diga lo contrario.
  const semana = enumerarDias("2026-05-18", "2026-05-24");
  const HOY = "2026-09-17";

  it("cuenta solo días laborables y señala los que faltan por volcar", () => {
    const cobertura = resumirCobertura([
      dia("2026-05-18", 30),
      dia("2026-05-19", 30),
      dia("2026-05-21", 30),
    ]);
    const r = coberturaDelPeriodo(cobertura, semana, false, HOY);
    expect(r.laborables).toBe(5); // lunes a viernes
    expect(r.conRegistros).toBe(3);
    expect(r.sinDatos).toEqual(["2026-05-20", "2026-05-22"]);
    expect(r.primera).toBe("2026-05-18");
    expect(r.ultima).toBe("2026-05-21");
    expect(r.recortada).toBe(false);
  });

  it("con sábado incluido el sábado pasa a contar como laborable", () => {
    const cobertura = resumirCobertura([dia("2026-05-18", 30), dia("2026-05-23", 12)]);
    expect(coberturaDelPeriodo(cobertura, semana, false, HOY).laborables).toBe(5);
    const conSabado = coberturaDelPeriodo(cobertura, semana, true, HOY);
    expect(conSabado.laborables).toBe(6);
    expect(conSabado.conRegistros).toBe(2);
  });

  it("un día volcado sin nadie presente cuenta como volcado, no como trabajado", () => {
    const cobertura = resumirCobertura([dia("2026-05-18", 0, 35)]);
    const r = coberturaDelPeriodo(cobertura, semana, false, HOY);
    expect(r.conRegistros).toBe(1);
    expect(r.conPresencia).toBe(0);
  });

  it("los extremos del periodo miran también los no laborables", () => {
    // Lo único volcado de la semana es el sábado: el periodo empieza y acaba
    // ahí aunque el sábado no sea laborable con el interruptor apagado.
    const cobertura = resumirCobertura([dia("2026-05-23", 12)]);
    const r = coberturaDelPeriodo(cobertura, semana, false, HOY);
    expect(r.primera).toBe("2026-05-23");
    expect(r.ultima).toBe("2026-05-23");
    expect(r.conRegistros).toBe(0);
  });

  it("no cuenta como 'sin volcar' los días que aún no han pasado", () => {
    // Estamos a jueves 21 de mayo: el viernes 22 todavía no ha llegado, así
    // que ni cuenta como laborable pendiente ni sale en la lista de huecos.
    const cobertura = resumirCobertura([dia("2026-05-18", 30), dia("2026-05-19", 30)]);
    const r = coberturaDelPeriodo(cobertura, semana, false, "2026-05-21");
    expect(r.laborables).toBe(4); // lunes a jueves
    expect(r.conRegistros).toBe(2);
    expect(r.sinDatos).toEqual(["2026-05-20", "2026-05-21"]);
    expect(r.recortada).toBe(true);
    expect(r.ventanaHasta).toBe("2026-05-21");
  });

  it("no cuenta como 'sin volcar' lo anterior al arranque del registro", () => {
    // El histórico empieza el miércoles 20: el lunes y el martes no es que
    // falten, es que entonces no se registraba nada.
    const cobertura = resumirCobertura([dia("2026-05-20", 30), dia("2026-05-21", 30)]);
    const r = coberturaDelPeriodo(cobertura, semana, false, HOY);
    expect(r.laborables).toBe(3); // miércoles, jueves y viernes
    expect(r.conRegistros).toBe(2);
    expect(r.sinDatos).toEqual(["2026-05-22"]);
    expect(r.ventanaDesde).toBe("2026-05-20");
    expect(r.recortada).toBe(true);
  });

  it("un periodo entero fuera del histórico no reclama nada", () => {
    const cobertura = resumirCobertura([dia("2026-05-18", 30)]);
    const anterior = coberturaDelPeriodo(cobertura, enumerarDias("2026-04-06", "2026-04-10"), false, HOY);
    expect(anterior.laborables).toBe(0);
    expect(anterior.sinDatos).toEqual([]);
    expect(anterior.ventanaDesde).toBeNull();

    const futuro = coberturaDelPeriodo(cobertura, enumerarDias("2026-10-05", "2026-10-09"), false, HOY);
    expect(futuro.laborables).toBe(0);
    expect(futuro.sinDatos).toEqual([]);
  });
});

describe("mesesDeCobertura", () => {
  it("agrupa por mes y no cuenta como incompleto lo que aún no ha llegado", () => {
    // Datos del 18 al 31 de mayo y del 1 al 2 de junio: el mapa no debe
    // inventarse los días de junio que todavía no existen.
    const filas = [
      ...enumerarDias("2026-05-18", "2026-05-31").map((f) => dia(f, 30)),
      ...enumerarDias("2026-06-01", "2026-06-02").map((f) => dia(f, 30)),
    ];
    const meses = mesesDeCobertura(resumirCobertura(filas), false);
    expect(meses.map((m) => m.mes)).toEqual(["2026-05", "2026-06"]);

    const junio = meses[1];
    expect(junio.label).toBe("jun 2026");
    expect(junio.primerDia).toBe("2026-06-01");
    // 1 y 2 de junio de 2026 son lunes y martes: 2 laborables, los 2 con datos.
    expect(junio.laborables).toBe(2);
    expect(junio.diasConRegistros).toBe(2);

    const mayo = meses[0];
    // Del 18 al 31 de mayo hay 10 laborables (lun-vie); todos volcados.
    expect(mayo.laborables).toBe(10);
    expect(mayo.diasConRegistros).toBe(10);
  });

  it("marca los meses del medio sin datos, que es justo lo que se quería ver", () => {
    const meses = mesesDeCobertura(
      resumirCobertura([dia("2026-05-18", 30), dia("2026-07-06", 30)]),
      false,
    );
    expect(meses.map((m) => m.mes)).toEqual(["2026-05", "2026-06", "2026-07"]);
    expect(meses[1].diasConRegistros).toBe(0);
    expect(meses[1].laborables).toBeGreaterThan(0);
  });

  it("sin histórico no hay mapa", () => {
    expect(mesesDeCobertura(resumirCobertura([]), false)).toEqual([]);
  });
});

describe("contarMarcasPorDia", () => {
  it("cuenta marcas y presencias por fecha a partir de la asistencia cargada", () => {
    const porDia = contarMarcasPorDia({
      t1: [
        { date: "2026-05-18", presente: true },
        { date: "2026-05-19", presente: false },
      ],
      t2: [
        { date: "2026-05-18", presente: false },
        { date: "2026-05-19", presente: null },
      ],
    });
    expect(porDia.get("2026-05-18")).toEqual({ registros: 2, presentes: 1 });
    expect(porDia.get("2026-05-19")).toEqual({ registros: 2, presentes: 0 });
    expect(porDia.has("2026-05-20")).toBe(false);
  });
});

describe("resumirTrabajadoresPeriodo / totalesPeriodo", () => {
  const base: FaltasSemanalesRow = {
    trabajadorId: "t1",
    nombre: "Ana",
    zona: "Mallas",
    days: {},
    totalFaltas: 0,
    totalBajas: 0,
    totalPresentes: 0,
    totalSinRegistrar: 0,
  };

  it("el porcentaje deja fuera los días sin marcar", () => {
    // 8 presentes, 2 faltas y 5 días sin volcar: el porcentaje es 8/10, no
    // 8/15. Un día que nadie ha volcado no es una falta de nadie.
    const [row] = resumirTrabajadoresPeriodo([
      { ...base, totalPresentes: 8, totalFaltas: 2, totalSinRegistrar: 5 },
    ]);
    expect(row.diasComputados).toBe(10);
    expect(row.pctAsistencia).toBeCloseTo(80);
  });

  it("las bajas laborales cuentan en el denominador", () => {
    const [row] = resumirTrabajadoresPeriodo([
      { ...base, totalPresentes: 5, totalFaltas: 0, totalBajas: 5 },
    ]);
    expect(row.diasComputados).toBe(10);
    expect(row.pctAsistencia).toBeCloseTo(50);
  });

  it("sin ningún día marcado no se inventa un 0 % ni un 100 %", () => {
    const [row] = resumirTrabajadoresPeriodo([{ ...base, totalSinRegistrar: 20 }]);
    expect(row.diasComputados).toBe(0);
    expect(row.pctAsistencia).toBe(0);
  });

  it("los totales suman por trabajador y cuentan una vez a cada uno con baja", () => {
    const totales = totalesPeriodo([
      { ...base, totalPresentes: 8, totalFaltas: 2, totalBajas: 3, totalSinRegistrar: 1 },
      { ...base, trabajadorId: "t2", nombre: "Luis", totalPresentes: 10, totalBajas: 0 },
    ]);
    expect(totales).toEqual({ presentes: 18, faltas: 2, bajas: 3, sinRegistrar: 1, conBaja: 1 });
  });
});

describe("trocear", () => {
  it("parte la lista en tandas del tamaño pedido sin perder elementos", () => {
    expect(trocear([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(trocear([], 10)).toEqual([]);
    expect(trocear([1, 2], 10)).toEqual([[1, 2]]);
  });

  it("un tamaño de 0 sería un bucle infinito: se rechaza", () => {
    expect(() => trocear([1], 0)).toThrow();
  });
});

describe("formatFechaLarga", () => {
  it("escribe la fecha como se lee en los textos de cobertura", () => {
    expect(formatFechaLarga("2026-05-18")).toBe("18 may 2026");
  });
});
