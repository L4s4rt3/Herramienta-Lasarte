import { describe, expect, it } from "vitest";
import {
  METODOS_SEGUNDA_POR_DEFECTO,
  categoriaDeMetodo,
  classifyVentasMensual,
  detectVentasMensualFileKind,
  parseSegundaCodigos,
  type VentasMensualInput,
} from "./ventasMensualImport";

const LINEAS_HEADER = [
  "Fecha", "Documento", "Cliente", "CC", "Denominación social", "Matrícula", "Fecha Fra.", "Factura",
  "Lin", "Referencia", "Articulo", "KILOS", "UNID", "LITROS", "Tarifa", "PVP", "CosteAdic", "Base Iva",
];

const METODOS_HEADER = ["Método", "Descripción", "Líneas", "KILOS", "UNID", "LITROS", "Base Iva"];

const METODO_ARCHIVO_HEADER = ["Referencia", "Articulo", "Líneas", "KILOS", "CAJAS", "PALETS", "PM Venta", "Base Iva"];

function lineaRow(overrides: Partial<{
  fecha: string; cliente: string; nombre: string; referencia: string; articulo: string; kilos: string; pvp: string; baseIva: string;
}> = {}) {
  const v = {
    fecha: "9/7/21", cliente: "430000291", nombre: "GRUPO HERMANOS MARTIN S.A.", referencia: "10003764",
    articulo: "NAR VALENCIA SAF", kilos: "100", pvp: "0.78", baseIva: "78.00", ...overrides,
  };
  return [v.fecha, "DOC1", v.cliente, "CC1", v.nombre, "MAT1", "9/7/21", "F1", "1", v.referencia, v.articulo, v.kilos, "50", "0", "1", v.pvp, "0", v.baseIva];
}

function baseInput(overrides: Partial<VentasMensualInput> = {}): VentasMensualInput {
  return {
    lineasRows: [LINEAS_HEADER, lineaRow()],
    metodosCatalogoRows: [METODOS_HEADER, ["", "TOTAL", "10", "1000", "0", "0", "780.00"]],
    metodoArchivos: [],
    segundaCodigos: METODOS_SEGUNDA_POR_DEFECTO,
    ...overrides,
  };
}

describe("detectVentasMensualFileKind", () => {
  it("detecta el fichero de lineas detallado por nombre", () => {
    expect(detectVentasMensualFileKind("Ventas junio 2026 lineas detallado.xlsx")).toEqual({ kind: "lineas" });
  });

  it("detecta el fichero de metodos de confeccion por nombre", () => {
    expect(detectVentasMensualFileKind("Ventas junio 2026 metodos de confeccion.xlsx")).toEqual({ kind: "metodos-catalogo" });
  });

  it("detecta un fichero de metodo por su codigo de nombre", () => {
    expect(detectVentasMensualFileKind("LN211.xlsx")).toEqual({ kind: "metodo", codigo: "LN211" });
    expect(detectVentasMensualFileKind("MA5KGC.xlsx")).toEqual({ kind: "metodo", codigo: "MA5KGC" });
  });

  it("ignora los ficheros opcionales de articulos y clientes", () => {
    expect(detectVentasMensualFileKind("Ventas junio 2026 articulos.xlsx")).toEqual({ kind: "ignorado" });
    expect(detectVentasMensualFileKind("Ventas junio 2026 clientes.xlsx")).toEqual({ kind: "ignorado" });
  });
});

describe("parseSegundaCodigos / categoriaDeMetodo", () => {
  it("normaliza la lista de codigos separados por comas", () => {
    const set = parseSegundaCodigos(" ln211, LN314 ,l1020");
    expect(set.has("LN211")).toBe(true);
    expect(set.has("LN314")).toBe(true);
    expect(set.has("L1020")).toBe(true);
  });

  it("MA* siempre es mercadona aunque este en la lista de segunda", () => {
    const set = parseSegundaCodigos("MA5KGC");
    expect(categoriaDeMetodo("MA5KGC", set)).toBe("mercadona");
  });

  it("un codigo de la lista de segunda es segunda", () => {
    expect(categoriaDeMetodo("LN211", parseSegundaCodigos(METODOS_SEGUNDA_POR_DEFECTO))).toBe("segunda");
  });

  it("cualquier otro codigo es primera", () => {
    expect(categoriaDeMetodo("XYZ999", parseSegundaCodigos(METODOS_SEGUNDA_POR_DEFECTO))).toBe("primera");
  });
});

