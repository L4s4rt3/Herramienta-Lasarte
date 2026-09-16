// Campo → Parcelas: que la tabla diga lo que tiene que decir.
//
// Lo que se comprueba es justo lo que puede mentir:
//  - las hectáreas y los kilos por hectárea salen de dos sitios distintos
//    (Aerobotics y la báscula) y solo valen si el emparejamiento es de fiar;
//  - una parcela emparejada "probable" NO puede enseñar kg/ha, porque dividir
//    kilos entre unas hectáreas que a lo mejor no son las suyas es inventar;
//  - una cifra imposible se marca, no se esconde;
//  - y lo que no se sabe sale con raya, nunca con un cero.
import { render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import type { CampoParcelaRow } from "@/lib/campoParcelas";

const ENTRADAS = [
  // 300.000 kg en 10 ha → 30.000 kg/ha, creíble.
  { lote: "26011501", fecha: "2026-01-15", finca: "La Torrecilla", parcela: "La Torrecilla Salustiana", agricultor: "CAMBA S.C.", articulo: "NARANJA SALUSTIANA", kg_entrada: 300000, certificada: true, certificado_ggn: "4049928123456" },
  // 162.540 kg sobre 1,55 ha → 104.865 kg/ha: imposible, hay que revisarlo.
  { lote: "26011502", fecha: "2026-01-16", finca: "La Vereda", parcela: "La Vereda Navelinas", agricultor: "BALCA NARANJOS S.L.", articulo: "NARANJA NAVELINA", kg_entrada: 162540, certificada: false, certificado_ggn: null },
  // Emparejamiento dudoso: tiene ficha, pero no puede dar kg/ha.
  { lote: "26011503", fecha: "2026-01-17", finca: "Los Corrales - GG", parcela: "Los Corrales BRN Navel Powell", agricultor: "COVIDESA", articulo: "NARANJA NAVEL POWEL", kg_entrada: 500000, certificada: false, certificado_ggn: null },
  // Sin ninguna ficha de campo.
  { lote: "26011504", fecha: "2026-01-18", finca: "El Remolino", parcela: "El Remolino Salustiana", agricultor: "SERAFIN LOPERA", articulo: "NARANJA SALUSTIANA", kg_entrada: 117040, certificada: false, certificado_ggn: null },
];

function ficha(p: Partial<CampoParcelaRow> & { id: string }): CampoParcelaRow {
  return {
    origen: "aerobotics", origen_finca_id: "26248", origen_finca_nombre: "Torrecilla", nombre: "TORRECILLA", hectareas: 10,
    cultivo: "Orange", variedad: "Salustiana", plantacion: null, patron: null,
    contorno: [], centro_lon: -5.1, centro_lat: 37.7,
    finca: "La Torrecilla", parcela: "La Torrecilla Salustiana",
    emparejado_estado: "clara", emparejado_puntuacion: 1, emparejado_nota: null,
    ...p,
  };
}

const FICHAS: CampoParcelaRow[] = [
  // La Torrecilla parte en dos trozos que suman 10 ha.
  ficha({ id: "t1", hectareas: 6 }),
  ficha({ id: "t2", nombre: "TORRECILLA 2", hectareas: 4 }),
  ficha({ id: "v1", nombre: "LA VEREDA", hectareas: 1.55, finca: "La Vereda", parcela: "La Vereda Navelinas", variedad: "Navelina" }),
  ficha({ id: "c1", nombre: "COVIDESA", hectareas: 15.97, finca: "Los Corrales - GG", parcela: "Los Corrales BRN Navel Powell", emparejado_estado: "probable", emparejado_puntuacion: 0.567 }),
];

vi.mock("@/contexts/AuthProvider", () => ({
  useAuth: () => ({ user: { id: "u1" }, role: "campo", session: null, loading: false, signOut: vi.fn() }),
}));

vi.mock("@/hooks/useEntradasBascula", () => ({
  useEntradasBascula: () => ({ entradas: ENTRADAS, isLoading: false }),
}));

vi.mock("@/hooks/useCampoParcelas", () => ({
  useCampoParcelas: () => ({ fichas: FICHAS, isLoading: false, error: null }),
}));

import CampoParcelas from "./CampoParcelas";

function renderPagina() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <CampoParcelas />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** La fila de la tabla que contiene ese texto. */
function filaCon(texto: string): HTMLElement {
  const celda = screen.getByText(texto);
  const fila = celda.closest("tr");
  if (!fila) throw new Error(`No hay fila para "${texto}"`);
  return fila;
}

/** Las dos columnas que trae Aerobotics, por posición: hectáreas y kg por ha. */
function columnasDeCampo(fila: HTMLElement): { hectareas: string; kgPorHa: string } {
  const celdas = [...fila.querySelectorAll("td")].map((c) => c.textContent?.trim() ?? "");
  return { hectareas: celdas[6], kgPorHa: celdas[7] };
}

describe("Campo → Parcelas", () => {
  it("suma los trozos de Aerobotics y calcula los kilos por hectárea", () => {
    renderPagina();
    const fila = filaCon("La Torrecilla Salustiana");
    expect(within(fila).getByText("10,00 ha")).toBeTruthy();
    expect(within(fila).getByText("(2 trozos)")).toBeTruthy();
    expect(within(fila).getByText("30.000")).toBeTruthy();
  });

  it("marca en rojo el rendimiento imposible en vez de esconderlo", () => {
    renderPagina();
    const fila = filaCon("La Vereda Navelinas");
    const celda = within(fila).getByText("104.865");
    expect(celda.className).toContain("text-red-600");
  });

  it("una parcela con emparejamiento dudoso no enseña hectáreas ni kg/ha", () => {
    renderPagina();
    const fila = filaCon("Los Corrales BRN Navel Powell");
    // Raya en las dos, nunca un cero, aunque su ficha diga 15,97 ha: mientras
    // el emparejamiento sea "probable", esas hectáreas no son suyas todavía.
    expect(columnasDeCampo(fila)).toEqual({ hectareas: "—", kgPorHa: "—" });
    expect(within(fila).queryByText(/15,97/)).toBeNull();
  });

  it("una parcela sin ficha de campo tampoco inventa nada", () => {
    renderPagina();
    expect(columnasDeCampo(filaCon("El Remolino Salustiana"))).toEqual({ hectareas: "—", kgPorHa: "—" });
  });

  it("la media de arriba solo la sostienen las parcelas con cifra creíble", () => {
    renderPagina();
    // Creíble solo La Torrecilla: 300.000 kg en 10 ha.
    expect(screen.getByText(/1 parcelas dan una cifra creíble/)).toBeTruthy();
    expect(screen.getByText(/30\.000 kg\/ha de media/)).toBeTruthy();
    expect(screen.getByText(/dan una cifra imposible/)).toBeTruthy();
  });

  it("dice cuántas parcelas se quedan sin ficha de campo", () => {
    renderPagina();
    // Los Corrales (dudosa) y El Remolino (sin nada).
    expect(screen.getByText(/2 parcelas siguen sin ficha de campo/)).toBeTruthy();
  });
});
