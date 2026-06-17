import { describe, expect, it } from "vitest";
import { shouldShowProductionEvolution } from "./analisisDiarioView";

describe("shouldShowProductionEvolution", () => {
  it("hides production evolution when the period has a single point", () => {
    expect(shouldShowProductionEvolution([{ date: "06-16", kg: 103000 }])).toBe(false);
  });

  it("shows production evolution when the period has multiple points", () => {
    expect(shouldShowProductionEvolution([
      { date: "06-16", kg: 103000 },
      { date: "06-17", kg: 98000 },
    ])).toBe(true);
  });
});
