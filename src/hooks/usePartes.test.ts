import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import {
  PARTES_QUERY_KEY,
  partesQueryOptions,
  upsertParteInCache,
  type Parte,
  type ParteRaw,
} from "./usePartes";

const baseParte: ParteRaw = {
  id: "parte-1",
  date: "2026-06-09",
  estado: "Borrador",
  created_at: "2026-06-09T08:00:00.000Z",
  kg_produccion_calibrador: null,
  kg_mujeres_calibrador: null,
  kg_palets_brutos: null,
  kg_palets_egipto: null,
  kg_palets_campo: null,
  kg_podrido_calibrador_auto: null,
  kg_industria_manual: null,
  kg_reciclado_malla_z1: null,
  kg_reciclado_malla_z2: null,
  kg_inventario_sin_alta: null,
  kg_podrido_bolsa_basura: null,
  kg_inventario_anterior_sin_alta: null,
  notas_generales: null,
  notas_inventario: null,
  resumen_ia: null,
};

describe("partes cache", () => {
  it("refetches when the partes list remounts after creating a parte elsewhere", () => {
    expect((partesQueryOptions as { refetchOnMount?: unknown }).refetchOnMount).toBe("always");
  });

  it("adds a newly created parte to the cached list immediately", () => {
    const queryClient = new QueryClient();
    const existing = { ...baseParte, id: "parte-0", date: "2026-06-08" };

    upsertParteInCache(queryClient, existing);
    upsertParteInCache(queryClient, baseParte);

    const cached = queryClient.getQueryData<Parte[]>(PARTES_QUERY_KEY);
    expect(cached?.map((parte) => parte.id)).toEqual(["parte-1", "parte-0"]);
    expect(cached?.[0].cascade).toBeDefined();
  });
});
