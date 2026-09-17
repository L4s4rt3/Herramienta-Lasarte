import { describe, expect, it } from "vitest";
import {
  armarInformeCampo, campanaDe, etiquetaSemana, historialFinca, ordinalSemana, parcelasDeFinca,
  partirSemana, resumirPuntos, semanaQueAlcanzaObjetivo,
  type ClasifFincaInput, type EntradaFincaInput, type EntradaInformeCampo, type InformeCampoRow, type PuntoMuestreo,
} from "./campoInforme";
import type { CampoParcelaRow, MedidaCalibre } from "./campoParcelas";

const parcela = (p: Partial<CampoParcelaRow> = {}): CampoParcelaRow => ({
  id: "p1", origen: "aerobotics", origen_finca_id: "1", origen_finca_nombre: "GANCHAL",
  nombre: "GANCHAL", hectareas: 12.5, cultivo: "Orange", variedad: "Salustiana",
  plantacion: null, patron: null, contorno: [], centro_lon: -5.55, centro_lat: 37.66,
  finca: "Ganchal", parcela: null, emparejado_estado: "clara", emparejado_puntuacion: 1,
  emparejado_nota: null, ...p,
});

const medida = (semana: string, mm: number, tipo: "medida" | "prevision" = "medida"): MedidaCalibre => ({
  id: `${semana}-${tipo}`, finca_nombre: "GANCHAL", bloque: "GANCHAL", variedad: "Salustiana",
  semana, mm, tipo, mm_previsto: null, previsto_en: null, parcela_id: "p1",
});

const punto = (codigo: string, mm: number, orden: number): PuntoMuestreo => ({
  id: codigo, codigo, mm, lat: 37.6, lon: -5.5, semana: "2026W36", nota: null, orden,
});

const informeBase: InformeCampoRow = {
  id: "i1", finca: "Ganchal", fecha_visita: "2026-09-04", personal: "José María y Luis Navas",
  apoyo_tecnico: "Aerobotics", semana_muestreo: "2026W36", objetivo_mm: 64, objetivo_nota: "Cítrica",
  horizonte_semana: null, antecedentes: null, contexto: null, conclusion: null, estado: "borrador",
};

const entrada = (e: Partial<EntradaInformeCampo> = {}): EntradaInformeCampo => ({
  informe: informeBase,
  parcelas: [parcela()],
  medidas: [medida("2026W36", 59.4), medida("2026W38", 61.2), medida("2026W45", 63.1, "prevision"), medida("2026W49", 64.8, "prevision")],
  curvas: [],
  puntos: [punto("P1", 61.6, 1), punto("P2", 60.9, 2), punto("P3", 58.3, 3), punto("P4", 58.3, 4), punto("P5", 59.6, 5)],
  imagenes: [],
  entradas: [],
  clasif: [],
  ...e,
});

describe("semanas ISO", () => {
  it("acepta el formato de Aerobotics y el del resto del proyecto", () => {
    expect(partirSemana("2026W36")).toEqual({ anio: 2026, semana: 36 });
    expect(partirSemana("2026-W36")).toEqual({ anio: 2026, semana: 36 });
    expect(partirSemana("2026W54")).toBeNull();
    expect(partirSemana(null)).toBeNull();
    expect(etiquetaSemana("2026W36")).toBe("Semana 36");
    expect(etiquetaSemana("nada")).toBe("—");
  });

  it("ordena semanas de distintos años", () => {
    expect(ordinalSemana("2026W52")!).toBeLessThan(ordinalSemana("2027W01")!);
  });
});

describe("semanaQueAlcanzaObjetivo", () => {
  it("prefiere lo medido cuando ya se alcanzó", () => {
    const calibre = { puntos: [{ semana: "2026W38", medido: 65, previsto: null }], bloques: [], ultimaMedida: null, ultimaPrevision: null, aciertos: [] };
    expect(semanaQueAlcanzaObjetivo(calibre, 64)).toEqual({ semana: "2026W38", mm: 65, tipo: "medida" });
  });

  it("usa la previsión cuando todavía no se ha alcanzado", () => {
    const calibre = {
      puntos: [
        { semana: "2026W38", medido: 61.2, previsto: null },
        { semana: "2026W45", medido: null, previsto: 63.1 },
        { semana: "2026W49", medido: null, previsto: 64.8 },
      ],
      bloques: [], ultimaMedida: null, ultimaPrevision: null, aciertos: [],
    };
    expect(semanaQueAlcanzaObjetivo(calibre, 64)).toEqual({ semana: "2026W49", mm: 64.8, tipo: "prevision" });
  });

  it("devuelve null si ni la previsión llega: no se estira la curva", () => {
    const calibre = { puntos: [{ semana: "2026W49", medido: null, previsto: 62 }], bloques: [], ultimaMedida: null, ultimaPrevision: null, aciertos: [] };
    expect(semanaQueAlcanzaObjetivo(calibre, 64)).toBeNull();
  });
});

