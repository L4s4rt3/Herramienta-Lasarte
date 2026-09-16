import { describe, it, expect } from "vitest";
import {
  buscarParcelas,
  calibreDeParcela,
  catalogoParcelas,
  claveParcela,
  curvasDeParcela,
  partirClave,
  totalesCampo,
  totalesParcelas,
  unirFichasDeCampo,
  type CampoParcelaRow,
  type CurvaCrecimiento,
  type EntradaParcelaInput,
  type MedidaCalibre,
} from "@/lib/campoParcelas";

function entrada(p: Partial<EntradaParcelaInput> & { lote: string }): EntradaParcelaInput {
  return {
    finca: "La Torrecilla",
    parcela: "La Torrecilla Salustiana",
    agricultor: "LASARTE EXPORT S.L. Camba S.C.",
    articulo: "NARANJA SALUSTIANA",
    fecha: "2026-01-15",
    kg_entrada: 20000,
    certificada: false,
    certificado_ggn: null,
    ...p,
  };
}

describe("catalogoParcelas", () => {
  it("agrupa por finca + parcela y suma kg y entradas", () => {
    const filas = catalogoParcelas([
      entrada({ lote: "26011501", kg_entrada: 20000 }),
      entrada({ lote: "26011602", kg_entrada: 15000, fecha: "2026-01-16" }),
      entrada({ lote: "26011703", parcela: "La Torrecilla Lane Late", articulo: "NARANJA LANE LATE", kg_entrada: 30000, fecha: "2026-01-17" }),
    ]);

    expect(filas).toHaveLength(2);
    // De más a menos kg: Salustiana suma 35.000 en dos entradas y va delante
    // de Lane Late, que tiene 30.000 en una.
    expect(filas[0].parcela).toBe("La Torrecilla Salustiana");
    expect(filas[0].kgEntrada).toBe(35000);
    expect(filas[0].entradas).toBe(2);
    expect(filas[0].lotes).toEqual(["26011501", "26011602"]);
    expect(filas[1].parcela).toBe("La Torrecilla Lane Late");
    expect(filas[1].kgEntrada).toBe(30000);
  });

  it("la misma parcela en dos fincas son dos filas", () => {
    const filas = catalogoParcelas([
      entrada({ lote: "26011501", finca: "Finca A", parcela: "Parcela 1" }),
      entrada({ lote: "26011502", finca: "Finca B", parcela: "Parcela 1" }),
    ]);
    expect(filas).toHaveLength(2);
    expect(new Set(filas.map((f) => f.finca))).toEqual(new Set(["Finca A", "Finca B"]));
  });

  it("descarta las entradas sin finca y marca las que no traen parcela", () => {
    const filas = catalogoParcelas([
      entrada({ lote: "26011501", finca: "" }),
      entrada({ lote: "26011502", finca: null }),
      entrada({ lote: "26011503", parcela: "" }),
    ]);
    expect(filas).toHaveLength(1);
    expect(filas[0].parcela).toBe("");
    expect(filas[0].etiqueta).toBe("(sin parcela)");
  });

  it("guarda la primera y la última entrada, no el orden en que llegaron", () => {
    const filas = catalogoParcelas([
      entrada({ lote: "26030101", fecha: "2026-03-01" }),
      entrada({ lote: "26011501", fecha: "2026-01-15" }),
      entrada({ lote: "26021501", fecha: "2026-02-15" }),
    ]);
    expect(filas[0].primera).toBe("2026-01-15");
    expect(filas[0].ultima).toBe("2026-03-01");
    expect(filas[0].lotes).toEqual(["26011501", "26021501", "26030101"]);
  });

  it("el agricultor es el que más veces aparece y las variedades van de más a menos kg", () => {
    const filas = catalogoParcelas([
      entrada({ lote: "26011501", agricultor: "CAMBA", articulo: "NARANJA SALUSTIANA", kg_entrada: 10000 }),
      entrada({ lote: "26011502", agricultor: "CAMBA", articulo: "NARANJA LANE LATE", kg_entrada: 25000 }),
      entrada({ lote: "26011503", agricultor: "OTRO", articulo: "NARANJA LANE LATE", kg_entrada: 5000 }),
    ]);
    expect(filas[0].agricultor).toBe("CAMBA");
    expect(filas[0].variedades).toEqual(["NARANJA LANE LATE", "NARANJA SALUSTIANA"]);
  });

  it("cuenta las entradas certificadas y se queda con el primer GGN visto", () => {
    const filas = catalogoParcelas([
      entrada({ lote: "26011501", certificada: true, certificado_ggn: "4049928123456" }),
      entrada({ lote: "26011502", certificada: false }),
      entrada({ lote: "26011503", certificada: true, certificado_ggn: "4049928123456" }),
    ]);
    expect(filas[0].entradasCertificadas).toBe(2);
    expect(filas[0].ggn).toBe("4049928123456");
  });

  it("kg nulos cuentan como 0 y no rompen la suma", () => {
    const filas = catalogoParcelas([
      entrada({ lote: "26011501", kg_entrada: null }),
      entrada({ lote: "26011502", kg_entrada: 12000 }),
    ]);
    expect(filas[0].kgEntrada).toBe(12000);
    expect(filas[0].entradas).toBe(2);
  });
});

