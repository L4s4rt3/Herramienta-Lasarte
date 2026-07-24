import { describe, expect, it } from "vitest";
import { PART_DETAIL_MANUAL_FIELDS } from "./partDetailManualFields";

describe("PART_DETAIL_MANUAL_FIELDS", () => {
  it("includes citrica as the daily manual industry field", () => {
    expect(PART_DETAIL_MANUAL_FIELDS[0]).toEqual({
      key: "kg_industria_manual",
      label: "Industria (Cítrica)",
      unidad: "kg",
    });
  });
});
