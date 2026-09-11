// La marca de revisión del parte, vista desde la app.
//
// Lo que protege: que el panel diga la verdad sobre el día. Un parte que no
// cuadra pintado en verde es peor que no pintar nada — quien lo abre se fía de
// los KPI que tiene justo debajo. Y al revés: un día bueno marcado en ámbar
// entrena a la gente a ignorar la marca.
//
// También protege la frontera con "Validado": esto dice "la máquina lo repasó",
// nunca "una persona lo firmó" (regla del dueño del 28-08-2026).
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import PartDetailRevision, { type ParteRevision } from "./PartDetailRevision";

const EN_ORDEN: ParteRevision = {
  revisado_at: "2026-09-11T07:41:11.635Z",
  veredicto: "en-orden",
  comprobaciones: [
    { clave: "parte", titulo: "El parte del día existe", estado: "ok", detalle: 'en estado "Analizado"' },
    { clave: "gstock", titulo: "GSTOCK del día", estado: "ok", detalle: "13.727 kg" },
    { clave: "papel", titulo: "Los cinco datos del papel", estado: "n/a", detalle: "día sin actividad" },
  ],
  reparaciones: [],
  diagnostico: [],
};

const CON_REPAROS: ParteRevision = {
  revisado_at: "2026-09-11T07:41:11.635Z",
  veredicto: "con-reparos",
  comprobaciones: [
    { clave: "parte", titulo: "El parte del día existe", estado: "ok", detalle: 'en estado "Analizado"' },
    { clave: "gstock", titulo: "GSTOCK del día", estado: "ok", detalle: "13.727 kg" },
    {
      clave: "papel", titulo: "Los cinco datos del papel", estado: "reparo",
      detalle: "nadie los ha metido todavía", fallo: "el papel sin teclear",
    },
  ],
  reparaciones: ["Se rehizo el parte del 2026-09-10: informes subido, análisis analizado."],
  diagnostico: ["El papel del día todavía no se ha tecleado. Si nadie lo mete, se estimará el 2026-09-12."],
};

describe("PartDetailRevision", () => {
  it("no pinta nada si el parte no se ha revisado nunca", () => {
    const { container } = render(<PartDetailRevision revision={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("un día en orden lo dice, y no cuenta las comprobaciones que no aplican", () => {
    render(<PartDetailRevision revision={EN_ORDEN} />);
    expect(screen.getByText(/el parte está en orden \(2 comprobaciones\)/i)).toBeInTheDocument();
  });

  it("un día con reparos dice cuántos fallan y cuáles, con su detalle", () => {
    render(<PartDetailRevision revision={CON_REPAROS} />);
    // Las tres cuentan (ninguna es "n/a"), y falla una.
    expect(screen.getByText(/1 de 3 comprobaciones no pasan/i)).toBeInTheDocument();
    expect(screen.getByText(/Los cinco datos del papel/)).toBeInTheDocument();
    expect(screen.getByText(/nadie los ha metido todavía/)).toBeInTheDocument();
  });

  it("cuenta lo que la tarea arregló sola", () => {
    render(<PartDetailRevision revision={CON_REPAROS} />);
    expect(screen.getByText(/Se arregló solo/i)).toBeInTheDocument();
    expect(screen.getByText(/Se rehizo el parte del 2026-09-10/)).toBeInTheDocument();
  });

  it("y la valoración de qué se cree que ha pasado", () => {
    render(<PartDetailRevision revision={CON_REPAROS} />);
    expect(screen.getByText(/Qué se cree que ha pasado/i)).toBeInTheDocument();
    expect(screen.getByText(/se estimará el 2026-09-12/)).toBeInTheDocument();
  });

  it("la lista entera está plegada hasta que alguien la pide", () => {
    render(<PartDetailRevision revision={EN_ORDEN} />);
    expect(screen.queryByText(/GSTOCK del día/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /ver las comprobaciones/i }));
    expect(screen.getByText(/GSTOCK del día/)).toBeInTheDocument();
    expect(screen.getByText(/día sin actividad/)).toBeInTheDocument();
  });

  it("dice cuándo se repasó: una marca sin fecha no vale de nada", () => {
    render(<PartDetailRevision revision={EN_ORDEN} />);
    expect(screen.getByText(/Repasado el/)).toBeInTheDocument();
  });

  it("nunca dice que el parte esté validado ni firmado", () => {
    const { container } = render(<PartDetailRevision revision={EN_ORDEN} />);
    expect(container.textContent).not.toMatch(/validad|firmad/i);
  });
});
