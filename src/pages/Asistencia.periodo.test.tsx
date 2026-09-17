// RRHH → Asistencia, vista de Periodo: que la pantalla conteste las dos
// preguntas por las que se hizo (17-09-2026).
//
//  1. ¿Desde cuándo hasta cuándo hay información? Sin pasar semana a semana:
//     el tramo entero, los días que faltan por volcar y un mapa de meses
//     desde el que saltar a cualquiera.
//  2. ¿Puedo mirar un mes o una campaña, y no solo una semana? El selector
//     manda, y la tabla se adapta: rejilla día a día cuando cabe, resumen con
//     porcentaje de asistencia cuando el periodo es largo.
import { fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { enumerarDias, resumirCobertura } from "@/lib/asistenciaPeriodo";
import type { PeriodoAsistenciaRaw } from "@/lib/asistenciaSemanal";
import type { TrabajadorRow } from "@/lib/types";

// Histórico de mentirijillas con la misma forma que el real: empieza el lunes
// 18 de mayo, termina el viernes 5 de junio y le falta por volcar el miércoles
// 20 de mayo (así se comprueba que el hueco se ve).
const PRIMERA = "2026-05-18";
const ULTIMA = "2026-06-05";
const SIN_VOLCAR = "2026-05-20";

const TRABAJADORES = [
  { id: "t1", nombre: "Ana Pérez", zona: "Mallas", activo: true },
  { id: "t2", nombre: "Luis Gómez", zona: "Mesas", activo: true },
] as unknown as TrabajadorRow[];

/** Días laborables (lun-vie) con datos: todos menos el que falta por volcar. */
const DIAS_CON_DATOS = enumerarDias(PRIMERA, ULTIMA).filter((d) => {
  const dia = new Date(`${d}T12:00:00`).getDay();
  return dia !== 0 && dia !== 6 && d !== SIN_VOLCAR;
});

const COBERTURA = resumirCobertura(
  DIAS_CON_DATOS.map((fecha) => ({ fecha, registros: 2, presentes: 2, ausentes: 0 })),
);

/** Ana viene todos los días; Luis falta el primero. */
function datosDelPeriodo(desde: string, hasta: string): PeriodoAsistenciaRaw {
  const dias = DIAS_CON_DATOS.filter((d) => d >= desde && d <= hasta);
  return {
    desde,
    hasta,
    days: enumerarDias(desde, hasta),
    trabajadores: TRABAJADORES,
    asistencia: {
      t1: dias.map((date) => ({ date, presente: true, motivo_ausencia: null })),
      t2: dias.map((date, i) => ({ date, presente: i > 0, motivo_ausencia: i > 0 ? null : "asuntos propios" })),
    },
    bajasLaborales: [],
    partes: {},
  };
}

vi.mock("@/contexts/AuthProvider", () => ({
  useAuth: () => ({ user: { id: "u1" }, role: "admin", session: null, loading: false, signOut: vi.fn() }),
}));
vi.mock("@/hooks/useTrabajadoresAlias", () => ({
  useTrabajadoresAlias: () => ({ aliasPorNombre: new Map(), guardarAlias: vi.fn() }),
}));
vi.mock("@/hooks/useLimpiezaJornadaFueraLinea", () => ({
  useLimpiezaJornadaFueraLinea: () => ({ data: null }),
}));
vi.mock("@/hooks/useAsistencia", () => ({
  BAJA_LABORAL_MOTIVO: "baja_laboral",
  cargarAsistenciaPeriodo: vi.fn(),
  cargarProduccionPeriodo: vi.fn(),
  cargarSemanasAsistenciaExportables: vi.fn(),
  useAsistenciaCobertura: () => ({ cobertura: COBERTURA, isFetching: false }),
  useAsistenciaDia: () => ({
    data: { asistencia: {}, asistenciaMotivos: {}, bajasLaborales: [] },
    isFetching: false,
    toggleAsistencia: { mutateAsync: vi.fn(), isPending: false },
    limpiarAsistenciaDia: { mutateAsync: vi.fn(), isPending: false },
    marcarTodosPresentes: { mutateAsync: vi.fn(), isPending: false },
  }),
  useAsistenciaEficiencia: () => ({ eficiencia: [], isLoading: false }),
  useAsistenciaPeriodo: (desde: string, hasta: string, habilitada: boolean) => ({
    periodoData: habilitada ? datosDelPeriodo(desde, hasta) : null,
    isFetching: false,
  }),
  useAsistenciaTrabajadores: () => ({
    trabajadores: TRABAJADORES,
    query: { isLoading: false },
    crearTrabajador: { mutateAsync: vi.fn() },
  }),
  useParteDelDia: () => ({ parteDelDia: null, query: { isLoading: false } }),
  useUpsertAsistenciaRegistros: () => ({ mutateAsync: vi.fn() }),
}));

import Asistencia from "./Asistencia";

function abrirVistaPeriodo() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Asistencia />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: /^Periodo$/ }));
}

/**
 * Un texto que la interfaz parte en varios trozos (`{n} días laborables (…)`)
 * no lo encuentra getByText tal cual: este matcher busca el elemento MÁS
 * PROFUNDO cuyo texto completo encaja.
 */