describe("claveParcela / partirClave", () => {
  it("ida y vuelta, incluso sin parcela", () => {
    expect(partirClave(claveParcela("La Torrecilla", "Salustiana"))).toEqual({ finca: "La Torrecilla", parcela: "Salustiana" });
    expect(partirClave(claveParcela("La Torrecilla", ""))).toEqual({ finca: "La Torrecilla", parcela: "" });
  });
});

describe("buscarParcelas", () => {
  const filas = catalogoParcelas([
    entrada({ lote: "26011501", finca: "INVERMARMELO - GG", parcela: "Parcela Nº3 Delta Seedless", agricultor: "Invermarmelo-FRUBEZAR", articulo: "NAR VAL DELTA SEEDLESS" }),
    entrada({ lote: "26011502", finca: "La Torrecilla", parcela: "La Torrecilla Salustiana", agricultor: "Camba S.C.", articulo: "NARANJA SALUSTIANA" }),
  ]);

  it("sin texto devuelve todo", () => {
    expect(buscarParcelas(filas, "  ")).toHaveLength(2);
  });

  it("busca sin tildes ni mayúsculas en finca, parcela, agricultor y variedad", () => {
    expect(buscarParcelas(filas, "invermarmelo")).toHaveLength(1);
    expect(buscarParcelas(filas, "SALUSTIANA")).toHaveLength(1);
    expect(buscarParcelas(filas, "camba")[0].finca).toBe("La Torrecilla");
    expect(buscarParcelas(filas, "nº3")).toHaveLength(1);
  });

  it("varias palabras tienen que aparecer todas", () => {
    expect(buscarParcelas(filas, "torrecilla salustiana")).toHaveLength(1);
    expect(buscarParcelas(filas, "torrecilla delta")).toHaveLength(0);
  });
});

function ficha(p: Partial<CampoParcelaRow> & { id: string }): CampoParcelaRow {
  return {
    origen: "aerobotics",
    origen_finca_id: "26786",
    origen_finca_nombre: "LASARTE",
    nombre: "Las 16",
    hectareas: 15.43,
    cultivo: "Orange",
    variedad: "Navelina",
    plantacion: null,
    patron: null,
    contorno: [],
    centro_lon: -5.1,
    centro_lat: 37.7,
    finca: "La Torrecilla",
    parcela: "La Torrecilla Salustiana",
    emparejado_estado: "clara",
    emparejado_puntuacion: 1,
    emparejado_nota: null,
    ...p,
  };
}

