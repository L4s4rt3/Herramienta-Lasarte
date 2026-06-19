import { describe, expect, it } from "vitest";
import { errorMessage, toError } from "./errorMessage";

describe("errorMessage", () => {
  it("formats Supabase-like object errors without returning object Object", () => {
    const message = errorMessage({
      message: "Could not find the 'referencia' column",
      details: "Schema cache is stale",
      code: "PGRST204",
    });

    expect(message).toContain("Could not find");
    expect(message).toContain("Schema cache is stale");
    expect(message).toContain("PGRST204");
    expect(message).not.toBe("[object Object]");
  });

  it("wraps unknown object errors as Error instances with a readable message", () => {
    const error = toError({ message: "RLS blocked insert" });

    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe("RLS blocked insert");
  });
});
