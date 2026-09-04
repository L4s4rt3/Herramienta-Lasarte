// Regresión del maestro/detalle de /calidad en una sola columna (móvil).
//
// El fallo original: qué panel se veía se DEDUCÍA de `selected`, y `selected`
// cae a `lotes[0]` cuando no hay selección — así que la flecha de volver no
// devolvía nunca a la lista y desde el móvil era imposible abrir un segundo
// lote del día. Ahora manda un estado explícito (`vistaMovil`).
//
// Las clases `hidden xl:block` son el mecanismo real (Tailwind no se evalúa en
// jsdom), así que se comprueban sobre los dos paneles marcados con data-testid.
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { TooltipProvider } from "@/components/ui/tooltip";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CalidadAdjunto, CalidadJornada, CalidadLote } from "@/lib/calidad";

const lote = (id: string, numero: string, productor: string): CalidadLote => ({
  id,
  jornada_id: "j1",
  user_id: "u1",
  fecha: "2026-09-02",
  numero_lote: numero,
  productor_finca_id: null,
  productor_finca_nombre: productor,
  producto: "Naranja",
  variedad: "Navel",
  cantidad: "40 Box",
  hora: "08:00",
  aerobotics_realizado: false,
  calidad: "Bueno",
  defectos: [],
  defecto_otro: "",
  observacion: "",
  accion_recomendada: "",
  informe_estado: "borrador",
  informe_generado: "",
  ia_calidad: null,
  ia_defectos: [],
  ia_resumen: "",
  ia_accion_recomendada: "",
  validado_at: null,
  validado_by: null,
  reabierto_at: null,
  reabierto_by: null,
  motivo_reapertura: "",
  created_at: "2026-09-02T08:00:00.000Z",
  updated_at: "2026-09-02T08:00:00.000Z",
});

const jornada: CalidadJornada = {
  id: "j1",
  fecha: "2026-09-02",
  responsable: "Eusebio Rodríguez",
  estado: "guardada",
  created_at: "2026-09-02T06:00:00.000Z",
  updated_at: "2026-09-02T06:00:00.000Z",
};

const LOTES = [lote("l1", "26090201", "FINCA UNO"), lote("l2", "26090202", "FINCA DOS")];
const ADJUNTOS: CalidadAdjunto[] = [];

vi.mock("@/contexts/AuthProvider", () => ({
  useAuth: () => ({ user: { id: "u1" }, role: "admin", session: null, loading: false, signOut: vi.fn() }),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
    }),
  },
}));

vi.mock("@/hooks/useCalidadJornada", () => ({
  useCalidadJornadaDia: () => ({
    data: { jornada, lotes: LOTES, adjuntos: ADJUNTOS, lotesDia: [], productores: [], historicalLotes: [] },
    isLoading: false,
  }),
  useCalidadHistoricoRango: () => ({ data: [], isLoading: false }),
  useCalidadJornadaMutaciones: () => ({
    invalidate: vi.fn(),
    updateJornadaMutation: { mutateAsync: vi.fn() },
    updateLoteMutation: { mutateAsync: vi.fn() },
    insertProductorMutation: { mutateAsync: vi.fn() },
    deleteProductorMutation: { mutateAsync: vi.fn() },
    insertLoteMutation: { mutateAsync: vi.fn() },
    insertLotesBatchMutation: { mutateAsync: vi.fn() },
    deleteLoteMutation: { mutateAsync: vi.fn() },
    uploadAdjuntosMutation: { mutateAsync: vi.fn() },
    deleteAdjuntoMutation: { mutateAsync: vi.fn() },
  }),
}));

// Paneles pesados que no intervienen en la navegación maestro/detalle.
vi.mock("@/components/calidad/CalidadHistoricoTab", () => ({ CalidadHistoricoTab: () => null }));
vi.mock("@/components/CalidadInformeDialog", () => ({ CalidadInformeDialog: () => null }));
vi.mock("@/components/PartFilePreviewDialog", () => ({ PartFilePreviewDialog: () => null }));

import CalidadJornadaPage from "./CalidadJornada";

