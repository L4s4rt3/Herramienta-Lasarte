import { describe, expect, it } from "vitest";
import { parseParteManualOcr } from "@/lib/partOcrParser";

// Textos OCR REALES devueltos por Mistral OCR sobre los partes EMBASUR del
// dueño (jul-2026). Sirven de red de regresión del parser/resolvedor.

const OCR_22 = `# 22107126:
- Cituico: 403 kg x 2 = 806 kg
- Cituico Podrido: 338 kg
- Podrido: 398 kg
- Malla E1: 229 kg x 4 = 916 kg
- Malla E2: 3 x 230 = 690 kg
- Palets Ponto: 2000 kg
- 10 kg: 43 + 17 = 600 kg
- 15 kg: 14 + 26 + 10 = 750 kg
- Mdra Granel: 30 + 28 = 696 kg
- Mdra 3 kg
- Mdra 4 kg - 4 = 48 kg
- Mdra 5 kg`;

const OCR_13 = `13/07/26
Valencia
Cítrica:
Cítrico pactido: 341 Kg
Pactido:
Malla 2.1: 234 Kg x 3 = 702 Kg.
Malla 2.2: 234 Kg x 4 = 936 Kg.
Patets punta: = 6685φ. → 6709Kφ
- 10 Kq: 56+36+63+60+67+50+33+27
+ = 3920Kφ
- 15 Kq: 53+22 = 1125Kφ
- Mdna Grewal: 44+45 = 1080Kφ.
- Mdna 3kq: 3 = 96Kφ.
- Mdna 4Ka: 12+ = 144Kφ + 24 = 168K
- Mdna 5Ka: 4 = 40
- 10x2 → 14 = 280Kφ.`;

// Parte NUEVO (23-jul) usado como test de generalización: trae variantes que
// los demás no tenían (label "Ponho", podrido como suma, malla con "(1)").
const OCR_23 = `23/09/26
- Cítrico: 386KG → 3box = 1.158KG
- Cítrico Podrido:
- Podrido: 2.11KG + 1.37KG = 3.48KG
- Malba E1: 233kg (1)
- Malba E2: 234kg (1)
- Palets Ponho: 2.575kg.
- 10 Kg: 17+63 = 80 → 300kg.
- 15 Kg: 43+56 → 99 → 148.5kg.
- Mdra Granel: 12 → 144kg.
- Mdra 3Kg:
- Mdra 4Kg: 8 → 96Kg.
- Mdra 5Kg: 5 → 50Kg.`;

describe("parseParteManualOcr", () => {
  it("22/07: recalcula operaciones y reconcilia palets (2000 escrito → 2094 del desglose)", () => {
    const { raw, dudas } = parseParteManualOcr(OCR_22, { fechaEsperada: "2026-07-22" });
    expect(raw.citrica_kg_brutos).toBe(806);
    expect(raw.citrica_podrido_kg_brutos).toBe(338);
    expect(raw.podrido_kg_brutos).toBe(398);
    expect(raw.malla_z1_kg_brutos).toBe(916);
    expect(raw.malla_z1_box).toBe(4);
    expect(raw.malla_z2_kg_brutos).toBe(690);
    expect(raw.malla_z2_box).toBe(3);
    expect(raw.palets_punta_kg).toBe(2094); // recuperado del desglose 600+750+696+48
    // el 2000 escrito no cuadra con el desglose → se marca y se usa el 2094
    expect(dudas.some((d) => d.startsWith("⚠") && d.includes("2094"))).toBe(true);
  });

  it("13/07: desglose cuadra con el total corregido (6709) sin banderas de error", () => {
    const { raw, dudas } = parseParteManualOcr(OCR_13, { fechaEsperada: "2026-07-13" });
    expect(raw.citrica_kg_brutos).toBeNull();
    expect(raw.citrica_podrido_kg_brutos).toBe(341);
    expect(raw.malla_z1_kg_brutos).toBe(702);
    expect(raw.malla_z2_kg_brutos).toBe(936);
    expect(raw.palets_punta_kg).toBe(6709);
    expect(dudas.some((d) => d.startsWith("⚠"))).toBe(false);
  });

  it("23/07 (generalización): lee variantes nuevas y ancla la fecha al parte", () => {
    const { raw, dudas } = parseParteManualOcr(OCR_23, { fechaEsperada: "2026-07-23" });
    expect(raw.fecha).toBe("2026-07-23"); // el OCR leyó 09; se ancla al parte
    expect(raw.citrica_kg_brutos).toBe(1158);
    expect(raw.citrica_podrido_kg_brutos).toBeNull();
    expect(raw.podrido_kg_brutos).toBe(348); // "2.11+1.37=3.48" → 348
    expect(raw.malla_z1_kg_brutos).toBe(233); // "233kg (1)"
    expect(raw.malla_z2_kg_brutos).toBe(234);
    expect(raw.palets_punta_kg).toBe(2575); // 10kg 300→800 reconciliado
    expect(dudas.some((d) => d.includes("mes distinto"))).toBe(true);
    expect(dudas.some((d) => d.includes("suma"))).toBe(true);
  });

  it("no inventa: parte vacío → todo null", () => {
    const { raw } = parseParteManualOcr("EMBASUR\nfoo bar\n", {});
    expect(raw.citrica_kg_brutos).toBeNull();
    expect(raw.palets_punta_kg).toBeNull();
  });
});
