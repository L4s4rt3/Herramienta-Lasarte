import { describe, expect, it } from "vitest";
import { canAccessVentasCategoria } from "./ventasCategoriaAccess";

describe("ventas categoria access", () => {
  it("allows admins even when their email is not in the authorized list", () => {
    expect(canAccessVentasCategoria({
      email: "admin@lasarte.com",
      role: "admin",
      authorizedEmails: [],
    })).toBe(true);
  });

  it("allows active authorized emails case-insensitively", () => {
    expect(canAccessVentasCategoria({
      email: "COMERCIAL@LASARTE.COM",
      role: "operario",
      authorizedEmails: [" comercial@lasarte.com "],
    })).toBe(true);
  });

  it("blocks users that are not admins and are not authorized", () => {
    expect(canAccessVentasCategoria({
      email: "produccion@lasarte.com",
      role: "operario",
      authorizedEmails: ["comercial@lasarte.com"],
    })).toBe(false);
  });
});
