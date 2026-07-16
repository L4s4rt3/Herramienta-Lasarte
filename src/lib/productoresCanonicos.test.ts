import { describe, expect, it } from "vitest";
import {
  esEntradaCampoCit,
  esEntradaPrecalibrado,
  esErrorTablaOColumnaInexistente,
  esPaletPrecalibrado,
  esProductorPrecalibrado,
  normalizeProductorName,
  productorNoCoincide,
  resolveProductorGroupKey,
} from "./productoresCanonicos";

describe("normalizeProductorName", () => {
  it("minúsculas, sin tildes y con trim", () => {
    expect(normalizeProductorName("  Invermarmelo Ñíguez  ")).toBe("invermarmelo niguez");
  });

  it("null/undefined -> cadena vacía", () => {
    expect(normalizeProductorName(null)).toBe("");
    expect(normalizeProductorName(undefined)).toBe("");
  });
});

describe("resolveProductorGroupKey", () => {
  const sinAlias = new Map<string, string>();

  it("prioriza el id directo de la fila si existe", () => {
    const alias = new Map([["invermarmelo", "alias-id"]]);
    const r = resolveProductorGroupKey("INVERMARMELO", "directo-id", alias);
    expect(r).toEqual({ key: "id:directo-id", productorId: "directo-id" });
  });

  it("resuelve por alias cuando no hay id directo", () => {
    const alias = new Map([["invermarmelo", "alias-id"]]);
    const r = resolveProductorGroupKey("Invermarmelo", null, alias);
    expect(r).toEqual({ key: "id:alias-id", productorId: "alias-id" });
  });

  it("el alias se busca por el nombre normalizado (tildes/mayúsculas/espacios)", () => {
    const alias = new Map([["finca el nino", "alias-id"]]);
    const r = resolveProductorGroupKey("  FINCA EL NIÑO  ", undefined, alias);
    expect(r.productorId).toBe("alias-id");
  });

  it("sin id directo ni alias, cae al texto crudo SIN normalizar (paridad con el comportamiento previo al catálogo)", () => {
    const r = resolveProductorGroupKey("INVERMARMELO", null, sinAlias);
    expect(r).toEqual({ key: "nombre:INVERMARMELO", productorId: null });
  });

  it("PARIDAD: con el mapa de alias vacío y sin ids, dos variantes de texto distinto NUNCA se fusionan (igual que hoy)", () => {
    const a = resolveProductorGroupKey("INVERMARMELO", null, sinAlias);
    const b = resolveProductorGroupKey("Invermarmelo", null, sinAlias);
    expect(a.key).not.toBe(b.key);
  });
});

describe("productorNoCoincide", () => {
  it("sin id en ninguno de los dos lados, compara por texto normalizado", () => {
    expect(productorNoCoincide({ id: null, nombre: "INVERMARMELO" }, { id: null, nombre: "Invermarmelo" })).toBe(false);
    expect(productorNoCoincide({ id: null, nombre: "Finca A" }, { id: null, nombre: "Finca B" })).toBe(true);
  });

  it("con id en ambos lados, compara por id (fuente de verdad) aunque el texto coincida", () => {
    expect(productorNoCoincide({ id: "p1", nombre: "Invermarmelo" }, { id: "p1", nombre: "Invermarmelo" })).toBe(false);
    expect(productorNoCoincide({ id: "p1", nombre: "Invermarmelo" }, { id: "p2", nombre: "Invermarmelo" })).toBe(true);
  });

  it("si falta el nombre en cualquiera de los dos lados, no hay aviso (evita falsos positivos)", () => {
    expect(productorNoCoincide({ id: null, nombre: "" }, { id: null, nombre: "Finca A" })).toBe(false);
    expect(productorNoCoincide({ id: null, nombre: "Finca A" }, { id: null, nombre: null })).toBe(false);
    expect(productorNoCoincide({ id: null, nombre: undefined }, { id: null, nombre: undefined })).toBe(false);
  });

  it("un solo lado con id no fuerza la comparación por id (se necesitan los dos)", () => {
    // Con solo un id, no se puede afirmar que sean el mismo catálogo: se compara por texto.
    expect(productorNoCoincide({ id: "p1", nombre: "Invermarmelo" }, { id: null, nombre: "invermarmelo" })).toBe(false);
  });
});

// ─── El precalibrado no cuenta (decisión del dueño, 2026-07-15) ──────────────

describe("esProductorPrecalibrado", () => {
  it("casa el pseudo-productor PRECALIBRADO con mayúsculas, tildes y espacios de borde indiferentes", () => {
    expect(esProductorPrecalibrado("PRECALIBRADO")).toBe(true);
    expect(esProductorPrecalibrado("precalibrado")).toBe(true);
    expect(esProductorPrecalibrado("  Precalibrado  ")).toBe(true);
    expect(esProductorPrecalibrado("PRECALÍBRADO")).toBe(true); // tilde accidental en el dato de origen
  });

  it("null/undefined/vacío -> false", () => {
    expect(esProductorPrecalibrado(null)).toBe(false);
    expect(esProductorPrecalibrado(undefined)).toBe(false);
    expect(esProductorPrecalibrado("")).toBe(false);
    expect(esProductorPrecalibrado("   ")).toBe(false);
  });

  it("no casa productores reales ni nombres que solo CONTIENEN el texto (igualdad exacta, no patrón)", () => {
    expect(esProductorPrecalibrado("INVERMARMELO")).toBe(false);
    expect(esProductorPrecalibrado("PRECALIBRADOS S.L.")).toBe(false);
    expect(esProductorPrecalibrado("FINCA PRECALIBRADO NORTE")).toBe(false);
  });
});

