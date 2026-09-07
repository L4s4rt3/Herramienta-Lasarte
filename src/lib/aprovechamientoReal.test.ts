// El aprovechamiento REAL por parcela: cada kg del calibrador atribuido a su
// lote sin estimar. Los invariantes: la base son los kg de la máquina, las
// pasadas compuestas se detectan (no se suponen), el respaldo (Word) se cuenta
// aparte, y cada lote sin dato tiene su motivo — nunca "en cámara" si el parte
// dice que ya pasó por línea.
import { describe, expect, it } from "vitest";
import {
  acumularDetalleReal,
  calibresReal,
  clasesReal,
  coberturaReal,
  esFilaRepartida,
  etiquetaParcela,
  frescuraFuentes,
  pasadasCompuestas,
  pasadasDelPartePorLote,
  resumenMetodosReparto,
  resumenReal,
  separarCompuestas,
  TORNILLO_DESCONOCIDO,
  type FilaDetalleReal,
} from "./aprovechamientoReal";

const fila = (p: Partial<FilaDetalleReal> & { lote8: string; kg: number }): FilaDetalleReal => ({
  fecha: "2026-05-20", batchId: 7001, fuente: "calibrador", nombrePasada: p.lote8, producto: "KOLLA LST",
  clase: "Cat1 A", destino: "EXPORTACION", tamano: "3/54", ...p,
});

const FILAS: FilaDetalleReal[] = [
  // Lote A, pasada SQL 7001 (dos filas): el volcado escribe la clase SIN letra y a veces sin destino.
  fila({ lote8: "26052001", kg: 600, clase: "Extra 1 ", destino: null, producto: "MDNA MALLA 3KG CAL 4/5", tamano: "4/70" }),
  fila({ lote8: "26052001", kg: 300, clase: "Cat 2", destino: "NO EXPORTACIÓN", producto: "MDNA GRANEL CAL 3/4" }),
  fila({ lote8: "26052001", kg: 100, clase: "Podrido", destino: "NO COMERCIAL", producto: "INDUSTRIA", tamano: "—" }),
  // Lote A, segunda pasada SQL el mismo día.
  fila({ lote8: "26052001", kg: 200, batchId: 7002, clase: "Mujeres", destino: "MUJERES", producto: "MUJERES" }),
  // Lote B, solo Word de lote (respaldo): trae la letra delante.
  fila({ lote8: "26052002", kg: 500, batchId: -55, fuente: "docx", nombrePasada: "26052002 20 BOX", fecha: "2026-05-21", clase: "(C) Cat1 A", producto: "MDNA 5KG D-PACK" }),
  fila({ lote8: "26052002", kg: 500, batchId: -55, fuente: "docx", nombrePasada: "26052002 20 BOX", fecha: "2026-05-21", clase: "(G) Cat 3", destino: "NO EXPORTACION", producto: "KOLLA LST" }),
  // Lote C: una pasada que nombra DOS lotes.
  fila({ lote8: "26052003", kg: 1000, batchId: 7003, nombrePasada: "26052003-12 BOX + 26052004-9 BOX" }),
];

const PARCELA_DE: Record<string, string> = { "26052001": "Parcela Nº2 Delta Seedless", "26052002": "Parcela Nº2 Delta Seedless", "26052003": "Parcela Nº4 Delta Seedless" };

