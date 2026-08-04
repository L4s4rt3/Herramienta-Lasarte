import { describe, expect, it } from "vitest";
import {
  construirEventosLote,
  eventosDeAnotacionesPasada,
  eventosDeCamaraExterna,
  eventosDeConfirmacionFisica,
  eventosDeEntradaBascula,
  eventosDePasadasCalibrador,
  eventosPorLote,
  type EventoLote,
} from "@/lib/eventosLote";
import type { EntradaConciliacion, PasadaConciliacion } from "@/lib/conciliacionKg";
import type { CamionCamaraExterna, SenalesRecepcion } from "@/lib/camarasExternas";
import type { EntradaConCamaraConfirmada } from "@/lib/camaraConfirmada";

function porTipo<T extends EventoLote["tipo"]>(eventos: EventoLote[], tipo: T): Extract<EventoLote, { tipo: T }>[] {
  return eventos.filter((e): e is Extract<EventoLote, { tipo: T }> => e.tipo === tipo);
}

describe("eventosDeEntradaBascula", () => {
  it("genera el evento de entrada (medido) con kg_entrada", () => {
    const eventos = eventosDeEntradaBascula([
      { lote: "26010101", fecha: "2026-01-01", kg_entrada: 20000 },
    ]);
    expect(eventos).toHaveLength(1);
    expect(eventos[0]).toMatchObject({ tipo: "entrada_bascula", clase: "medido", kg: 20000, esPrecalibrado: false, esCampoCit: false });
  });

  it("marca esPrecalibrado/esCampoCit reutilizando productoresCanonicos.ts (no duplica la detección)", () => {
    const eventos = eventosDeEntradaBascula([
      { lote: "26010101", fecha: "2026-01-01", kg_entrada: 1000, agricultor: "LASARTE ALMACEN PRECALIBRADO", finca: "PREC 1 ALMACEN" },
      { lote: "26010102", fecha: "2026-01-01", kg_entrada: 2000, articulo: "NAR VAL CAMPO/CIT" },
    ]);
    const [prec, campoCit] = porTipo(eventos, "entrada_bascula");
    expect(prec.esPrecalibrado).toBe(true);
    expect(campoCit.esCampoCit).toBe(true);
  });

  it("kg_ajuste_stock distinto de 0 genera un evento foto_stock CON SIGNO (positivo o negativo)", () => {
    const eventos = eventosDeEntradaBascula([
      { lote: "26010101", fecha: "2026-01-01", kg_entrada: 1000, kg_ajuste_stock: 500 },
      { lote: "26010102", fecha: "2026-01-02", kg_entrada: 1000, kg_ajuste_stock: -300 },
      { lote: "26010103", fecha: "2026-01-03", kg_entrada: 1000, kg_ajuste_stock: 0 },
    ]);
    const fotos = porTipo(eventos, "foto_stock");
    expect(fotos).toHaveLength(2); // el ajuste 0 NO genera evento
    expect(fotos.find((f) => f.lote === "26010101")?.kg).toBe(500);
    expect(fotos.find((f) => f.lote === "26010102")?.kg).toBe(-300);
  });

  it("merma_camara_kg genera un evento medido solo cuando hay un valor positivo (null ≠ 0)", () => {
    const eventos = eventosDeEntradaBascula([
      { lote: "26010101", fecha: "2026-01-01", kg_entrada: 1000, merma_camara_kg: 50 },
      { lote: "26010102", fecha: "2026-01-01", kg_entrada: 1000, merma_camara_kg: null },
      { lote: "26010103", fecha: "2026-01-01", kg_entrada: 1000, merma_camara_kg: 0 },
    ]);
    const mermas = porTipo(eventos, "merma_camara");
    expect(mermas).toHaveLength(1);
    expect(mermas[0].lote).toBe("26010101");
    expect(mermas[0].kg).toBe(50);
  });

  it("cerrado_at genera un evento anotado sin kg (kg: null), con la fecha truncada a YYYY-MM-DD", () => {
    const eventos = eventosDeEntradaBascula([
      { lote: "26010101", fecha: "2026-01-01", kg_entrada: 1000, cerrado_at: "2026-02-01T10:20:30.000Z", cierre_modo: "con_analisis" },
    ]);
    const cierres = porTipo(eventos, "cierre_manual");
    expect(cierres).toHaveLength(1);
    expect(cierres[0]).toMatchObject({ clase: "anotado", kg: null, fecha: "2026-02-01", cierreModo: "con_analisis" });
  });
});

