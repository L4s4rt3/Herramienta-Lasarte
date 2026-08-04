import { describe, expect, it } from "vitest";
import {
  camaraConfirmadaVigentePorLote,
  unirLotesConfirmadosEnCamara,
  type EntradaConCamaraConfirmada,
} from "./camaraConfirmada";
import type { PasadaConciliacion } from "./conciliacionKg";

// Fixtures del caso real: 3 de los 26 lotes de la cámara 5 que el dueño
// confirmó físicamente el 04-08-2026.
const entrada = (over: Partial<EntradaConCamaraConfirmada> & { lote: string }): EntradaConCamaraConfirmada => ({
  camara_confirmada_nombre: "Cámara 5",
  camara_confirmada_fecha: "2026-08-04",
  ...over,
});

const pasada = (over: Partial<PasadaConciliacion> & { lote_codigo: string; date: string }): PasadaConciliacion => ({
  kg_peso_total: 1000,
  ...over,
});

describe("camaraConfirmadaVigentePorLote — vigencia de la confirmación física", () => {
  it("un lote confirmado sin ninguna pasada propia sale VIGENTE con su nombre y fecha", () => {
    const vigentes = camaraConfirmadaVigentePorLote(
      [entrada({ lote: "26051408" }), entrada({ lote: "26051906" }), entrada({ lote: "26052602" })],
      [],
    );
    expect(vigentes.size).toBe(3);
    expect(vigentes.get("26051408")).toEqual({ nombre: "Cámara 5", fecha: "2026-08-04" });
    expect(vigentes.get("26051906")).toEqual({ nombre: "Cámara 5", fecha: "2026-08-04" });
  });

  it("(d) una pasada propia ANTERIOR a la fecha de confirmación NO caduca la señal", () => {
    const vigentes = camaraConfirmadaVigentePorLote(
      [entrada({ lote: "26051408" })],
      [pasada({ lote_codigo: "26051408", date: "2026-07-20" })], // antes del inventario (04-08)
    );
    expect(vigentes.has("26051408")).toBe(true);
  });

  it("una pasada propia el MISMO día de la confirmación tampoco caduca la señal (solo POSTERIOR caduca)", () => {
    const vigentes = camaraConfirmadaVigentePorLote(
      [entrada({ lote: "26051408" })],
      [pasada({ lote_codigo: "26051408", date: "2026-08-04" })],
    );
    expect(vigentes.has("26051408")).toBe(true);
  });

  it("(c) una pasada propia POSTERIOR a la fecha de confirmación caduca la señal: el lote deja de aparecer en el mapa, el ciclo normal se aplica", () => {
    const vigentes = camaraConfirmadaVigentePorLote(
      [entrada({ lote: "26051408" })],
      [pasada({ lote_codigo: "26051408", date: "2026-08-06" })], // la fruta empezó a salir de verdad
    );
    expect(vigentes.has("26051408")).toBe(false);
  });

  it("detección por CUALQUIER POSICIÓN del código en una pasada COMPUESTA (mismo criterio que el resto del motor, nunca por LIKE/substring)", () => {
    // El lote confirmado aparece como SEGUNDO código de una pasada compuesta,
    // con fecha posterior a la confirmación: también caduca (no solo cuando
    // es el primer código).
    const vigentes = camaraConfirmadaVigentePorLote(
      [entrada({ lote: "26051408" })],
      [pasada({ lote_codigo: "26050101+26051408", date: "2026-08-06" })],
    );
    expect(vigentes.has("26051408")).toBe(false);
  });

  it("sin camara_confirmada_nombre o sin camara_confirmada_fecha, no hay señal (null≠0: hacen falta las DOS columnas rellenas)", () => {
    const vigentes = camaraConfirmadaVigentePorLote(
      [
        entrada({ lote: "26051408", camara_confirmada_nombre: null }),
        entrada({ lote: "26051906", camara_confirmada_fecha: null }),
      ],
      [],
    );
    expect(vigentes.size).toBe(0);
  });

  it("pasadas con kg<=0 no cuentan como mención real: no caducan la señal por una fila de corrección/ruido", () => {
    const vigentes = camaraConfirmadaVigentePorLote(
      [entrada({ lote: "26051408" })],
      [pasada({ lote_codigo: "26051408", date: "2026-08-06", kg_peso_total: 0 })],
    );
    expect(vigentes.has("26051408")).toBe(true);
  });

  it("código de lote no normalizable (sin 8 dígitos) no entra en el mapa", () => {
    const vigentes = camaraConfirmadaVigentePorLote([entrada({ lote: "SIN-CODIGO" })], []);
    expect(vigentes.size).toBe(0);
  });

  it("varias pasadas propias: solo importa la fecha MÁS RECIENTE frente a la de confirmación", () => {
    // Una posterior y otra anterior: la posterior manda (caduca).
    const vigentes = camaraConfirmadaVigentePorLote(
      [entrada({ lote: "26051408" })],
      [
        pasada({ lote_codigo: "26051408", date: "2026-07-01" }),
        pasada({ lote_codigo: "26051408", date: "2026-08-10" }),
      ],
    );
    expect(vigentes.has("26051408")).toBe(false);
  });
});

describe("unirLotesConfirmadosEnCamara — (e) construcción del Set unión", () => {
  it("la unión incluye tanto los códigos de cámara EXTERNA como los de confirmación FÍSICA, sin duplicar", () => {
    const externa = new Set(["26050809", "26051106"]);
    const confirmada = camaraConfirmadaVigentePorLote(
      [entrada({ lote: "26051408" }), entrada({ lote: "26050809" })], // 26050809 solapa con la externa
      [],
    );
    const union = unirLotesConfirmadosEnCamara(externa, confirmada);
    expect(union).toEqual(new Set(["26050809", "26051106", "26051408"]));
    expect(union.size).toBe(3); // el solape no duplica
  });

  it("unión vacía cuando ambas fuentes están vacías", () => {
    const union = unirLotesConfirmadosEnCamara(new Set(), new Map());
    expect(union.size).toBe(0);
  });

  it("solo cámara externa (confirmación física vacía) devuelve exactamente esa señal, sin perder nada", () => {
    const externa = new Set(["26050809"]);
    const union = unirLotesConfirmadosEnCamara(externa, new Map());
    expect(union).toEqual(new Set(["26050809"]));
  });

  it("solo confirmación física (cámara externa vacía) devuelve exactamente esa señal", () => {
    const confirmada = camaraConfirmadaVigentePorLote([entrada({ lote: "26051408" })], []);
    const union = unirLotesConfirmadosEnCamara(new Set(), confirmada);
    expect(union).toEqual(new Set(["26051408"]));
  });
});