function texto(regex: RegExp) {
  return (_contenido: string, element: Element | null) => {
    const encaja = (el: Element | null) => Boolean(el) && regex.test(el!.textContent ?? "");
    if (!encaja(element)) return false;
    return Array.from(element!.children).every((hijo) => !encaja(hijo));
  };
}

function panelDeCobertura(): HTMLElement {
  // La tarjeta entera, no solo el renglón del texto: dentro van también la
  // línea del periodo y el mapa de meses.
  const panel = screen.getByText(/Hay asistencia registrada del/).closest(".glass-accented");
  if (!(panel instanceof HTMLElement)) throw new Error("No encuentro el panel de cobertura");
  return panel;
}

describe("RRHH → Asistencia por periodos", () => {
  it("dice desde cuándo hasta cuándo hay información sin navegar semana a semana", () => {
    abrirVistaPeriodo();

    const panel = panelDeCobertura();
    expect(within(panel).getByText("18 may 2026")).toBeInTheDocument();
    expect(within(panel).getByText("5 jun 2026")).toBeInTheDocument();
    expect(
      within(panel).getByText(texto(new RegExp(`${DIAS_CON_DATOS.length} días volcados`))),
    ).toBeInTheDocument();
  });

  it("enseña el mapa de meses con lo que tiene cada uno", () => {
    abrirVistaPeriodo();

    // Mayo: del 18 al 31 hay 10 laborables y falta volcar uno → 9 de 10.
    expect(screen.getByRole("button", { name: /may 2026 · 9\/10/ })).toBeInTheDocument();
    // Junio: hasta el viernes 5 hay 5 laborables, todos volcados.
    expect(screen.getByRole("button", { name: /jun 2026 · 5\/5/ })).toBeInTheDocument();
  });

  it("saltar a un mes cambia el periodo entero, no solo la semana", () => {
    abrirVistaPeriodo();

    fireEvent.click(screen.getByRole("button", { name: /may 2026/ }));

    expect(screen.getByText(texto(/Mayo 2026 · 31 días/))).toBeInTheDocument();
    // Mayo de 2026 tiene 21 días de lunes a viernes.
    expect(screen.getByText(texto(/21 días laborables/))).toBeInTheDocument();
    // Un mes cabe en la rejilla: se siguen viendo los días uno a uno.
    expect(screen.getAllByText("Presente").length).toBeGreaterThan(0);
  });

  it("avisa de los días laborables que faltan por volcar", () => {
    abrirVistaPeriodo();
    fireEvent.click(screen.getByRole("button", { name: "Ver todo" }));

    // Del 18 de mayo al 5 de junio hay 15 laborables y solo falta el 20 de
    // mayo: la pantalla lo dice con nombre y apellidos, sin que nadie tenga
    // que abrir esa semana para descubrirlo.
    const panel = panelDeCobertura();
    expect(within(panel).getByText(texto(/14 de 15/))).toBeInTheDocument();
    expect(within(panel).getByText(texto(/falta por volcar 20 may 2026/))).toBeInTheDocument();
  });

  it('"Ver todo" abre el histórico completo tal cual, con el % de asistencia de cada uno', () => {
    abrirVistaPeriodo();

    fireEvent.click(screen.getByRole("button", { name: "Ver todo" }));

    // "Ver todo" pone de periodo el histórico entero, tal cual: del 18 de
    // mayo al 5 de junio, 19 días naturales.
    expect(screen.getByText(texto(/18 may – 5 jun · 19 días/))).toBeInTheDocument();

    // Ana no faltó ningún día; Luis faltó el primero: 14 de 15 laborables.
    const filaLuis = screen.getByText("Luis Gómez").closest("tr")!;
    expect(within(filaLuis).getByText("93 %")).toBeInTheDocument();
    const filaAna = screen.getByText("Ana Pérez").closest("tr")!;
    expect(within(filaAna).getByText("100 %")).toBeInTheDocument();
  });

  it("en una campaña entera deja la rejilla y se queda con el resumen", () => {
    abrirVistaPeriodo();

    fireEvent.click(screen.getByRole("button", { name: "Campaña" }));

    // Una campaña son ~365 columnas: no las lee nadie, así que la rejilla se
    // retira y se dice dónde está el día a día.
    expect(screen.getByText(texto(/el día a día está en el Excel/))).toBeInTheDocument();
    expect(screen.queryByText("Sin reg.")).not.toBeInTheDocument();
    // El resumen por trabajador sigue ahí.
    expect(screen.getByText("Ana Pérez")).toBeInTheDocument();
    expect(screen.getByText("% asist.")).toBeInTheDocument();
  });

  it("el menú de exportar ofrece el periodo elegido y la campaña entera", async () => {
    abrirVistaPeriodo();

    // El menú de Radix abre con teclado (el click de jsdom no le llega).
    fireEvent.keyDown(screen.getByRole("button", { name: /Exportar/ }), { key: "Enter" });

    expect(await screen.findByText("Periodo elegido Excel")).toBeInTheDocument();
    expect(screen.getByText("Campaña entera Excel")).toBeInTheDocument();
  });
});
