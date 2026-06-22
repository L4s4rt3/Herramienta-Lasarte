import { describe, expect, it } from "vitest";
import {
  aggregateVentasCategoria,
  calcularCampanaVentas,
  calcularMesVentas,
  calcularPmVenta,
  calcularPrecioReal,
  normalizeVentasCategoriaLinea,
  parseVentasCategoriaWorkbookRows,
  validateVentasCategoriaImport,
} from "./ventasCategoria";

const baseLine = {
  fecha: "2025-10-05",
  cliente_codigo: "C001",
  cliente_nombre: "Cliente Uno",
  referencia: "LN211",
  articulo: "Articulo A",
  metodo_producto: "LN211",
  kilos: 100,
  pvp: 0.65,
  base_iva: 65,
};

describe("ventas categoria helpers", () => {
  it("calcula campana comercial desde septiembre hasta agosto", () => {
    expect(calcularCampanaVentas("2021-09-01")).toBe("2122");
    expect(calcularCampanaVentas("2022-01-15")).toBe("2122");
    expect(calcularCampanaVentas("2022-08-31")).toBe("2122");
    expect(calcularCampanaVentas("2022-09-01")).toBe("2223");
  });

  it("calcula mes en formato YYYY-MM", () => {
    expect(calcularMesVentas("2026-06-18")).toBe("2026-06");
  });

  it("calcula PM venta como base IVA entre kilos y protege kilos cero", () => {
    expect(calcularPmVenta(50, 100)).toBe(0.5);
    expect(calcularPmVenta(50, 0)).toBe(0);
  });

  it("calcula precio real restando comision y transporte en porcentaje y centimos/kg", () => {
    expect(calcularPrecioReal(1, {
      comision_pct: 5,
      comision_cent_kg: 2,
      transporte_pct: 1,
      transporte_cent_kg: 3,
    })).toBeCloseTo(0.89, 6);
  });

  it("normaliza una linea diaria con campana, mes y PM venta", () => {
    expect(normalizeVentasCategoriaLinea(baseLine)).toMatchObject({
      campana: "2526",
      mes: "2025-10",
      pm_venta: 0.65,
    });
  });

  it("agrega clientes, productos, articulos exactos y meses manteniendo el total de la categoria", () => {
    const result = aggregateVentasCategoria([
      normalizeVentasCategoriaLinea(baseLine),
      normalizeVentasCategoriaLinea({
        ...baseLine,
        cliente_codigo: "C002",
        cliente_nombre: "Cliente Dos",
        articulo: "Articulo B",
        metodo_producto: "LN210",
        kilos: 50,
        base_iva: 40,
      }),
    ]);

    expect(result.resumen.kilos).toBe(150);
    expect(result.clientes[0]).toMatchObject({ cliente_codigo: "C001", kilos: 100 });
    expect(result.productos.map((row) => row.kilos).reduce((sum, kg) => sum + kg, 0)).toBe(150);
    expect(result.articulos.map((row) => row.kilos).reduce((sum, kg) => sum + kg, 0)).toBe(150);
    expect(result.mensualCliente[0]).toMatchObject({ mes: "2025-10", cliente_codigo: "C001", kilos: 100 });
  });

  it("valida que lineas y catalogo cuadren por kilos y base IVA", () => {
    const validation = validateVentasCategoriaImport({
      lineas: [
        normalizeVentasCategoriaLinea(baseLine),
        normalizeVentasCategoriaLinea({ ...baseLine, kilos: 50, base_iva: 25 }),
      ],
      catalogo: [
        { metodo: "LN211", descripcion: "Producto", lineas: 2, kilos: 150, base_iva: 90 },
      ],
    });

    expect(validation.kilosLineas).toBe(150);
    expect(validation.kilosCatalogo).toBe(150);
    expect(validation.baseIvaLineas).toBe(90);
    expect(validation.diferenciaKilos).toBe(0);
    expect(validation.status).toBe("ok");
  });

  it("parsea el workbook consolidado con hojas Base diaria y Productos catalogo", () => {
    const parsed = parseVentasCategoriaWorkbookRows({
      "Base diaria": [
        ["Titulo"],
        ["Fecha", "Campaña", "Mes etiqueta", "Cliente", "Cliente nombre", "Referencia", "Articulo", "Grupo producto", "Kilos", "PVP", "PM Venta bruto", "Base Iva bruto"],
        ["9/7/21", "2122", "2021-09", "430000291", "GRUPO HERMANOS MARTIN S.A.", "10003764", "NAR VALENCIA SAF", "L1511 - Generica girsac 10x2", "1,028", "0.78 €", "0.75 €", "767.99 €"],
      ],
      "Productos catalogo": [
        ["Titulo"],
        ["Metodo", "Descripcion", "Líneas", "KILOS", "PM Venta", "LITROS", "Base Iva"],
        ["L1511", "Generica girsac 10x2", "1", "1,028", "0.75 €", "0", "767.99 €"],
      ],
    });

    expect(parsed.lineas[0]).toMatchObject({
      fecha: "2021-09-07",
      campana: "2122",
      mes: "2021-09",
      cliente_codigo: "430000291",
      metodo_producto: "L1511",
      kilos: 1028,
      base_iva: 767.99,
    });
    expect(parsed.catalogo[0]).toMatchObject({ metodo: "L1511", kilos: 1028, base_iva: 767.99 });
    expect(parsed.validation.status).toBe("ok");
  });
});