describe("esPaletPrecalibrado", () => {
  it("casa los valores reales de palets_dia (familia PREC con y sin dígito, PRECALIBRADO)", () => {
    expect(esPaletPrecalibrado("NAR NAVELINA PREC1")).toBe(true);
    expect(esPaletPrecalibrado("NAR LANE LATE PREC2")).toBe(true);
    expect(esPaletPrecalibrado("NAVEL POWEL PRECALIBRADO")).toBe(true);
    expect(esPaletPrecalibrado("SALUSTIANA PRECALIBRADO 6/7/8")).toBe(true);
    expect(esPaletPrecalibrado("PREC 2 CAT 2/3 Y MUJERES")).toBe(true); // "PREC" como palabra suelta
  });

  it("casa también la variante sin C (PRE1/PRE2, misma familia que ya trataba esPaletMercadona)", () => {
    expect(esPaletPrecalibrado("NAR LANE LATE PRE1")).toBe(true);
    expect(esPaletPrecalibrado("NAR VAL DELTA SEEDLESS PRE2")).toBe(true);
  });

  it("indiferente a mayúsculas y tildes", () => {
    expect(esPaletPrecalibrado("nar navelina prec1")).toBe(true);
    expect(esPaletPrecalibrado("navel powel precalibradó")).toBe(true);
  });

  it("NO casa falsos positivos: 'PREC'/'PRE' dentro de otra palabra o sin dígito pegado", () => {
    expect(esPaletPrecalibrado("NAR PRECIOSA CAL5/6")).toBe(false);
    expect(esPaletPrecalibrado("MANDARINA PREMIUM 1")).toBe(false);
    expect(esPaletPrecalibrado("EMPRESA GENERICA")).toBe(false);
    expect(esPaletPrecalibrado("NAR VALENCIA PRE SELECCION")).toBe(false); // "pre" suelto sin dígito no basta
    expect(esPaletPrecalibrado("PRECIO ESPECIAL")).toBe(false);
  });

  it("null/undefined/vacío -> false", () => {
    expect(esPaletPrecalibrado(null)).toBe(false);
    expect(esPaletPrecalibrado(undefined)).toBe(false);
    expect(esPaletPrecalibrado("")).toBe(false);
  });
});

// ─── El precalibrado por el lado de las ENTRADAS: circuito cerrado interno ──
// (cierre definitivo, jul-2026 — ver la nota de evidencia en productoresCanonicos.ts).

describe("esEntradaPrecalibrado", () => {
  // Las 16 combinaciones reales verificadas en BD: finca "PREC 1 ALMACEN" o
  // "PREC 2 ALMACEN" cruzada con 8 variantes reales del agricultor, todas
  // empezando por "LASARTE ALMACEN PRECAL...".
  const FINCAS = ["PREC 1 ALMACEN", "PREC 2 ALMACEN"];
  const AGRICULTORES = [
    "LASARTE ALMACEN PRECALIBRADO",
    "LASARTE ALMACEN PRECALIBRADO 1",
    "LASARTE ALMACEN PRECALIBRADO 2",
    "LASARTE ALMACEN PRECAL 1",
    "LASARTE ALMACEN PRECAL 2",
    "LASARTE ALMACEN PRECAL. NAVEL",
    "LASARTE ALMACEN PRECALIBRADO NAVELINA",
    "LASARTE ALMACEN PRECALIBRADO SALUSTIANA",
  ];

  it("casa las 16 combinaciones reales (finca x agricultor)", () => {
    for (const finca of FINCAS) {
      for (const agricultor of AGRICULTORES) {
        expect(esEntradaPrecalibrado({ agricultor, finca })).toBe(true);
      }
    }
  });

  it("casa por agricultor aunque la finca no diga nada (o sea de campo)", () => {
    expect(esEntradaPrecalibrado({ agricultor: "LASARTE ALMACEN PRECALIBRADO", finca: null })).toBe(true);
    expect(esEntradaPrecalibrado({ agricultor: "LASARTE ALMACEN PRECALIBRADO", finca: "Finca Los Olivos" })).toBe(true);
  });

  it("casa por finca aunque el agricultor no diga nada (o sea un productor real)", () => {
    expect(esEntradaPrecalibrado({ agricultor: null, finca: "PREC 1 ALMACEN" })).toBe(true);
    expect(esEntradaPrecalibrado({ agricultor: "Invermarmelo", finca: "PREC 2 ALMACEN" })).toBe(true);
  });

  it("indiferente a mayúsculas, tildes y espacios múltiples", () => {
    expect(esEntradaPrecalibrado({ agricultor: "lasarte  almacén   precalibrado", finca: null })).toBe(true);
    expect(esEntradaPrecalibrado({ agricultor: null, finca: "prec  1   almacén" })).toBe(true);
  });

  it("NO casa fincas legítimas que solo contienen 'prec' sin dígito pegado", () => {
    expect(esEntradaPrecalibrado({ agricultor: null, finca: "El Precioso" })).toBe(false);
    expect(esEntradaPrecalibrado({ agricultor: null, finca: "Finca Preciados" })).toBe(false);
  });

  it("NO casa agricultores legítimos que solo contienen 'precal'/'prec' sin 'almacen'", () => {
    expect(esEntradaPrecalibrado({ agricultor: "PRECISA S.L.", finca: null })).toBe(false);
    expect(esEntradaPrecalibrado({ agricultor: "PRECALIBRADOS DEL SUR S.L.", finca: null })).toBe(false);
  });

  it("NO casa una finca con 'almacen' sin 'prec+dígito', ni con 'prec+dígito' sin 'almacen'", () => {
    expect(esEntradaPrecalibrado({ agricultor: null, finca: "Almacén General" })).toBe(false);
    expect(esEntradaPrecalibrado({ agricultor: null, finca: "Prec 3 Norte" })).toBe(false);
  });

  it("null/undefined/vacío en ambos campos -> false", () => {
    expect(esEntradaPrecalibrado({ agricultor: null, finca: null })).toBe(false);
    expect(esEntradaPrecalibrado({ agricultor: undefined, finca: undefined })).toBe(false);
    expect(esEntradaPrecalibrado({ agricultor: "", finca: "" })).toBe(false);
  });
});

