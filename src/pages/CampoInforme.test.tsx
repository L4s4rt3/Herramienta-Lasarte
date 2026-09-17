// Campo → Informe de finca: que la pantalla haga lo que promete.
//
// Lo que se comprueba es lo que decide si alguien puede hacer el informe solo:
//  - se elige la finca de una lista que junta lo dibujado y lo que ha entregado;
//  - la finca sin informe lo dice y ofrece crearlo, en vez de quedarse en blanco;
//  - lo que va a faltar en el documento se avisa ANTES de generarlo;
//  - y el panel enseña lo que el informe pone solo, para que se vea que no hay
//    que teclear el calibre ni el historial.
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CampoParcelaRow } from "@/lib/campoParcelas";
import type { InformeCampoRow } from "@/lib/campoInforme";

const FICHAS: CampoParcelaRow[] = [{
  id: "p1", origen: "aerobotics", origen_finca_id: "1", origen_finca_nombre: "GANCHAL",
  nombre: "GANCHAL", hectareas: 16.29, cultivo: "Orange", variedad: "Salustiana",
  plantacion: null, patron: null, contorno: [], centro_lon: null, centro_lat: null,
  finca: "Ganchal", parcela: null, emparejado_estado: "clara", emparejado_puntuacion: 1, emparejado_nota: null,
}];

const ENTRADAS = [
  { finca: "Ganchal", parcela: null, agricultor: "X", articulo: "NARANJA SALUSTIANA", lote: "26010101", fecha: "2026-01-01", kg_entrada: 20000 },
];

const INFORME: InformeCampoRow = {
  id: "i1", finca: "Ganchal", fecha_visita: "2026-09-04", personal: "José María y Luis Navas",
  apoyo_tecnico: "Aerobotics", semana_muestreo: "2026W36", objetivo_mm: 64, objetivo_nota: "Cítrica",
  horizonte_semana: null, antecedentes: null, contexto: null, conclusion: null, estado: "borrador",
};

const crear = vi.fn(async () => "i2");
let informes: InformeCampoRow[] = [];

vi.mock("@/contexts/AuthProvider", () => ({
  useAuth: () => ({ user: { id: "u1" }, role: "campo", session: null, loading: false, signOut: vi.fn() }),
}));
vi.mock("@/hooks/useEntradasBascula", () => ({
  useEntradasBascula: () => ({ entradas: ENTRADAS, isLoading: false }),
}));
vi.mock("@/hooks/useCampoParcelas", () => ({
  useCampoParcelas: () => ({ fichas: FICHAS, isLoading: false, error: null }),
  useCampoCalibre: () => ({ medidas: [], curvas: [], isLoading: false, error: null }),
  fetchCampoParcelas: async () => FICHAS,
  fetchCampoCalibre: async () => ({ medidas: [], curvas: [] }),
}));
vi.mock("@/hooks/useCampoInformes", async () => {
  const real = await vi.importActual<typeof import("@/hooks/useCampoInformes")>("@/hooks/useCampoInformes");
  return {
    ...real,
    useCampoInformes: () => ({
      informes, isLoading: false, error: null, crear, guardar: vi.fn(), borrar: vi.fn(), guardando: false,
    }),
    useDetalleInforme: () => ({
      puntos: [], imagenes: [], isLoading: false,
      guardarPunto: vi.fn(), borrarPunto: vi.fn(), subirImagen: vi.fn(), borrarImagen: vi.fn(), trabajando: false,
    }),
    useDatosDeFinca: () => ({ entradas: ENTRADAS, clasif: [], isLoading: false }),
    generarYEntregarInformeCampo: vi.fn(async () => "Informe_campo_Ganchal_2026-09-04.docx"),
  };
});

import CampoInforme from "./CampoInforme";

/** La finca se elige por la URL, igual que hará el enlace desde Campo → Parcelas. */
function renderPagina(finca?: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[finca ? `/campo/informe?finca=${encodeURIComponent(finca)}` : "/campo/informe"]}>
        <CampoInforme />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("Campo → Informe de finca", () => {
  beforeEach(() => {
    informes = [];
    crear.mockClear();
  });

  it("explica de entrada que solo se teclea lo que nadie más sabe", () => {
    renderPagina();
    expect(screen.getByRole("heading", { name: /informe de finca/i })).toBeInTheDocument();
    expect(screen.getByText(/el calibre, la previsión y lo que/i)).toBeInTheDocument();
  });

  it("la finca sin informe no deja la pantalla en blanco: dice cómo crearlo", async () => {
    renderPagina("Ganchal");
    expect(await screen.findByText(/no tiene ningún informe todavía/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /nuevo/i }));
    await waitFor(() => expect(crear).toHaveBeenCalledWith(expect.objectContaining({ finca: "Ganchal", objetivo_mm: 64 })));
  });

  it("con informe abierto avisa de lo que va a faltar antes de generarlo", async () => {
    informes = [INFORME];
    renderPagina("Ganchal");

    expect(await screen.findByText(/sale sin esto/i)).toBeInTheDocument();
    // Sin contorno ni coordenadas el mapa no se puede dibujar, y el aviso lo dice.
    expect(screen.getByText(/no hay contorno ni coordenadas con los que dibujarlo/i)).toBeInTheDocument();
    expect(screen.getByText(/aerobotics no tiene medidas de calibre/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /generar informe/i })).toBeEnabled();
  });

  it("enseña lo que el informe pone solo, para no teclearlo dos veces", async () => {
    informes = [INFORME];
    renderPagina("Ganchal");

    // El panel está y dice lo que sabe de calibre: eso es lo que evita teclearlo.
    // (Qué números salen del historial lo prueban los tests de campoInforme.ts,
    // que es donde se calculan; aquí se comprueba que la pantalla los pide.)
    expect(await screen.findByText(/lo que el informe pone solo/i)).toBeInTheDocument();
    expect(screen.getByText(/calibre de aerobotics/i)).toBeInTheDocument();
    expect(screen.getByText(/sin medidas casadas con esta finca/i)).toBeInTheDocument();
    expect(screen.getByText(/la previsión no llega a los 64 mm/i)).toBeInTheDocument();
    expect(screen.getByText(/lo que ha dado la finca/i)).toBeInTheDocument();
  });

  it("los tres huecos de captura de Aeroview están siempre a la vista", async () => {
    informes = [INFORME];
    renderPagina("Ganchal");

    // Cada hueco aparece dos veces: su título y el aviso de que falta.
    expect(await screen.findAllByText(/estructura de tamaño/i)).not.toHaveLength(0);
    expect(screen.getAllByText(/mapa con los puntos/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/modelización de evolución/i).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: /subir/i }).length).toBeGreaterThanOrEqual(3);
  });
});