describe("eventosDePasadasCalibrador", () => {
  const entradaSimple = (lote: string, kg_entrada: number, fecha = "2026-01-01"): EntradaConciliacion => ({
    lote, fecha, finca: "Finca A", articulo: "NAR VAL DELTA", kg_entrada,
  });

  it("mención propia como código PRINCIPAL: nombrado con kg real, posición 'principal'", () => {
    const entradas = [entradaSimple("26010101", 1000)];
    const pasadas: PasadaConciliacion[] = [{ lote_codigo: "26010101", kg_peso_total: 900, date: "2026-01-05" }];
    const eventos = eventosDePasadasCalibrador(entradas, pasadas);
    const nombrados = porTipo(eventos, "pasada_nombrada");
    expect(nombrados).toHaveLength(1);
    expect(nombrados[0]).toMatchObject({ clase: "nombrado", posicion: "principal", lote: "26010101" });
    expect(nombrados[0].kg).toBeGreaterThan(0);
  });

  it("mención como código NO-PRINCIPAL de una pasada compuesta con reparto real: posición 'no_principal'", () => {
    // "26010101" (poco pendiente, se llena rápido) + "26010102" (con hueco): el
    // segundo código SÍ recibe parte de la pasada por reparto directo (fase 1).
    const entradas = [entradaSimple("26010101", 100), entradaSimple("26010102", 5000)];
    const pasadas: PasadaConciliacion[] = [{ lote_codigo: "26010101+26010102", kg_peso_total: 1000, date: "2026-01-05" }];
    const eventos = eventosDePasadasCalibrador(entradas, pasadas);
    const nombrados = porTipo(eventos, "pasada_nombrada");
    const noPrincipal = nombrados.find((n) => n.lote === "26010102");
    expect(noPrincipal).toBeDefined();
    expect(noPrincipal!.posicion).toBe("no_principal");
    expect(noPrincipal!.kg).toBeGreaterThan(0);
  });

  it("REGLA DE ORO: mención sin kg atribuido por el reparto (huérfano de compuesta) sigue siendo NOMBRADO con kg:null", () => {
    // "26010101" absorbe TODA la pasada (pendiente grande): "26010102" queda
    // nombrado en el texto pero con 0 kg de reparto — sigue siendo mención.
    const entradas = [entradaSimple("26010101", 100000), entradaSimple("26010102", 5000)];
    const pasadas: PasadaConciliacion[] = [{ lote_codigo: "26010101+26010102", kg_peso_total: 1000, date: "2026-01-05" }];
    const eventos = eventosDePasadasCalibrador(entradas, pasadas);
    const nombrados = porTipo(eventos, "pasada_nombrada");
    const huerfano = nombrados.find((n) => n.lote === "26010102");
    expect(huerfano).toBeDefined();
    expect(huerfano!.kg).toBeNull();
    expect(huerfano!.posicion).toBe("no_principal");
  });

  it("REGLA DE ORO: mención propia de código SIMPLE cuya capacidad ya está llena por kg_ajuste_stock también da kg:null (no 0)", () => {
    const entradas: EntradaConciliacion[] = [
      { lote: "26010101", fecha: "2026-01-01", finca: "Finca A", articulo: "NAR VAL DELTA", kg_entrada: 1000, kg_preasignado: 1000 },
    ];
    const pasadas: PasadaConciliacion[] = [{ lote_codigo: "26010101", kg_peso_total: 950, date: "2026-01-05" }];
    const eventos = eventosDePasadasCalibrador(entradas, pasadas);
    const nombrados = porTipo(eventos, "pasada_nombrada");
    expect(nombrados).toHaveLength(1);
    expect(nombrados[0].kg).toBeNull();
    expect(nombrados[0].posicion).toBe("principal"); // fue primer código de su propia pasada
  });

  it("derrame de exceso (misma finca/variedad) genera evento DERIVADO con el lote donante", () => {
    const entradas = [entradaSimple("26010101", 100, "2026-01-01"), entradaSimple("26010102", 5000, "2026-01-02")];
    entradas[0].finca = "Finca A";
    entradas[1].finca = "Finca A";
    const pasadas: PasadaConciliacion[] = [{ lote_codigo: "26010101", kg_peso_total: 2000, date: "2026-01-10" }]; // exceso sobre su propia entrada
    const eventos = eventosDePasadasCalibrador(entradas, pasadas);
    const derrames = porTipo(eventos, "derrame_exceso");
    expect(derrames.length).toBeGreaterThan(0);
    expect(derrames[0]).toMatchObject({ clase: "derivado", loteDonante: "26010101", lote: "26010102" });
  });

  it("una entrada sin ninguna pasada que la nombre no genera ningún evento pasada_nombrada", () => {
    const entradas = [entradaSimple("26010101", 1000)];
    const eventos = eventosDePasadasCalibrador(entradas, []);
    expect(porTipo(eventos, "pasada_nombrada")).toHaveLength(0);
  });
});