describe("unirFichasDeCampo", () => {
  const filas = catalogoParcelas([entrada({ lote: "26011501", kg_entrada: 300000 })]);

  it("suma las hectáreas de los trozos que Aerobotics parte en varios polígonos", () => {
    const [fila] = unirFichasDeCampo(filas, [
      ficha({ id: "a", hectareas: 6 }),
      ficha({ id: "b", hectareas: 4 }),
    ]);
    expect(fila.campo.hectareas).toBe(10);
    expect(fila.campo.trozos).toBe(2);
    expect(fila.campo.kgPorHa).toBe(30000);
    expect(fila.campo.rendimientoIncreible).toBe(false);
  });

  it("una propuesta dudosa no suma hectáreas ni divide kilos", () => {
    const [fila] = unirFichasDeCampo(filas, [ficha({ id: "a", hectareas: 6, emparejado_estado: "probable" })]);
    expect(fila.campo.hectareas).toBeNull();
    expect(fila.campo.kgPorHa).toBeNull();
    expect(fila.campo.dudosas).toHaveLength(1);
  });

  it("lo que ha confirmado una persona sí cuenta", () => {
    const [fila] = unirFichasDeCampo(filas, [ficha({ id: "a", hectareas: 10, emparejado_estado: "confirmada" })]);
    expect(fila.campo.hectareas).toBe(10);
    expect(fila.campo.kgPorHa).toBe(30000);
  });

  it("lo descartado no cuenta ni como dudoso", () => {
    const [fila] = unirFichasDeCampo(filas, [ficha({ id: "a", hectareas: 10, emparejado_estado: "descartada" })]);
    expect(fila.campo.hectareas).toBeNull();
    expect(fila.campo.dudosas).toHaveLength(0);
  });

  it("marca el rendimiento imposible en vez de esconderlo", () => {
    const [muchos] = unirFichasDeCampo(filas, [ficha({ id: "a", hectareas: 1.5 })]);
    expect(Math.round(muchos.campo.kgPorHa!)).toBe(200000);
    expect(muchos.campo.rendimientoIncreible).toBe(true);

    const [pocos] = unirFichasDeCampo(filas, [ficha({ id: "a", hectareas: 100 })]);
    expect(pocos.campo.kgPorHa).toBe(3000);
    expect(pocos.campo.rendimientoIncreible).toBe(true);
  });

  it("una ficha de otra parcela no se pega a esta", () => {
    const [fila] = unirFichasDeCampo(filas, [ficha({ id: "a", finca: "Otra Finca", parcela: "Otra" })]);
    expect(fila.campo.hectareas).toBeNull();
    expect(fila.campo.fichas).toHaveLength(0);
  });
});

describe("calibreDeParcela", () => {
  const fichas = [ficha({ id: "p1" }), ficha({ id: "p2" })];
  const medida = (p: Partial<MedidaCalibre> & { id: string }): MedidaCalibre => ({
    finca_nombre: "LASARTE", bloque: "Las 16", variedad: "Navelina",
    semana: "2026W37", mm: 60, tipo: "medida", mm_previsto: null, previsto_en: null,
    parcela_id: "p1", ...p,
  });

  it("promedia los bloques que caen en la misma parcela", () => {
    const c = calibreDeParcela(fichas, [
      medida({ id: "a", semana: "2026W37", mm: 60, parcela_id: "p1" }),
      medida({ id: "b", semana: "2026W37", mm: 70, parcela_id: "p2", bloque: "Las 16 bis" }),
    ]);
    expect(c.puntos).toHaveLength(1);
    expect(c.puntos[0].medido).toBe(65);
    expect(c.bloques).toEqual(["Las 16", "Las 16 bis"]);
  });

  it("la previsión arranca donde acaba lo medido, para que las líneas se toquen", () => {
    const c = calibreDeParcela(fichas, [
      medida({ id: "a", semana: "2026W36", mm: 58 }),
      medida({ id: "b", semana: "2026W37", mm: 62 }),
      medida({ id: "c", semana: "2026W41", mm: 68, tipo: "prevision" }),
    ]);
    expect(c.puntos.map((p) => p.semana)).toEqual(["2026W36", "2026W37", "2026W41"]);
    // La última medida lleva también valor previsto: es el empalme.
    expect(c.puntos[1]).toEqual({ semana: "2026W37", medido: 62, previsto: 62 });
    expect(c.ultimaMedida).toEqual({ semana: "2026W37", mm: 62 });
    expect(c.ultimaPrevision).toEqual({ semana: "2026W41", mm: 68 });
  });

  it("compara lo previsto con lo que salió cuando la semana ya ha llegado", () => {
    const c = calibreDeParcela(fichas, [
      medida({ id: "a", semana: "2026W37", mm: 62, mm_previsto: 60, previsto_en: "2026-08-01" }),
    ]);
    expect(c.aciertos).toEqual([{ semana: "2026W37", previsto: 60, medido: 62, error: 2 }]);
  });

  it("las medidas de otra parcela no se cuelan", () => {
    const c = calibreDeParcela(fichas, [medida({ id: "a", parcela_id: "otra" })]);
    expect(c.puntos).toHaveLength(0);
    expect(c.ultimaMedida).toBeNull();
  });
});

