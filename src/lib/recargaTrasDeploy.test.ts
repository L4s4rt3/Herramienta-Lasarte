// @vitest-environment jsdom
// (necesita DOM: el proyecto "logica" de vitest corre src/lib en node)
// Tests de la recuperación automática cuando un deploy invalida los chunks
// en diferido ("Failed to fetch dynamically imported module").
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  conRecargaTrasDeploy,
  envolverCargadoresConRecarga,
  recargarUnaVezTrasDeploy,
} from "@/lib/recargaTrasDeploy";

const recargar = vi.fn();

beforeEach(() => {
  recargar.mockClear();
  sessionStorage.clear();
  // jsdom no implementa location.reload: se sustituye por un espía.
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { ...window.location, reload: recargar },
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("recargarUnaVezTrasDeploy", () => {
  it("recarga la primera vez y NO vuelve a recargar dentro de la ventana", () => {
    expect(recargarUnaVezTrasDeploy()).toBe(true);
    expect(recargar).toHaveBeenCalledTimes(1);

    expect(recargarUnaVezTrasDeploy()).toBe(false);
    expect(recargar).toHaveBeenCalledTimes(1);
  });

  it("vuelve a permitir recargar pasada la ventana de 10 s", () => {
    expect(recargarUnaVezTrasDeploy()).toBe(true);
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 11_000);
    expect(recargarUnaVezTrasDeploy()).toBe(true);
    expect(recargar).toHaveBeenCalledTimes(2);
  });

  it("sin sessionStorage recarga igualmente (mejor eso que una pantalla rota)", () => {
    const espia = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("sessionStorage bloqueado");
    });
    expect(recargarUnaVezTrasDeploy()).toBe(true);
    expect(recargar).toHaveBeenCalledTimes(1);
    espia.mockRestore();
  });
});

describe("conRecargaTrasDeploy", () => {
  it("deja pasar el módulo cuando el import va bien", async () => {
    const cargador = conRecargaTrasDeploy(async () => ({ default: "pagina" }));
    await expect(cargador()).resolves.toEqual({ default: "pagina" });
    expect(recargar).not.toHaveBeenCalled();
  });

  it("recarga y deja la promesa pendiente cuando el chunk ya no existe", async () => {
    const cargador = conRecargaTrasDeploy(async () => {
      throw new TypeError("Failed to fetch dynamically imported module");
    });
    let resuelta = false;
    void cargador().then(() => { resuelta = true; });
    await Promise.resolve();
    await Promise.resolve();
    expect(recargar).toHaveBeenCalledTimes(1);
    // Pendiente a propósito: Suspense se queda en su fallback mientras
    // el navegador recarga, en vez de pintar un error medio segundo.
    expect(resuelta).toBe(false);
  });

  it("si ya se recargó, propaga el error al ErrorBoundary", async () => {
    recargarUnaVezTrasDeploy(); // consume la ventana
    recargar.mockClear();
    const cargador = conRecargaTrasDeploy(async () => {
      throw new TypeError("Failed to fetch dynamically imported module");
    });
    await expect(cargador()).rejects.toThrow("Failed to fetch");
    expect(recargar).not.toHaveBeenCalled();
  });
});

describe("envolverCargadoresConRecarga", () => {
  it("envuelve todas las claves y conserva sus nombres", async () => {
    const envueltos = envolverCargadoresConRecarga({
      buena: async () => "ok",
      rota: async () => { throw new TypeError("Failed to fetch dynamically imported module"); },
    });
    expect(Object.keys(envueltos).sort()).toEqual(["buena", "rota"]);
    await expect(envueltos.buena()).resolves.toBe("ok");
    void envueltos.rota();
    await Promise.resolve();
    await Promise.resolve();
    expect(recargar).toHaveBeenCalledTimes(1);
  });
});