describe("resumirPuntos", () => {
  it("saca la media simple de los cinco puntos de Ganchal", () => {
    const r = resumirPuntos(entrada().puntos, 64, "2026W36");
    expect(r.media).toBeCloseTo(59.74, 2);
    expect(r.minimo).toBe(58.3);
    expect(r.maximo).toBe(61.6);
    expect(r.difObjetivo).toBeCloseTo(-4.26, 2);
    expect(r.porEncima).toBe(0);
  });

  it("sin puntos no hay media 0: no hay media", () => {
    const r = resumirPuntos([], 64, null);
    expect(r.media).toBeNull();
    expect(r.difObjetivo).toBeNull();
  });
});

describe("historial de la finca", () => {
  const entradas: EntradaFincaInput[] = [
    { finca: "Ganchal", lote: "26022007", fecha: "2026-02-20", articulo: "NARANJA SALUSTIANA", kg_entrada: 20000 },
    { finca: "Ganchal", lote: "25101501", fecha: "2025-10-15", articulo: "NARANJA SALUSTIANA", kg_entrada: 10000 },
  ];
  const clasif: ClasifFincaInput[] = [
    { lote_codigo_base: "26022007", grupo_destino: "EXPORTACION", clase: "Cat1 A", producto: "MDNA 5 KG D-PACK", peso_kg: 12000 },
    { lote_codigo_base: "26022007", grupo_destino: "NO COMERCIAL", clase: "Industria", producto: "INDUSTRIA PARA GARCIA CARRION", peso_kg: 6000 },
    { lote_codigo_base: "26022007", grupo_destino: "NO COMERCIAL", clase: "Podrido", producto: "PODRIDO", peso_kg: 2000 },
    { lote_codigo_base: "OTRO", grupo_destino: "EXPORTACION", clase: "Cat1 A", producto: "MDNA 3 KG", peso_kg: 999 },
  ];

  it("agrupa por campaña de septiembre a agosto", () => {
    expect(campanaDe("2026-02-20")).toBe("2025/26");
    expect(campanaDe("2025-10-15")).toBe("2025/26");
    expect(campanaDe("2026-09-16")).toBe("2026/27");
  });

  it("cuenta los kilos de báscula y los destinos del calibrador por separado", () => {
    const h = historialFinca(entradas, clasif);
    expect(h.kgTotal).toBe(30000);
    expect(h.campanas).toHaveLength(1);
    expect(h.campanas[0].campana).toBe("2025/26");
    expect(h.destino!.kgCalibrados).toBe(20000);
    expect(h.destino!.industria).toBe(6000);
    expect(h.destino!.podrido).toBe(2000);
    expect(h.destino!.mercadona).toBe(12000);
    // El lote ajeno no cuenta y el lote sin clasificación se avisa.
    expect(h.lotesTotal).toBe(2);
    expect(h.lotesSinCalibrador).toBe(1);
  });

  it("las dos lecturas suman cada una el total calibrado, y no se mezclan", () => {
    // Una Extra apilada en el box de industria: exportación arriba, industria abajo.
    const h = historialFinca(
      [{ finca: "X", lote: "L1", fecha: "2026-01-02", articulo: null, kg_entrada: 100 }],
      [
        { lote_codigo_base: "L1", grupo_destino: "EXPORTACION", clase: "Extra 1", producto: "MDNA 3 KG GIRSAC", peso_kg: 700 },
        { lote_codigo_base: "L1", grupo_destino: "EXPORTACION", clase: "Extra 1", producto: "INDUSTRIA PARA GARCIA CARRION", peso_kg: 100 },
        { lote_codigo_base: "L1", grupo_destino: "NO EXPORTACION", clase: "Cat 2", producto: "LA FEA EMP", peso_kg: 150 },
        { lote_codigo_base: "L1", grupo_destino: "NO COMERCIAL", clase: "Podrido", producto: "PODRIDO", peso_kg: 50 },
      ],
    );
    const d = h.destino!;
    expect(d.kgCalibrados).toBe(1000);
    expect(d.exportacion + d.noExportacion + d.mujeres + d.noComercial).toBe(1000);
    expect(d.mercadona + d.otrosClientes + d.industria + d.podrido + d.precalibrado).toBe(1000);
    // La Extra del box de industria está en los dos sitios, cada uno por su lado.
    expect(d.exportacion).toBe(800);
    expect(d.industria).toBe(100);
  });

  it("el podrido no se cuenta como industria aunque viaje en su box", () => {
    const h = historialFinca(
      [{ finca: "X", lote: "L1", fecha: "2026-01-02", articulo: null, kg_entrada: 100 }],
      [{ lote_codigo_base: "L1", grupo_destino: "NO COMERCIAL", clase: "Podrido", producto: "INDUSTRIA PARA GARCIA CARRION", peso_kg: 50 }],
    );
    expect(h.destino!.industria).toBe(0);
    expect(h.destino!.podrido).toBe(50);
  });

  it("sin lotes calibrados no inventa destinos", () => {
    const h = historialFinca(entradas, []);
    expect(h.destino).toBeNull();
  });
});