describe("eventosDeCamaraExterna", () => {
  const camion = (over: Partial<CamionCamaraExterna>): CamionCamaraExterna => ({
    procedencia: "GUADEX",
    s_ref: "S26/1",
    lote: "26010101",
    fecha_almacenamiento: "2026-01-01",
    proveedor: null,
    finca: null,
    variedad: null,
    envases: null,
    kg: 1000,
    entrada_lst_1: null,
    entrada_lst_2: null,
    envases_1: null,
    envases_2: null,
    venta_directa: null,
    nota_entrada: null,
    transporte_lst: null,
    ...over,
  });
  const senalesVacias: SenalesRecepcion = { salidaPorLote: new Map(), lotesProcesados: new Set() };

  it("camión sin ninguna señal de recepción → evento MEDIDO 'en_camara' con el kg completo", () => {
    const eventos = eventosDeCamaraExterna([camion({})], senalesVacias, "2026-02-01");
    expect(eventos).toHaveLength(1);
    expect(eventos[0]).toMatchObject({ tipo: "camara_externa", clase: "medido", estadoCamion: "en_camara", kg: 1000 });
  });

  it("camión ya recibido (procesado según pasadas) NO genera evento — caducidad de la señal", () => {
    const senales: SenalesRecepcion = { salidaPorLote: new Map(), lotesProcesados: new Set(["26010101"]) };
    const eventos = eventosDeCamaraExterna([camion({})], senales, "2026-02-01");
    expect(eventos).toHaveLength(0);
  });

  it("venta directa genera su propio evento MEDIDO, no un camara_externa", () => {
    const eventos = eventosDeCamaraExterna([camion({ venta_directa: "Venta directa a Fulano" })], senalesVacias, "2026-02-01");
    expect(eventos).toHaveLength(1);
    expect(eventos[0]).toMatchObject({ tipo: "venta_directa", clase: "medido" });
  });

  it("llegada parcial (envases a medias) genera camara_externa con el kg restante, no el kg total", () => {
    const eventos = eventosDeCamaraExterna(
      [camion({ envases: 100, entrada_lst_1: "2026-01-20", envases_1: 40 })],
      senalesVacias,
      "2026-02-01",
    );
    expect(eventos).toHaveLength(1);
    expect(eventos[0]).toMatchObject({ estadoCamion: "parcial" });
    expect((eventos[0] as Extract<EventoLote, { tipo: "camara_externa" }>).kg).toBeCloseTo(600, 5); // 60% restante de 1000
  });
});

