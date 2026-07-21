import { describe, expect, it } from "vitest";
import {
  agruparProductoresDuplicados,
  detectarDuplicadosProductores,
  nombreBaseProductor,
  parPorReferencias,
  resolverCadenaFusiones,
  type ProductorFusionInput,
} from "./fusionProductores";

function p(id: string, nombre: string, referencias = 0): ProductorFusionInput {
  return { id, nombre, referencias };
}

describe("nombreBaseProductor", () => {
  it("iguala las variantes reales del catálogo (caso EL ESPARRAGAL)", () => {
    expect(nombreBaseProductor("EL ESPARRAGAL S.A.")).toBe(nombreBaseProductor("EL ESPARRAGAL"));
    expect(nombreBaseProductor("El Esparragal SA")).toBe(nombreBaseProductor("EL ESPARRAGAL"));
    expect(nombreBaseProductor("LASARTE EXPORT EL ESPARRAGAL")).toBe(nombreBaseProductor("EL ESPARRAGAL"));
    expect(nombreBaseProductor("LASARTE EXPORT S.L. El Esparragal")).toBe(nombreBaseProductor("EL ESPARRAGAL"));
  });

  it("quita formas legales pero conserva lo que distingue a productores distintos", () => {
    expect(nombreBaseProductor("Camba S.C.")).toBe("camba");
    expect(nombreBaseProductor("C.B. MOREJON GARCIA")).toBe("morejon garcia");
    expect(nombreBaseProductor("Coop. Regantes - Maria Luisa Garcia"))
      .not.toBe(nombreBaseProductor("Coop. Regantes - Alfonso García"));
    expect(nombreBaseProductor("JOSÉ MARÍA HERRERO")).toBe(nombreBaseProductor("Jose Maria Herrero"));
  });

  it("devuelve cadena vacía si el nombre solo tiene formas legales", () => {
    expect(nombreBaseProductor("S.A.")).toBe("");
    expect(nombreBaseProductor(null)).toBe("");
  });
});

describe("detectarDuplicadosProductores", () => {
  it("agrupa variantes por nombre base y elige canónico el de más referencias", () => {
    const { grupos, ambiguos } = detectarDuplicadosProductores([
      p("a", "EL ESPARRAGAL", 3),
      p("b", "EL ESPARRAGAL S.A.", 218),
      p("c", "LASARTE EXPORT EL ESPARRAGAL", 0),
      p("d", "AGRICOLA SOMISUR S.L.", 40),
    ]);
    expect(ambiguos).toEqual([]);
    expect(grupos).toHaveLength(1);
    expect(grupos[0].canonico).toMatchObject({ id: "b" });
    expect(grupos[0].duplicados.map((d) => d.id)).toEqual(["a", "c"]);
  });

  it("agrupa nombres PARCIALES cuando solo encajan con un productor", () => {
    const { grupos, ambiguos } = detectarDuplicadosProductores([
      p("somisur-corto", "SOMISUR", 7),
      p("somisur", "AGRICOLA SOMISUR S.L.", 40),
      p("juarranz-corto", "JUARRANZ", 2),
      p("juarranz", "JUARRANZ ROMERO, JOSE MARIA", 30),
      p("josefa-corta", "Josefa Gomez", 1),
      p("josefa", "LASARTE EXPORT S.L. Josefa Gomez Dominguez", 25),
    ]);
    expect(ambiguos).toEqual([]);
    expect(grupos).toHaveLength(3);
    const porCanonico = new Map(grupos.map((g) => [g.canonico.id, g.duplicados.map((d) => d.id)]));
    expect(porCanonico.get("somisur")).toEqual(["somisur-corto"]);
    expect(porCanonico.get("juarranz")).toEqual(["juarranz-corto"]);
    expect(porCanonico.get("josefa")).toEqual(["josefa-corta"]);
  });

  it("tolera erratas de una letra en palabras largas", () => {
    const { grupos } = detectarDuplicadosProductores([
      p("bien", "EL ESPARRAGAL S.A.", 218),
      p("errata", "EL ESPARAGAL", 1),
    ]);
    expect(grupos).toHaveLength(1);
    expect(grupos[0].canonico.id).toBe("bien");
  });

  it("un nombre parcial que encaja con VARIOS productores queda como ambiguo, sin fusionar", () => {
    const { grupos, ambiguos } = detectarDuplicadosProductores([
      p("carranza-corto", "CARRANZA", 4),
      p("naranjo", "LASARTE EXPORT S.L.  Carranza Naranjo", 30),
      p("pelaez", "LASARTE EXPORT S.L. Carranza Pelaez", 20),
    ]);
    expect(grupos).toEqual([]);
    expect(ambiguos).toHaveLength(1);
    expect(ambiguos[0].productor.id).toBe("carranza-corto");
    expect(ambiguos[0].candidatos.map((c) => c.id).sort()).toEqual(["naranjo", "pelaez"]);
  });

  it("NO fusiona productores realmente distintos", () => {
    const { grupos, ambiguos } = detectarDuplicadosProductores([
      p("a", "Coop. Regantes - Maria Luisa Garcia", 5),
      p("b", "Coop. Regantes - Alfonso Garcia", 5),
      p("c", "LASARTE EXPORT S.L. Citricos Mayor SL", 10),
      p("d", "LASARTE EXPORT S.L. Citricos Tharsis S.L.", 10),
      p("e", "LASARTE EXPORT S.L. Green Fruits SCV", 3),
    ]);
    expect(grupos).toEqual([]);
    expect(ambiguos).toEqual([]);
  });

  it("palabras genéricas del sector no bastan para agrupar", () => {
    const { grupos, ambiguos } = detectarDuplicadosProductores([
      p("a", "AGRICOLA", 1),
      p("b", "AGRICOLA SOMISUR S.L.", 40),
      p("c", "AGRICULTURA Y CULTIVOS DISPROSIO", 10),
    ]);
    // "AGRICOLA" a secas no tiene ninguna palabra distintiva: ni grupo ni ambiguo.
    expect(grupos).toEqual([]);
    expect(ambiguos).toEqual([]);
  });

  it("encadena variantes: el parcial se une al grupo del nombre base", () => {
    const { grupos } = detectarDuplicadosProductores([
      p("erp", "EL ESPARRAGAL S.A.", 218),
      p("viejo", "LASARTE EXPORT EL ESPARRAGAL", 0),
      p("calibrador", "ESPARRAGAL", 4),
    ]);
    expect(grupos).toHaveLength(1);
    expect(grupos[0].canonico.id).toBe("erp");
    expect(grupos[0].duplicados.map((d) => d.id).sort()).toEqual(["calibrador", "viejo"]);
  });
});

