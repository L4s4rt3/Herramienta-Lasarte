import { beforeEach, describe, expect, it } from "vitest";
import {
  conTimeout,
  controlesPendientes,
  controlPendiente,
  encolarControl,
  esErrorDeRed,
  hayPendientes,
  outboxMasNuevo,
  quitarControlPendiente,
  type ControlOutboxEntry,
} from "./calidadImportOffline";

describe("conTimeout", () => {
  it("resuelve si la promesa llega a tiempo", async () => {
    await expect(conTimeout(Promise.resolve(42), 1000)).resolves.toBe(42);
  });

  it("propaga el rechazo original", async () => {
    await expect(conTimeout(Promise.reject(new Error("permiso denegado")), 1000)).rejects.toThrow("permiso denegado");
  });

  it("corta una promesa colgada (el caso del wifi sin internet)", async () => {
    const colgada = new Promise(() => {
      // nunca resuelve: como un fetch contra un wifi sin salida a internet
    });
    await expect(conTimeout(colgada, 30, "la base de datos")).rejects.toThrow(/Sin respuesta de la base de datos/);
  });
});

describe("esErrorDeRed", () => {
  it("reconoce el timeout de red como error de red", async () => {
    const colgada = new Promise(() => {
      // nunca resuelve
    });
    const error = await conTimeout(colgada, 20).catch((e: unknown) => e);
    expect(esErrorDeRed(error)).toBe(true);
  });

  it("reconoce los fallos clásicos de fetch", () => {
    expect(esErrorDeRed(new TypeError("Failed to fetch"))).toBe(true);
    expect(esErrorDeRed(new Error("NetworkError when attempting to fetch resource."))).toBe(true);
  });

  it("NO confunde errores de datos/permisos con errores de red", () => {
    expect(esErrorDeRed(new Error("new row violates row-level security policy"))).toBe(false);
    expect(esErrorDeRed(new Error("duplicate key value"))).toBe(false);
  });
});

describe("outboxMasNuevo", () => {
  const entrada = (updatedLocal: string): ControlOutboxEntry => ({
    row: { id: "c1", user_id: "u1" },
    updatedLocal,
  });

  it("la copia local gana solo si es posterior a la del servidor", () => {
    expect(outboxMasNuevo(entrada("2026-09-01T10:00:00.000Z"), "2026-09-01T09:00:00+00:00")).toBe(true);
    expect(outboxMasNuevo(entrada("2026-09-01T08:00:00.000Z"), "2026-09-01T09:00:00+00:00")).toBe(false);
  });

  it("sin fecha del servidor, gana la local", () => {
    expect(outboxMasNuevo(entrada("2026-09-01T08:00:00.000Z"), null)).toBe(true);
    expect(outboxMasNuevo(entrada("2026-09-01T08:00:00.000Z"), undefined)).toBe(true);
  });
});

describe("outbox de controles (localStorage)", () => {
  beforeEach(() => {
    for (const entry of controlesPendientes()) quitarControlPendiente(entry.row.id);
  });

  it("encola, lee y quita", () => {
    expect(hayPendientes()).toBe(false);
    encolarControl({ id: "c1", user_id: "u1", referencia: "1184066" });
    expect(hayPendientes()).toBe(true);
    expect(controlPendiente("c1")?.row.referencia).toBe("1184066");
    // La segunda escritura del mismo control pisa a la primera (última gana).
    encolarControl({ id: "c1", user_id: "u1", referencia: "1184099" });
    expect(controlesPendientes()).toHaveLength(1);
    expect(controlPendiente("c1")?.row.referencia).toBe("1184099");
    quitarControlPendiente("c1");
    expect(hayPendientes()).toBe(false);
  });
});