describe("acumularDetalleReal", () => {
  it("atribuye cada kg a su clave y cuenta las pasadas una vez aunque tengan varias filas", () => {
    const porParcela = acumularDetalleReal(FILAS, (f) => PARCELA_DE[f.lote8]);
    const p2 = porParcela.get("Parcela Nº2 Delta Seedless")!;
    expect(p2.kgSizer).toBe(2200);
    expect(p2.pasadas).toBe(3); // 7001, 7002 y el Word -55
    expect(p2.pasadasDocx).toBe(1);
    expect(p2.kgDocx).toBe(1000);
    expect(porParcela.get("Parcela Nº4 Delta Seedless")!.kgSizer).toBe(1000);
  });

  it("el volcado sin letra ni destino se casa por nombre: apta, destino y podrido salen igual que con el Word", () => {
    const a = acumularDetalleReal(FILAS, (f) => f.lote8).get("26052001")!;
    expect(a.porDestino.get("EXPORTACION")).toBe(600); // "Extra 1 " sin grupo_destino → por la letra A
    expect(a.porDestino.get("NO EXPORTACION")).toBe(300); // acento normalizado
    expect(a.porDestino.get("MUJERES")).toBe(200);
    expect(a.porDestino.get("NO COMERCIAL")).toBe(100);
    expect(a.kgApta).toBe(900); // Extra 1 (A) + Cat 2 (F)
    expect(a.porClase.get("EXTRA 1")).toMatchObject({ kg: 600, apta: true, letra: "A" });
    expect(a.porClase.get("PODRIDO")).toMatchObject({ kg: 100, apta: false, letra: "J" });
    expect(a.porCalibreApta.get("4/70")).toBe(600);
    expect(a.porCalibreApta.get("3/54")).toBe(300);
    expect(a.mdna).toEqual({ MA3KGC: 600, MA4KGC: 0, MA5KGC: 0, MA12KGC: 300 });
    expect(a.mdnaTotal).toBe(900);
  });
});

describe("resumenReal, clasesReal y calibresReal", () => {
  const a = acumularDetalleReal(FILAS, (f) => f.lote8).get("26052001")!;
  it("los porcentajes van sobre lo que pesó la máquina y los destinos cuadran", () => {
    const r = resumenReal(a);
    expect(r.kgSizer).toBe(1200);
    expect(r.pctExportacion).toBeCloseTo(50, 6);
    expect(r.pctMujeres).toBeCloseTo(200 / 12, 6);
    expect(r.kgPodrido).toBe(100);
    expect(r.pctPodrido).toBeCloseTo(100 / 12, 6);
    expect(r.pctApta).toBeCloseTo(75, 6);
    expect(r.pctMdna).toBeCloseTo(75, 6);
    expect(r.pctMdnaFormato.MA3KGC).toBeCloseTo(50, 6);
    expect(r.kgAptoFuera).toBe(0);
    expect(r.kgNoApta).toBe(300);
    expect(r.cuadreDestinos).toBe(0);
  });
  it("el Word cuenta como respaldo, no como canónico", () => {
    const b = acumularDetalleReal(FILAS, (f) => f.lote8).get("26052002")!;
    const r = resumenReal(b);
    expect(r.kgRespaldo).toBe(1000);
    expect(r.pasadasRespaldo).toBe(1);
    expect(r.kgAptoFuera).toBe(0); // 500 aptos (C) y 500 a MDNA
    expect(r.pctApta).toBeCloseTo(50, 6);
  });
  it("clases de más a menos kg; calibres solo de lo apto, con su tornillo", () => {
    expect(clasesReal(a).map((c) => c.clase)).toEqual(["EXTRA 1", "CAT 2", "MUJERES", "PODRIDO"]);
    const cal = calibresReal(a);
    expect(cal).toEqual([
      { calibre: "4/70", kg: 600, pctApta: expect.closeTo(600 / 9, 6), tornillos: "exprimidor + malla 3" },
      { calibre: "3/54", kg: 300, pctApta: expect.closeTo(300 / 9, 6), tornillos: "malla 5 + malla 3 + granel" },
    ]);
    expect(calibresReal(acumularDetalleReal([fila({ lote8: "1", kg: 1, tamano: "9/999" })], (f) => f.lote8).get("1")!)[0].tornillos).toBe(TORNILLO_DESCONOCIDO);
  });
});