function renderPagina() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <TooltipProvider>
          <CalidadJornadaPage />
        </TooltipProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** Fila de la lista de lotes (el nombre del productor también sale en la ficha). */
function filaDeLote(productor: string) {
  return within(screen.getByTestId("calidad-panel-lista")).getByText(productor);
}

/** true si el panel está oculto en una sola columna (visible solo a partir de xl). */
function ocultoEnMovil(testId: string) {
  return screen.getByTestId(testId).className.includes("hidden xl:block");
}

/**
 * Botón "Anterior"/"Siguiente" de la barra de salto entre lotes de la ficha.
 *
 * Se busca por texto acotado a `button` y se comprueba APARTE su nombre
 * accesible, en vez de con `getByRole("button", { name })`. La consulta por rol
 * con nombre calcula el nombre accesible de LOS 62 BOTONES de la página, y cada
 * cálculo llama al `getComputedStyle` de jsdom (también con ::before/::after),
 * que cuesta ~1 ms: medido, ~550 ms POR CONSULTA. Con las dos consultas el test
 * se iba a ~1,6 s de los 5 s de `testTimeout` — margen que se come la suite
 * entera peleando por la CPU, y entonces moría con "Test timed out in 5000ms".
 * Comprobar el nombre accesible de UN botón cuesta ~15 ms y garantiza lo mismo:
 * un único <button> dentro de la ficha, con ese nombre accesible.
 */
function botonSaltoDeFicha(nombre: "Anterior" | "Siguiente") {
  const panelFicha = screen.getByTestId("calidad-panel-ficha");
  const boton = within(panelFicha).getByText(nombre, { selector: "button" });
  expect(boton).toHaveAccessibleName(new RegExp(nombre));
  return boton;
}

describe("CalidadJornada — maestro/detalle en móvil", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("arranca en la lista, con la ficha fuera de pantalla", async () => {
    renderPagina();
    await waitFor(() => expect(filaDeLote("FINCA UNO")).toBeInTheDocument());
    expect(ocultoEnMovil("calidad-panel-lista")).toBe(false);
    expect(ocultoEnMovil("calidad-panel-ficha")).toBe(true);
  });

  it("abre un lote, vuelve a la lista y puede abrir OTRO lote", async () => {
    renderPagina();
    await waitFor(() => expect(filaDeLote("FINCA UNO")).toBeInTheDocument());

    fireEvent.click(filaDeLote("FINCA UNO"));
    expect(ocultoEnMovil("calidad-panel-ficha")).toBe(false);
    expect(ocultoEnMovil("calidad-panel-lista")).toBe(true);
    expect(screen.getByText("Lote 26090201")).toBeInTheDocument();

    // Esta es la vuelta que antes no funcionaba: `selected` seguía valiendo
    // lotes[0] y la lista se quedaba oculta para siempre.
    fireEvent.click(screen.getByLabelText("Volver a la lista"));
    expect(ocultoEnMovil("calidad-panel-lista")).toBe(false);
    expect(ocultoEnMovil("calidad-panel-ficha")).toBe(true);

    fireEvent.click(filaDeLote("FINCA DOS"));
    expect(ocultoEnMovil("calidad-panel-ficha")).toBe(false);
    expect(screen.getByText("Lote 26090202")).toBeInTheDocument();
  });

  it("salta al lote siguiente y al anterior sin pasar por la lista", async () => {
    renderPagina();
    await waitFor(() => expect(filaDeLote("FINCA UNO")).toBeInTheDocument());

    fireEvent.click(filaDeLote("FINCA UNO"));
    expect(screen.getByText("· 1 de 2")).toBeInTheDocument();

    fireEvent.click(botonSaltoDeFicha("Siguiente"));
    expect(screen.getByText("Lote 26090202")).toBeInTheDocument();
    expect(ocultoEnMovil("calidad-panel-ficha")).toBe(false);

    fireEvent.click(botonSaltoDeFicha("Anterior"));
    expect(screen.getByText("Lote 26090201")).toBeInTheDocument();
  });
});