describe("armarInformeCampo", () => {
  it("casa las parcelas por el nombre de báscula o el de Aerobotics", () => {
    expect(parcelasDeFinca([parcela()], "Ganchal")).toHaveLength(1);
    expect(parcelasDeFinca([parcela({ finca: null })], "GANCHAL")).toHaveLength(1);
    expect(parcelasDeFinca([parcela()], "Otra")).toHaveLength(0);
  });

  it("escribe los textos con los datos cuando nadie los ha escrito", () => {
    const inf = armarInformeCampo(entrada());
    expect(inf.textos.contexto).toContain("José María y Luis Navas");
    expect(inf.textos.contexto).toContain("5 puntos");
    expect(inf.textos.criterio).toContain("64 mm");
    expect(inf.textos.criterio).toContain("Semana 49".toLowerCase());
    expect(inf.textos.conclusion).toContain("59,7 mm");
    expect(inf.objetivo).toEqual({ semana: "2026W49", mm: 64.8, tipo: "prevision" });
    expect(inf.horizonte).toBe("2026W49");
  });

  it("el texto de la persona manda sobre el generado", () => {
    const inf = armarInformeCampo(entrada({
      informe: { ...informeBase, antecedentes: "Lo escribo yo.", conclusion: "Y la conclusión también." },
    }));
    expect(inf.textos.antecedentes).toBe("Lo escribo yo.");
    expect(inf.textos.conclusion).toBe("Y la conclusión también.");
  });

  it("dice lo que falta en vez de callarlo", () => {
    const inf = armarInformeCampo(entrada({ puntos: [], medidas: [], parcelas: [] }));
    expect(inf.faltan.some((f) => f.includes("puntos de muestreo"))).toBe(true);
    // Sin contorno ni coordenadas, el mapa no se puede dibujar: se dice así.
    expect(inf.faltan.some((f) => f.includes("no hay contorno ni coordenadas"))).toBe(true);
    expect(inf.faltan.some((f) => f.includes("Aerobotics no tiene medidas"))).toBe(true);
    expect(inf.faltan.some((f) => f.includes("parcelas dibujadas"))).toBe(true);
    expect(inf.puntos.media).toBeNull();
    expect(inf.textos.conclusion).toContain("No hay medidas de calibre");
  });

  it("con coordenadas, el mapa no se pide: se ofrece dibujarlo", () => {
    const inf = armarInformeCampo(entrada());
    expect(inf.faltan.some((f) => f.includes("Dibujar el mapa"))).toBe(true);
  });

  it("avisa cuando la curva es la media de la comarca y no fruta de la finca", () => {
    const inf = armarInformeCampo(entrada({
      curvas: [{
        id: "c1", finca_nombre: "GANCHAL", variedad: "Salustiana", floracion_semana: null,
        ventana: null, ventana_desde: null, ventana_hasta: null, crecimiento: {}, fuente: "region_cultivar_default",
      }],
    }));
    expect(inf.avisoCurva).toContain("media de la comarca");
    expect(inf.textos.criterio).toContain("media de la comarca");
  });

  it("cuando el calibre ya se alcanzó, lo dice como medida y no como previsión", () => {
    const inf = armarInformeCampo(entrada({ medidas: [medida("2026W38", 65.2)] }));
    expect(inf.objetivo!.tipo).toBe("medida");
    expect(inf.textos.criterio).toContain("ya supera");
  });
});