describe("curvasDeParcela", () => {
  const curva = (p: Partial<CurvaCrecimiento> & { id: string }): CurvaCrecimiento => ({
    finca_nombre: "LASARTE", variedad: "Navelina", floracion_semana: "2026W21",
    ventana: "2026W42 - 2027W03", ventana_desde: "2026W42", ventana_hasta: "2027W03",
    crecimiento: {}, fuente: "previous_season_sizes", ...p,
  });

  it("casa por finca y variedad", () => {
    const fichas = [ficha({ id: "p1", origen_finca_nombre: "LASARTE", variedad: "Navelina" })];
    const r = curvasDeParcela(fichas, [
      curva({ id: "c1", variedad: "Navelina" }),
      curva({ id: "c2", variedad: "Lane Late" }),
    ]);
    expect(r.map((c) => c.id)).toEqual(["c1"]);
  });

  it("si la variedad no casa, devuelve las de la finca en vez de dejar la ficha vacía", () => {
    const fichas = [ficha({ id: "p1", origen_finca_nombre: "LASARTE", variedad: "Navel Foyos" })];
    const r = curvasDeParcela(fichas, [curva({ id: "c1" }), curva({ id: "c2", variedad: "Lane Late" })]);
    expect(r).toHaveLength(2);
  });

  it("sin nombre de finca no hay curva que colgar", () => {
    expect(curvasDeParcela([ficha({ id: "p1", origen_finca_nombre: null })], [curva({ id: "c1" })])).toEqual([]);
  });
});

describe("totalesCampo", () => {
  it("la media solo la sostienen las parcelas con cifra creíble", () => {
    const filas = unirFichasDeCampo(
      catalogoParcelas([
        entrada({ lote: "26011501", finca: "F1", parcela: "P1", kg_entrada: 300000 }),
        entrada({ lote: "26011502", finca: "F2", parcela: "P2", kg_entrada: 100000 }),
        entrada({ lote: "26011503", finca: "F3", parcela: "P3", kg_entrada: 999999 }),
      ]),
      [
        ficha({ id: "a", finca: "F1", parcela: "P1", hectareas: 10 }),   // 30.000 kg/ha
        ficha({ id: "b", finca: "F2", parcela: "P2", hectareas: 5 }),    // 20.000 kg/ha
        ficha({ id: "c", finca: "F3", parcela: "P3", hectareas: 1 }),    // 999.999: imposible
      ],
    );
    const t = totalesCampo(filas);
    expect(t.conHectareas).toBe(3);
    expect(t.parcelasCreibles).toBe(2);
    expect(t.aRevisar).toBe(1);
    expect(t.hectareasCreibles).toBe(15);
    expect(t.kgCreibles).toBe(400000);
    expect(Math.round(t.kgPorHaMedio!)).toBe(26667);
  });

  it("sin fichas de campo no hay media que dar", () => {
    const t = totalesCampo(unirFichasDeCampo(catalogoParcelas([entrada({ lote: "26011501" })]), []));
    expect(t.conHectareas).toBe(0);
    expect(t.kgPorHaMedio).toBeNull();
  });
});

describe("totalesParcelas", () => {
  it("cuenta fincas, parcelas, entradas, kg y las que no traen parcela", () => {
    const filas = catalogoParcelas([
      entrada({ lote: "26011501", finca: "Finca A", parcela: "P1", kg_entrada: 1000 }),
      entrada({ lote: "26011502", finca: "Finca A", parcela: "", kg_entrada: 2000 }),
      entrada({ lote: "26011503", finca: "Finca B", parcela: "P1", kg_entrada: 3000 }),
    ]);
    expect(totalesParcelas(filas)).toEqual({ fincas: 2, parcelas: 3, entradas: 3, kgEntrada: 6000, sinParcela: 1 });
  });
});
