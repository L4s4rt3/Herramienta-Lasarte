import { describe, expect, it } from "vitest";
import { controlARowCompleta, controlNuevo, prefillDuplicado } from "./useCalidadImport";

describe("controlARowCompleta (la fila del autoguardado/outbox)", () => {
  it("NUNCA lleva firma_path: la firma la escribe solo guardarFirma", () => {
    // Regresión del 01-09: el autoguardado mandaba la copia local del editor
    // (hidratada ANTES de firmar) con firma_path null y borraba la firma de
    // la base — "la firma no sale en el Word".
    const control = { ...controlNuevo("c1", "u1"), firma_path: "u1/calidad-import/c1/firma-x.png" };
    const row = controlARowCompleta(control);
    expect("firma_path" in row).toBe(false);
  });

  it("lleva id, user_id y los campos editables (sin timestamps)", () => {
    const control = controlNuevo("c1", "u1", { referencia: "1184066", defectos_leves: [{ tipo: "RAMEADO", pct: "3" }] });
    const row = controlARowCompleta(control);
    expect(row.id).toBe("c1");
    expect(row.user_id).toBe("u1");
    expect(row.referencia).toBe("1184066");
    expect(row.defectos_leves).toEqual([{ tipo: "RAMEADO", pct: "3" }]);
    expect("created_at" in row).toBe(false);
    expect("updated_at" in row).toBe(false);
  });
});

describe("prefillDuplicado", () => {
  it("copia producto e información general, nunca medidas ni firma", () => {
    const original = {
      ...controlNuevo("c1", "u1", {
        referencia: "1184066",
        proveedor: "HARRIE GOESTEN",
        clasificacion: "CAT 1",
        muestras_internas: [{ peso_fruta: "948", peso_zumo: "402", brix: "12", acidez: "1" }],
        obs_no_evolutivos: "algo",
        conclusion: "no aptos",
      }),
      firma_path: "u1/firma.png",
    };
    const prefill = prefillDuplicado(original);
    expect(prefill.referencia).toBe("1184066");
    expect(prefill.proveedor).toBe("HARRIE GOESTEN");
    expect(prefill.muestras_internas).toBeUndefined();
    expect(prefill.obs_no_evolutivos).toBeUndefined();
    expect(prefill.conclusion).toBeUndefined();
    expect("firma_path" in prefill).toBe(false);
    // La clasificación NO se copia: el duplicado es justo para la otra categoría.
    expect(prefill.clasificacion).toBeUndefined();
  });
});