describe("pasadasCompuestas", () => {
  it("encuentra las pasadas que nombran más de un lote, una vez cada una; sin fracción siguen EN COLA", () => {
    const c = pasadasCompuestas(FILAS);
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({
      lote8: "26052003", lotes8: ["26052003"], nombre: "26052003-12 BOX + 26052004-9 BOX", fuente: "calibrador",
      kg: 1000, repartida: false, metodo: null,
    });
  });
});

// ─── El reparto canónico de las pasadas compuestas (04-09-2026) ──────────────
// La vista reparte "26052003+26052004" entre sus dos lotes (aquí 60/40 por
// capacidad) y cada fila llega con su fracción y sus kg YA multiplicados. Lo
// repartido se cuenta aparte (es estimación) y la compuesta pasa de "en cola" a
// "repartida"; la 7003, sin fracción, sigue en cola.
const REPARTIDA = { batchId: 7004, nombrePasada: "26052003+26052004", metodoReparto: "capacidad" } as const;
const FILAS_REPARTO: FilaDetalleReal[] = [
  ...FILAS,
  fila({ ...REPARTIDA, lote8: "26052003", kg: 540, fraccion: 0.6, clase: "Extra 1", producto: "MDNA MALLA 3KG CAL 4/5" }),
  fila({ ...REPARTIDA, lote8: "26052003", kg: 60, fraccion: 0.6, clase: "Podrido", destino: "NO COMERCIAL", producto: "INDUSTRIA" }),
  // El numeric de la base puede llegar como texto: se lee igual.
  fila({ ...REPARTIDA, lote8: "26052004", kg: 360, fraccion: "0.4", clase: "Extra 1", producto: "MDNA MALLA 3KG CAL 4/5" }),
  fila({ ...REPARTIDA, lote8: "26052004", kg: 40, fraccion: "0.4", clase: "Podrido", destino: "NO COMERCIAL", producto: "INDUSTRIA" }),
];