describe("classifyVentasMensual", () => {
  it("mapea una linea de lineas detallado a VentasCategoriaLineaInput", () => {
    const result = classifyVentasMensual(baseInput());
    expect(result.primera).toHaveLength(1);
    expect(result.primera[0]).toMatchObject({
      fecha: "2021-07-09",
      cliente_codigo: "430000291",
      cliente_nombre: "GRUPO HERMANOS MARTIN S.A.",
      referencia: "10003764",
      articulo: "NAR VALENCIA SAF",
      kilos: 100,
      pvp: 0.78,
      base_iva: 78,
    });
  });

  it("una referencia sin ningun fichero de metodo cae en primera", () => {
    const result = classifyVentasMensual(baseInput());
    expect(result.primera).toHaveLength(1);
    expect(result.segunda).toHaveLength(0);
    expect(result.mercadona).toHaveLength(0);
  });

  it("un metodo MA* clasifica la referencia como mercadona", () => {
    const result = classifyVentasMensual(baseInput({
      metodoArchivos: [{
        codigo: "MA5KGC",
        rows: [METODO_ARCHIVO_HEADER, ["10003764", "NAR VALENCIA SAF", "1", "100", "10", "1", "0.78", "78.00"]],
      }],
    }));
    expect(result.mercadona).toHaveLength(1);
    expect(result.mercadona[0].referencia).toBe("10003764");
    expect(result.primera).toHaveLength(0);
  });

  it("un metodo de la lista de segunda clasifica la referencia como segunda", () => {
    const result = classifyVentasMensual(baseInput({
      metodoArchivos: [{
        codigo: "LN211",
        rows: [METODO_ARCHIVO_HEADER, ["10003764", "NAR VALENCIA SAF", "1", "100", "10", "1", "0.78", "78.00"]],
      }],
    }));
    expect(result.segunda).toHaveLength(1);
    expect(result.segunda[0].metodo_producto).toBe("LN211");
  });

  it("resuelve la referencia ambigua por la categoria que suma mas kg (dominante)", () => {
    const result = classifyVentasMensual(baseInput({
      metodoArchivos: [
        // Segunda (LN211): 40kg
        { codigo: "LN211", rows: [METODO_ARCHIVO_HEADER, ["10003764", "NAR VALENCIA SAF", "1", "40", "4", "1", "0.78", "31.20"]] },
        // Primera (XYZ999): 60kg -> dominante
        { codigo: "XYZ999", rows: [METODO_ARCHIVO_HEADER, ["10003764", "NAR VALENCIA SAF", "1", "60", "6", "1", "0.78", "46.80"]] },
      ],
    }));

    expect(result.ambiguas).toHaveLength(1);
    expect(result.ambiguas[0]).toMatchObject({ referencia: "10003764", dominante: "primera" });
    expect(result.ambiguas[0].categorias.map((c) => c.categoria)).toEqual(["primera", "segunda"]);
    expect(result.primera).toHaveLength(1);
    expect(result.segunda).toHaveLength(0);
  });

  it("excluye una linea con kilos <= 0 como no-producto", () => {
    const result = classifyVentasMensual(baseInput({
      lineasRows: [LINEAS_HEADER, lineaRow({ kilos: "0" })],
    }));
    expect(result.primera).toHaveLength(0);
    expect(result.excluidos).toHaveLength(1);
    expect(result.excluidos[0].motivo).toMatch(/kilos/i);
  });

  it("excluye una linea no-producto por palabra clave en el articulo", () => {
    const result = classifyVentasMensual(baseInput({
      lineasRows: [LINEAS_HEADER, lineaRow({ articulo: "EUROPALET MADERA", referencia: "EP001" })],
    }));
    expect(result.primera).toHaveLength(0);
    expect(result.excluidos).toHaveLength(1);
    expect(result.excluidos[0].motivo).toMatch(/europalet/i);
  });

  it("excluye tambien por palabra clave en la referencia aunque el articulo sea neutro", () => {
    const result = classifyVentasMensual(baseInput({
      lineasRows: [LINEAS_HEADER, lineaRow({ articulo: "SERVICIO VARIO", referencia: "TRANSPORTE-01" })],
    }));
    expect(result.excluidos).toHaveLength(1);
    expect(result.excluidos[0].motivo).toMatch(/transporte/i);
  });

  it("construye el catalogo por categoria a partir de metodos de confeccion", () => {
    const result = classifyVentasMensual(baseInput({
      metodosCatalogoRows: [
        METODOS_HEADER,
        ["", "TOTAL", "10", "1000", "0", "0", "780.00"],
        ["LN211", "Generica segunda", "5", "500", "0", "0", "390.00"],
        ["XYZ999", "Generica primera", "5", "500", "0", "0", "390.00"],
      ],
    }));
    expect(result.catalogoSegunda).toEqual([{ metodo: "LN211", descripcion: "Generica segunda", lineas: 5, kilos: 500, base_iva: 390 }]);
    expect(result.catalogoPrimera).toEqual([{ metodo: "XYZ999", descripcion: "Generica primera", lineas: 5, kilos: 500, base_iva: 390 }]);
  });

  it("calcula totales de lineas y kilos por bucket", () => {
    const result = classifyVentasMensual(baseInput({
      lineasRows: [
        LINEAS_HEADER,
        lineaRow({ referencia: "REF1", kilos: "30" }),
        lineaRow({ referencia: "REF2", kilos: "70" }),
      ],
    }));
    expect(result.totales.primera).toEqual({ lineas: 2, kilos: 100 });
    expect(result.totales.segunda).toEqual({ lineas: 0, kilos: 0 });
  });
});