describe("parPorReferencias", () => {
  it("conserva SIEMPRE la ficha con más datos, elija como elija el admin", () => {
    const erp = p("erp", "LASARTE EXPORT SL Gesfrumed SL", 120);
    const finca = p("finca", "GESFRUMED LA PARRILLA", 8);
    // Da igual el orden de los argumentos: el canónico es el de más referencias.
    expect(parPorReferencias(erp, finca)).toEqual({ canon: erp, dup: finca });
    expect(parPorReferencias(finca, erp)).toEqual({ canon: erp, dup: finca });
  });
});

describe("resolverCadenaFusiones", () => {
  const a = p("a", "A", 1);
  const b = p("b", "B", 2);
  const c = p("c", "C", 3);

  it("resuelve cadenas: si A→B y B→C, A acaba en C", () => {
    const res = resolverCadenaFusiones([
      { dup: a, canon: b },
      { dup: b, canon: c },
    ]);
    expect(res).toEqual([
      { dup: a, canon: c },
      { dup: b, canon: c },
    ]);
  });

  it("resuelve la cadena también si llega en orden inverso", () => {
    const res = resolverCadenaFusiones([
      { dup: b, canon: c },
      { dup: a, canon: b },
    ]);
    expect(res).toEqual([
      { dup: b, canon: c },
      { dup: a, canon: c },
    ]);
  });

  it("corta ciclos y descarta duplicados repetidos y auto-fusiones", () => {
    const res = resolverCadenaFusiones([
      { dup: a, canon: b },
      { dup: b, canon: a },  // cierra ciclo: fuera
      { dup: a, canon: c },  // a ya fusionado: fuera
      { dup: c, canon: c },  // auto-fusión: fuera
    ]);
    expect(res).toEqual([{ dup: a, canon: b }]);
  });
});

describe("agruparProductoresDuplicados (compatibilidad)", () => {
  it("en empate de referencias gana el nombre más largo (suele ser la razón social completa)", () => {
    const grupos = agruparProductoresDuplicados([
      p("corto", "Gesfrumed"),
      p("largo", "LASARTE EXPORT SL Gesfrumed SL"),
    ]);
    expect(grupos[0].canonico.id).toBe("largo");
  });

  it("no agrupa por cadena vacía ni devuelve grupos de uno", () => {
    const grupos = agruparProductoresDuplicados([
      p("x", "S.A."),
      p("y", "S.L."),
      p("z", "PRODUCTOR UNICO", 5),
    ]);
    expect(grupos).toEqual([]);
  });
});