describe("reparto canónico de pasadas compuestas", () => {
  it("una fila es repartida solo con fracción < 1; sin fracción o con 1 es entera", () => {
    expect(esFilaRepartida({ fraccion: 0.6 })).toBe(true);
    expect(esFilaRepartida({ fraccion: "0.4" })).toBe(true);
    expect(esFilaRepartida({ fraccion: 1 })).toBe(false);
    expect(esFilaRepartida({ fraccion: 0.9999999 })).toBe(false); // redondeo del numeric, no un reparto
    expect(esFilaRepartida({ fraccion: null })).toBe(false);
    expect(esFilaRepartida({})).toBe(false);
  });

  it("los kg repartidos se suman aparte y la pasada repartida se cuenta una vez por lote", () => {
    const porLote = acumularDetalleReal(FILAS_REPARTO, (f) => f.lote8);
    const a = porLote.get("26052003")!;
    expect(a.kgSizer).toBe(1600); // 1.000 de la 7003 (entera, en cola) + 600 de su parte de la 7004
    expect(a.kgRepartido).toBe(600);
    expect(a.pasadas).toBe(2);
    expect(a.pasadasRepartidas).toBe(1);
    const b = porLote.get("26052004")!;
    expect(b.kgSizer).toBe(400);
    expect(b.kgRepartido).toBe(400);
    expect(b.pasadasRepartidas).toBe(1);
    // Sin fracción (fuentes anteriores al reparto) nada es repartido.
    expect(porLote.get("26052001")!.kgRepartido).toBe(0);
    expect(porLote.get("26052001")!.pasadasRepartidas).toBe(0);
  });

  it("las clases de la parte repartida entran en destinos y aptas como las demás (misma proporción) y el resumen lo dice", () => {
    const porLote = acumularDetalleReal(FILAS_REPARTO, (f) => f.lote8);
    const b = porLote.get("26052004")!;
    expect(b.porDestino.get("EXPORTACION")).toBe(360);
    expect(b.porDestino.get("NO COMERCIAL")).toBe(40);
    expect(b.kgApta).toBe(360);
    const r = resumenReal(b);
    expect(r.kgRepartido).toBe(400);
    expect(r.pctRepartido).toBeCloseTo(100, 6);
    expect(r.pasadasRepartidas).toBe(1);
    expect(resumenReal(porLote.get("26052003")!).pctRepartido).toBeCloseTo(37.5, 6);
    expect(resumenReal(porLote.get("26052001")!)).toMatchObject({ kgRepartido: 0, pctRepartido: 0, pasadasRepartidas: 0 });
  });

  it("pasadasCompuestas distingue la repartida (ámbar) de la que sigue en cola (rojo)", () => {
    const c = pasadasCompuestas(FILAS_REPARTO);
    expect(c).toHaveLength(2);
    const { repartidas, enCola } = separarCompuestas(c);
    expect(enCola).toHaveLength(1);
    expect(enCola[0]).toMatchObject({ clave: "b7003", lote8: "26052003", repartida: false, metodo: null, kg: 1000 });
    expect(repartidas).toHaveLength(1);
    expect(repartidas[0]).toMatchObject({
      clave: "b7004", nombre: "26052003+26052004", repartida: true, metodo: "capacidad", lotes8: ["26052003", "26052004"], kg: 1000,
    });
    expect(resumenMetodosReparto(repartidas)).toBe("1 por la capacidad pendiente de cada lote");
  });

  it("una compuesta con fracción 1 explícita sigue en cola: la vista no la ha repartido", () => {
    const c = pasadasCompuestas([fila({ lote8: "26052003", kg: 1000, batchId: 7005, nombrePasada: "26052003+26052009", fraccion: 1, metodoReparto: null })]);
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ repartida: false, metodo: null });
  });

  it("la cobertura enseña lo repartido por lote y lo dice en el motivo", () => {
    const porLote = acumularDetalleReal(FILAS_REPARTO, (f) => f.lote8);
    const entradas = [
      { lote: "26052003", fecha: "2026-05-18", parcela: "Parcela Nº4 Delta Seedless", kgEntrada: 1500, kgAjuste: 0, cerradoAt: null, camaraConfirmadaNombre: null, camaraConfirmadaFecha: null },
      { lote: "26052001", fecha: "2026-05-18", parcela: "Parcela Nº2 Delta Seedless", kgEntrada: 1100, kgAjuste: 0, cerradoAt: null, camaraConfirmadaNombre: null, camaraConfirmadaFecha: null },
    ];
    const frescura = frescuraFuentes({ ultimaPasadaSql: "2026-05-20", ultimoParte: "2026-05-20" });
    const por = Object.fromEntries(coberturaReal(entradas, porLote, new Map(), frescura).map((f) => [f.lote8, f]));
    expect(por["26052003"].estado).toBe("sql");
    expect(por["26052003"].kgRepartido).toBe(600);
    expect(por["26052003"].motivo).toMatch(/600 kg de 1 pasada\(s\) compuesta\(s\) repartida\(s\): estimación proporcional/);
    expect(por["26052001"].kgRepartido).toBeNull();
    expect(por["26052001"].motivo).not.toMatch(/repartida/);
  });
});

