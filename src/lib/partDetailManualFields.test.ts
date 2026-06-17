import { describe, expect, it } from "vitest";
import { PART_DETAIL_MANUAL_FIELDS } from "./partDetailManualFields";

describe("PART_DETAIL_MANUAL_FIELDS", () => {
  it("does not include industria de la punta in daily manual data", () => {
    expect(PART_DETAIL_MANUAL_FIELDS.map((field) => field.key)).not.toContain("kg_industria_manual");
    expect(PART_DETAIL_MANUAL_FIELDS.map((field) => field.label)).not.toContain("Industria de la punta");
  });
});
