// Campo → Previsión de campaña: que la pantalla diga lo que el cálculo dice.
//
// Lo que se comprueba es lo que puede engañar a quien planifica:
//  - los kilos previstos son los del año pasado, sin retoques;
//  - la ventana de Aerobotics NO mueve el calendario, solo avisa cuando la
//    fruta se cogió fuera de ella;
//  - y el aviso de que esto es un orden de magnitud está siempre a la vista,
//    porque solo hay una campaña de historia.
import { render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import type { CampoParcelaRow, CurvaCrecimiento } from "@/lib/campoParcelas";

// Campaña 2025/26: La Torrecilla entrega en noviembre; El Soto, en diciembre.
const ENTRADAS = [
  { finca: "La Torrecilla", parcela: "La Torrecilla Salustiana", agricultor: "CAMBA", articulo: "NARANJA SALUSTIANA", fecha: "2025-11-10", kg_entrada: 300000 },
  { finca: "El Soto", parcela: "EL SOTO Navelinas", agricultor: "GAONA", articulo: "NARANJA NAVELINA", fecha: "2025-12-08", kg_entrada: 120000 },
  // Esto no es campo: no puede aparecer en una previsión de recolección.
  { finca: "PREC 1 ALMACEN", parcela: "PRE1 Navelina", agricultor: "ALMACEN", articulo: "NARANJA NAVELINA", fecha: "2025-11-10", kg_entrada: 90000 },
  { finca: "Importacion", parcela: "Valencia SAF", agricultor: "HG", articulo: "NARANJA MIDKNIGHT SAF", fecha: "2025-11-10", kg_entrada: 80000 },
];

const FICHAS: CampoParcelaRow[] = [{
  id: "p1", origen: "aerobotics", origen_finca_id: "26248", origen_finca_nombre: "Torrecilla",
  nombre: "TORRECILLA", hectareas: 10, cultivo: "Orange", variedad: "Salustiana",
  plantacion: null, patron: null, contorno: [], centro_lon: null, centro_lat: null,
  finca: "La Torrecilla", parcela: "La Torrecilla Salustiana",
  emparejado_estado: "clara", emparejado_puntuacion: 1, emparejado_nota: null,
}];

// Aerobotics dice que la Salustiana de Torrecilla no está lista hasta la W49,
// y el año pasado se cogió en la W46: tres semanas antes.
const CURVAS: CurvaCrecimiento[] = [{
  id: "c1", finca_nombre: "Torrecilla", variedad: "Salustiana", floracion_semana: "2026W21",
  ventana: "2026W49 - 2026W52", ventana_desde: "2026W49", ventana_hasta: "2026W52",
  crecimiento: {}, fuente: "previous_season_sizes",
}];

vi.mock("@/contexts/AuthProvider", () => ({
  useAuth: () => ({ user: { id: "u1" }, role: "campo", session: null, loading: false, signOut: vi.fn() }),
}));
vi.mock("@/hooks/useEntradasBascula", () => ({
  useEntradasBascula: () => ({ entradas: ENTRADAS, isLoading: false }),
}));
vi.mock("@/hooks/useCampoParcelas", () => ({
  useCampoParcelas: () => ({ fichas: FICHAS, isLoading: false, error: null }),
  useCampoCalibre: () => ({ medidas: [], curvas: CURVAS, isLoading: false, error: null }),
}));

import CampoPrevision from "./CampoPrevision";

function renderPagina() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <CampoPrevision />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function filaCon(texto: string): HTMLElement {
  const fila = screen.getByText(texto).closest("tr");
  if (!fila) throw new Error(`No hay fila para "${texto}"`);
  return fila;
}

describe("Campo → Previsión de campaña", () => {
  it("prevé la campaña siguiente a partir de la anterior", () => {
    renderPagina();
    expect(screen.getByText(/Previsión de campaña 2026\/27/)).toBeTruthy();
    expect(screen.getByText(/campaña 2025\/26/)).toBeTruthy();
  });

  it("los kilos previstos son los del año pasado, sin retoques", () => {
    renderPagina();
    expect(screen.getByText(/Se esperan 420.000 kg de 2 parcelas/)).toBeTruthy();
    expect(within(filaCon("La Torrecilla Salustiana")).getByText("300.000 kg")).toBeTruthy();
  });

  it("el precalibrado y la importación no se prevén", () => {
    renderPagina();
    expect(screen.queryByText("PRE1 Navelina")).toBeNull();
    expect(screen.queryByText("Valencia SAF")).toBeNull();
  });

  it("la fruta va en la semana del año pasado, un año después", () => {
    renderPagina();
    // 10-11-2025 es la semana 46; la previsión la coloca en la 46 de 2026.
    expect(within(filaCon("La Torrecilla Salustiana")).getByText("S46 '26")).toBeTruthy();
  });

  it("avisa de que se cogió antes de lo que Aerobotics da por listo, sin mover la fecha", () => {
    renderPagina();
    const fila = filaCon("La Torrecilla Salustiana");
    expect(within(fila).getByText("Se cogió 3 semanas antes")).toBeTruthy();
    expect(within(fila).getByText(/Aerobotics: S49 '26 – S52 '26/)).toBeTruthy();
    // La semana prevista sigue siendo la del año pasado, no la de la ventana.
    expect(within(fila).getByText("S46 '26")).toBeTruthy();
  });

  it("una parcela sin ventana lo dice, en vez de aparentar que cuadra", () => {
    renderPagina();
    expect(within(filaCon("EL SOTO Navelinas")).getByText("Sin ventana")).toBeTruthy();
  });

  it("el aviso de que esto no es una promesa está siempre a la vista", () => {
    renderPagina();
    expect(screen.getByText(/orden de magnitud, no una promesa/)).toBeTruthy();
    expect(screen.getByText(/el cítrico vecea/)).toBeTruthy();
  });
});