describe("coberturaReal", () => {
  const porLote = acumularDetalleReal(FILAS, (f) => f.lote8);
  const entradas = [
    { lote: "26052001", fecha: "2026-05-18", parcela: "Parcela Nº2 Delta Seedless", kgEntrada: 1100, kgAjuste: 0, cerradoAt: null, camaraConfirmadaNombre: null, camaraConfirmadaFecha: null },
    { lote: "26052002", fecha: "2026-05-18", parcela: "Parcela Nº2 Delta Seedless", kgEntrada: 950, kgAjuste: 0, cerradoAt: null, camaraConfirmadaNombre: null, camaraConfirmadaFecha: null },
    // Procesado según el parte, sin volcado ni Word: NUNCA "en cámara" aunque esté confirmado a pie.
    { lote: "26052005", fecha: "2026-05-19", parcela: "Parcela Nº4 Delta Seedless", kgEntrada: 2000, kgAjuste: 0, cerradoAt: null, camaraConfirmadaNombre: "Cámara 4", camaraConfirmadaFecha: "2026-05-20" },
    { lote: "26052006", fecha: "2026-05-19", parcela: "Parcela Nº4 Delta Seedless", kgEntrada: 2000, kgAjuste: 0, cerradoAt: null, camaraConfirmadaNombre: "Cámara 4", camaraConfirmadaFecha: "2026-05-20" },
    { lote: "26052007", fecha: "2026-05-19", parcela: "Parcela Nº4 Delta Seedless", kgEntrada: 500, kgAjuste: 500, cerradoAt: null, camaraConfirmadaNombre: null, camaraConfirmadaFecha: null },
    { lote: "26052008", fecha: "2026-05-19", parcela: "Parcela Nº4 Delta Seedless", kgEntrada: 500, kgAjuste: 0, cerradoAt: "2026-06-01T10:00:00Z", camaraConfirmadaNombre: null, camaraConfirmadaFecha: null },
  ];
  const parte = pasadasDelPartePorLote(
    [{ lote_codigo: "26052005 + 26052009", kg_peso_total: 1900, part_id: "p1" }, { lote_codigo: "26052001", kg_peso_total: 1200, part_id: "p1" }],
    new Map([["p1", "2026-05-22"]]),
    new Set(entradas.map((e) => e.lote)),
  );
  const frescura = frescuraFuentes({ ultimaPasadaSql: "2026-05-20T10:00:00+02:00", ultimaSincronizacion: "2026-05-20T12:00:00Z", ultimoDocx: "2026-05-21", ultimoParte: "2026-05-22" });

  it("detecta el volcado atrasado y recorta las fechas a día", () => {
    expect(frescura).toEqual({ ultimaPasadaSizer: "2026-05-20", ultimaSincronizacion: "2026-05-20", ultimoInformeDocx: "2026-05-21", ultimoParte: "2026-05-22", volcadoAtrasado: true });
  });

  it("cada lote con su estado y su motivo, ordenados por parcela y entrada", () => {
    const c = coberturaReal(entradas, porLote, parte, frescura);
    const por = Object.fromEntries(c.map((f) => [f.lote8, f]));
    expect(por["26052001"].estado).toBe("sql");
    expect(por["26052001"].desfase).toBeCloseTo((1200 / 1100 - 1) * 100, 6);
    expect(por["26052001"].pasadas).toBe(2);
    expect(por["26052002"].estado).toBe("respaldo");
    expect(por["26052002"].kgRespaldo).toBe(1000);
    expect(por["26052005"].estado).toBe("pendiente_volcado");
    expect(por["26052005"].kgEnParte).toBe(1900);
    expect(por["26052005"].motivo).toMatch(/PROCESADO el 2026-05-22/);
    expect(por["26052005"].motivo).toMatch(/volcado parado en el 2026-05-20/);
    expect(por["26052006"].estado).toBe("sin_dato");
    expect(por["26052006"].motivo).toMatch(/Sigue en cámara — Cámara 4/);
    expect(por["26052007"].motivo).toMatch(/ajuste de stock/);
    expect(por["26052008"].motivo).toMatch(/Cerrado a mano/);
    expect(c.map((f) => f.lote8)).toEqual(["26052001", "26052002", "26052005", "26052006", "26052007", "26052008"]);
  });
});

describe("etiquetaParcela", () => {
  it("el dueño las llama por el número", () => {
    expect(etiquetaParcela("Parcela Nº2 Delta Seedless")).toBe("Parcela 2");
    expect(etiquetaParcela("PARCELA N 14 NAVELINA")).toBe("Parcela 14");
    expect(etiquetaParcela("La Torrecilla")).toBe("La Torrecilla");
    expect(etiquetaParcela(null)).toBe("(sin parcela)");
  });
});