describe("eventosDeConfirmacionFisica", () => {
  it("confirmación vigente (sin pasada posterior) genera evento ANOTADO sin kg", () => {
    const entradas: EntradaConCamaraConfirmada[] = [
      { lote: "26010101", camara_confirmada_nombre: "Cámara 5", camara_confirmada_fecha: "2026-02-01" },
    ];
    const eventos = eventosDeConfirmacionFisica(entradas, []);
    expect(eventos).toHaveLength(1);
    expect(eventos[0]).toMatchObject({ tipo: "confirmacion_fisica", clase: "anotado", kg: null, nombreCamara: "Cámara 5" });
  });

  it("REGLA DE ORO / caducidad: una pasada propia POSTERIOR a la confirmación anula el evento", () => {
    const entradas: EntradaConCamaraConfirmada[] = [
      { lote: "26010101", camara_confirmada_nombre: "Cámara 5", camara_confirmada_fecha: "2026-02-01" },
    ];
    const pasadas: PasadaConciliacion[] = [{ lote_codigo: "26010101", kg_peso_total: 500, date: "2026-02-10" }];
    const eventos = eventosDeConfirmacionFisica(entradas, pasadas);
    expect(eventos).toHaveLength(0);
  });
});

describe("eventosDeAnotacionesPasada (hueco tipado para pasada_anotaciones)", () => {
  it("sin filas (valor por defecto) no aporta ningún evento", () => {
    expect(eventosDeAnotacionesPasada()).toEqual([]);
  });

  it("cada fila se convierte en un evento ANOTADO", () => {
    const eventos = eventosDeAnotacionesPasada([{ lote: "26010101", fecha: "2026-01-05", kg: 300, nota: "más caja de la finca vecina" }]);
    expect(eventos).toHaveLength(1);
    expect(eventos[0]).toMatchObject({ tipo: "anotacion_pasada", clase: "anotado", kg: 300, nota: "más caja de la finca vecina" });
  });
});

describe("construirEventosLote (orquestador)", () => {
  it("junta eventos de todas las fuentes pasadas y respeta los parámetros opcionales", () => {
    const eventos = construirEventosLote({
      entradas: [{ lote: "26010101", fecha: "2026-01-01", kg_entrada: 1000, cerrado_at: "2026-02-01T00:00:00Z" }],
      entradasConciliacion: [{ lote: "26010101", fecha: "2026-01-01", finca: null, articulo: null, kg_entrada: 1000 }],
      pasadas: [{ lote_codigo: "26010101", kg_peso_total: 900, date: "2026-01-05" }],
      hoy: "2026-02-10",
    });
    expect(porTipo(eventos, "entrada_bascula")).toHaveLength(1);
    expect(porTipo(eventos, "cierre_manual")).toHaveLength(1);
    expect(porTipo(eventos, "pasada_nombrada").length).toBeGreaterThan(0);
    // Sin camionesCamaraExterna/entradasConCamaraConfirmada: no debe reventar ni aportar esos eventos.
    expect(porTipo(eventos, "camara_externa")).toHaveLength(0);
    expect(porTipo(eventos, "confirmacion_fisica")).toHaveLength(0);
  });
});

describe("eventosPorLote", () => {
  it("agrupa los eventos por código de lote", () => {
    const eventos: EventoLote[] = [
      { tipo: "entrada_bascula", clase: "medido", lote: "26010101", fecha: "2026-01-01", kg: 1000, esPrecalibrado: false, esCampoCit: false },
      { tipo: "entrada_bascula", clase: "medido", lote: "26010102", fecha: "2026-01-01", kg: 2000, esPrecalibrado: false, esCampoCit: false },
    ];
    const porLote = eventosPorLote(eventos);
    expect(porLote.size).toBe(2);
    expect(porLote.get("26010101")).toHaveLength(1);
  });
});
