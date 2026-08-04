import { describe, expect, it, vi } from "vitest";
import { escribirConReintentos, fetchAllRows } from "./fetchAllRows";

interface Row {
  id: number;
}

/** Mock de una tabla en memoria: simula el recorte silencioso de PostgREST a maxRows. */
function mockTable(totalRows: number, maxRows = 1000) {
  const rows: Row[] = Array.from({ length: totalRows }, (_, i) => ({ id: i }));
  const calls: Array<{ from: number; to: number }> = [];
  const buildQuery = vi.fn((from: number, to: number) => {
    calls.push({ from, to });
    // PostgREST: el rango pedido se recorta a maxRows filas por respuesta,
    // exactamente el comportamiento del bug real (silencioso, sin error).
    const cappedTo = Math.min(to, from + maxRows - 1);
    const page = rows.slice(from, cappedTo + 1);
    return Promise.resolve({ data: page, error: null });
  });
  return { buildQuery, calls };
}

describe("fetchAllRows", () => {
  it("devuelve todas las filas de una tabla con menos de una página", async () => {
    const { buildQuery, calls } = mockTable(30);
    const result = await fetchAllRows<Row>(buildQuery, 1000);
    expect(result).toHaveLength(30);
    expect(result[0]).toEqual({ id: 0 });
    expect(result[29]).toEqual({ id: 29 });
    // Una sola llamada: la primera página ya viene incompleta (30 < 1000).
    expect(calls).toHaveLength(1);
  });

  it("pagina más allá de 1.000 filas (el caso real: max-rows del servidor)", async () => {
    // Tabla con más filas que el max-rows del servidor, como entradas_bascula
    // (1.276) o lote_clasificacion (8.685) tras el import histórico.
    const { buildQuery, calls } = mockTable(2500, 1000);
    const result = await fetchAllRows<Row>(buildQuery, 1000);
    expect(result).toHaveLength(2500);
    expect(result.map((r) => r.id)).toEqual(Array.from({ length: 2500 }, (_, i) => i));
    // 3 páginas: fetchAllRows siempre PIDE rangos de pageSize (2000-2999
    // incluido), aunque la tabla mock solo tenga hasta 2499 — igual que
    // supabase-js, que no sabe cuántas filas quedan hasta que responde.
    expect(calls).toEqual([
      { from: 0, to: 999 },
      { from: 1000, to: 1999 },
      { from: 2000, to: 2999 },
    ]);
  });

  it("se detiene en una página exactamente múltiplo del pageSize (pide una página extra vacía)", async () => {
    const { buildQuery, calls } = mockTable(2000, 1000);
    const result = await fetchAllRows<Row>(buildQuery, 1000);
    expect(result).toHaveLength(2000);
    // Página final vacía: es la señal de fin cuando el total es múltiplo exacto.
    expect(calls).toEqual([
      { from: 0, to: 999 },
      { from: 1000, to: 1999 },
      { from: 2000, to: 2999 },
    ]);
  });

  it("devuelve [] sin llamar más de una vez si la tabla está vacía", async () => {
    const { buildQuery, calls } = mockTable(0);
    const result = await fetchAllRows<Row>(buildQuery, 1000);
    expect(result).toEqual([]);
    expect(calls).toHaveLength(1);
  });

  it("respeta un pageSize menor (por ejemplo, para simular en tests sin tablas gigantes)", async () => {
    const { buildQuery, calls } = mockTable(25, 1000);
    const result = await fetchAllRows<Row>(buildQuery, 10);
    expect(result).toHaveLength(25);
    expect(calls).toEqual([
      { from: 0, to: 9 },
      { from: 10, to: 19 },
      { from: 20, to: 29 },
    ]);
  });

  it("lanza el primer error y no sigue pidiendo páginas", async () => {
    const error = { message: "boom", code: "500" };
    const buildQuery = vi.fn()
      .mockResolvedValueOnce({ data: [{ id: 0 }], error: null })
      .mockResolvedValueOnce({ data: null, error });
    await expect(fetchAllRows<Row>(buildQuery, 1)).rejects.toBe(error);
    expect(buildQuery).toHaveBeenCalledTimes(2);
  });

  it("trata data: null como página vacía (fin de la paginación)", async () => {
    const buildQuery = vi.fn().mockResolvedValueOnce({ data: null, error: null });
    const result = await fetchAllRows<Row>(buildQuery, 1000);
    expect(result).toEqual([]);
  });
});

describe("escribirConReintentos — compartida entre el import histórico y el cierre automático de lotes", () => {
  it("reintenta un error transitorio (statement timeout) y devuelve el resultado si el reintento tiene éxito", async () => {
    vi.useFakeTimers();
    try {
      const hacer = vi.fn()
        .mockResolvedValueOnce({ data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } })
        .mockResolvedValueOnce({ data: { ok: true }, error: null });
      const promesa = escribirConReintentos(hacer);
      await vi.runAllTimersAsync();
      const resultado = await promesa;
      expect(resultado).toEqual({ data: { ok: true }, error: null });
      expect(hacer).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("no reintenta un error de datos (no transitorio): aborta a la primera", async () => {
    const error = { code: "23505", message: "duplicate key value violates unique constraint" };
    const hacer = vi.fn().mockResolvedValue({ data: null, error });
    const resultado = await escribirConReintentos(hacer);
    expect(resultado.error).toBe(error);
    expect(hacer).toHaveBeenCalledTimes(1);
  });

  it("agota los reintentos (3 intentos en total) y devuelve el último error si todos fallan", async () => {
    vi.useFakeTimers();
    try {
      const error = { code: "57014", message: "statement timeout" };
      const hacer = vi.fn().mockResolvedValue({ data: null, error });
      const promesa = escribirConReintentos(hacer);
      await vi.runAllTimersAsync();
      const resultado = await promesa;
      expect(resultado.error).toBe(error);
      expect(hacer).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("sin error, no reintenta (una sola llamada)", async () => {
    const hacer = vi.fn().mockResolvedValue({ data: { ok: true }, error: null });
    const resultado = await escribirConReintentos(hacer);
    expect(resultado).toEqual({ data: { ok: true }, error: null });
    expect(hacer).toHaveBeenCalledTimes(1);
  });
});