// ─── CAMPO/CIT no se procesa en la central (decisión del dueño, 2026-07-16) ─

describe("esEntradaCampoCit", () => {
  it("casa las 3 variantes reales de BD (SALUSTIANA/NAVELINA/LANE LATE CAMPO/CIT)", () => {
    expect(esEntradaCampoCit({ articulo: "SALUSTIANA CAMPO/CIT" })).toBe(true);
    expect(esEntradaCampoCit({ articulo: "NAVELINA CAMPO/CIT" })).toBe(true);
    expect(esEntradaCampoCit({ articulo: "LANE LATE CAMPO/CIT" })).toBe(true);
  });

  it("indiferente a mayúsculas, tildes y espacios alrededor de la barra", () => {
    expect(esEntradaCampoCit({ articulo: "salustiana campo/cit" })).toBe(true);
    expect(esEntradaCampoCit({ articulo: "NAVELINA CAMPO / CIT" })).toBe(true);
    expect(esEntradaCampoCit({ articulo: "NAVELINA CAMPO /CIT" })).toBe(true);
    expect(esEntradaCampoCit({ articulo: "NAVELINA CAMPO/ CIT" })).toBe(true);
    expect(esEntradaCampoCit({ articulo: "  Lane Late  Campo/Cit  " })).toBe(true);
  });

  it("NO casa contraejemplos: 'campo' sin '/cit', o 'citrica' sin 'campo/' delante", () => {
    expect(esEntradaCampoCit({ articulo: "NARANJA CAMPO GRANDE" })).toBe(false);
    expect(esEntradaCampoCit({ articulo: "CITRICA" })).toBe(false);
    expect(esEntradaCampoCit({ articulo: "SALUSTIANA" })).toBe(false);
  });

  it("null/undefined/vacío -> false", () => {
    expect(esEntradaCampoCit({ articulo: null })).toBe(false);
    expect(esEntradaCampoCit({ articulo: undefined })).toBe(false);
    expect(esEntradaCampoCit({ articulo: "" })).toBe(false);
  });
});

describe("esErrorTablaOColumnaInexistente", () => {
  it("detecta los códigos de Postgres/PostgREST de tabla o columna inexistente", () => {
    expect(esErrorTablaOColumnaInexistente({ code: "42P01" })).toBe(true);
    expect(esErrorTablaOColumnaInexistente({ code: "42703" })).toBe(true);
    expect(esErrorTablaOColumnaInexistente({ code: "PGRST205" })).toBe(true);
    expect(esErrorTablaOColumnaInexistente({ code: "PGRST204" })).toBe(true);
  });

  it("detecta por mensaje cuando no hay código reconocible", () => {
    expect(esErrorTablaOColumnaInexistente({ message: "relation \"productores_alias\" does not exist" })).toBe(true);
    expect(esErrorTablaOColumnaInexistente({ message: "Could not find the table 'public.productores_alias'" })).toBe(true);
  });

  it("no confunde otros errores con tabla/columna inexistente", () => {
    expect(esErrorTablaOColumnaInexistente({ code: "23505", message: "duplicate key value" })).toBe(false);
    expect(esErrorTablaOColumnaInexistente(null)).toBe(false);
    expect(esErrorTablaOColumnaInexistente(undefined)).toBe(false);
    expect(esErrorTablaOColumnaInexistente("some string")).toBe(false);
  });
});
