// El estándar por régimen tiene UNA fuente de verdad desde el 04-09-2026: la
// tabla public.estandar_rendimiento (la edita el admin desde la app, Económico →
// Rentabilidad → Por tipo de día). Lo demás son traducciones de esa fila:
// - ESTANDAR_RENDIMIENTO (TypeScript) es el RESPALDO cuando la tabla no se
//   puede leer; conserva los valores del 27-08 y no tiene por qué seguir a la
//   tabla cuando el dueño suba el listón.
// - scripts/informe-produccion/estandar.json es un ESPEJO de la tabla para los
//   informes en Python de la encargada y el correo diario, que regenera
//   scripts/sincronizar-estandar.mjs (con el mismo formato de siempre).
// Este test vigila que fila ↔ estándar sea una identidad (lo que se guarda es
// lo que se lee) y que el espejo siga teniendo la forma del tipo; ya no exige
// que TS y JSON digan lo mismo, porque el JSON sigue a la tabla y el TS no.
import { describe, expect, it } from "vitest";
import estandarJson from "../../scripts/informe-produccion/estandar.json";
import {
  calidadDia,
  ESTANDAR_RENDIMIENTO,
  estandarDesdeFila,
  filaDesdeEstandar,
  LIMITES_ESTANDAR,
  ORDEN_TIPOS_DIA,
  regimenPlantilla,
  tipoDia,
  validarEstandarRendimiento,
  type EstandarRendimiento,
  type FilaEstandarRendimiento,
} from "./estandarRendimiento";

const OTRO: EstandarRendimiento = {
  cortePlantillaReducida: 30,
  regimenes: {
    completa: { kgPersonaSuelo: 1800, kgPersonaObjetivo: 2200 },
    reducida: { kgPersonaSuelo: 2300, kgPersonaObjetivo: 2700 },
  },
  decididoPor: "el dueño",
  fecha: "2026-10-05",
  nota: "Subido tras clavar el objetivo en septiembre.",
};

describe("estándar de rendimiento: fila de la tabla ↔ estándar", () => {
  it("estandarDesdeFila(filaDesdeEstandar(x)) es identidad: lo que se guarda es lo que se lee", () => {
    const vigente: EstandarRendimiento = { ...ESTANDAR_RENDIMIENTO, nota: null };
    expect(estandarDesdeFila(filaDesdeEstandar(vigente))).toEqual(vigente);
    expect(estandarDesdeFila(filaDesdeEstandar(OTRO))).toEqual(OTRO);
  });

  it("filaDesdeEstandar escribe las columnas de la migración, tal cual, sin id ni sello", () => {
    expect(filaDesdeEstandar({ ...ESTANDAR_RENDIMIENTO, nota: "n" })).toEqual({
      corte_plantilla_reducida: 35,
      completa_suelo: 1700,
      completa_objetivo: 2100,
      reducida_suelo: 2200,
      reducida_objetivo: 2600,
      decidido_por: "el dueño",
      fecha: "2026-08-27",
      nota: "n",
    });
  });

  it("sin fila (tabla vacía o ilegible) devuelve el respaldo del 27-08 tal cual", () => {
    expect(estandarDesdeFila(null)).toBe(ESTANDAR_RENDIMIENTO);
    expect(estandarDesdeFila(undefined)).toBe(ESTANDAR_RENDIMIENTO);
  });

  it("acepta la fila completa de PostgREST, coerce números en texto y rellena huecos con el respaldo", () => {
    const fila: FilaEstandarRendimiento = {
      id: true,
      ...filaDesdeEstandar(OTRO),
      // Otro cliente podría traer los enteros como texto: se leen igual.
      completa_suelo: "1850" as unknown as number,
      updated_at: "2026-10-05T07:00:00Z",
      updated_by: null,
    };
    const est = estandarDesdeFila(fila);
    expect(est.regimenes.completa.kgPersonaSuelo).toBe(1850);
    expect(est.regimenes.reducida).toEqual(OTRO.regimenes.reducida);
    expect(est.decididoPor).toBe("el dueño");
    // Una columna a null toma el valor por defecto SOLO en ese campo.
    const aMedias = estandarDesdeFila({ ...fila, reducida_objetivo: null as unknown as number, decidido_por: null });
    expect(aMedias.regimenes.reducida.kgPersonaObjetivo).toBe(ESTANDAR_RENDIMIENTO.regimenes.reducida.kgPersonaObjetivo);
    expect(aMedias.regimenes.reducida.kgPersonaSuelo).toBe(2300);
    expect(aMedias.decididoPor).toBe(ESTANDAR_RENDIMIENTO.decididoPor);
  });

  it("el espejo scripts/informe-produccion/estandar.json sigue siendo válido contra el tipo", () => {
    // Si esto deja de compilar, el JSON ya no tiene la forma que leen Python y
    // el correo diario: lo regenera scripts/sincronizar-estandar.mjs, no se
    // edita a mano.
    const espejo: EstandarRendimiento = estandarJson;
    expect(validarEstandarRendimiento(espejo)).toEqual([]);
    expect(estandarDesdeFila(filaDesdeEstandar(espejo))).toEqual(espejo);
    expect(Object.keys(estandarJson)).toEqual(["cortePlantillaReducida", "regimenes", "decididoPor", "fecha", "nota"]);
    expect(typeof estandarJson.nota).toBe("string");
  });
});

describe("validarEstandarRendimiento", () => {
  it("el respaldo y el espejo son válidos", () => {
    expect(validarEstandarRendimiento(ESTANDAR_RENDIMIENTO)).toEqual([]);
    expect(validarEstandarRendimiento(OTRO)).toEqual([]);
  });

  it("suelo ≥ objetivo, corte fuera de 1-200, kg no enteros, sin decisor o sin fecha: cada uno con su motivo", () => {
    const malo: EstandarRendimiento = {
      cortePlantillaReducida: 0,
      regimenes: {
        completa: { kgPersonaSuelo: 2100, kgPersonaObjetivo: 2100 },
        reducida: { kgPersonaSuelo: 2200.5, kgPersonaObjetivo: 2600 },
      },
      decididoPor: "   ",
      fecha: "27-08-2026",
    };
    const problemas = validarEstandarRendimiento(malo);
    expect(problemas).toHaveLength(5);
    expect(problemas.some((p) => /corte/i.test(p))).toBe(true);
    expect(problemas.some((p) => /plantilla completa.*suelo \(2100\).*objetivo \(2100\)/.test(p))).toBe(true);
    expect(problemas.some((p) => /plantilla reducida.*enteros/.test(p))).toBe(true);
    expect(problemas.some((p) => /quién decide/.test(p))).toBe(true);
    expect(problemas.some((p) => /fecha/.test(p))).toBe(true);
  });

  it("el corte admite justo 1 y 200 personas, y rechaza 201 y los decimales", () => {
    const con = (corte: number) => validarEstandarRendimiento({ ...OTRO, cortePlantillaReducida: corte });
    expect(con(LIMITES_ESTANDAR.corteMin)).toEqual([]);
    expect(con(LIMITES_ESTANDAR.corteMax)).toEqual([]);
    expect(con(201)).toHaveLength(1);
    expect(con(35.5)).toHaveLength(1);
    expect(con(Number.NaN)).toHaveLength(1);
  });
});

describe("estándar de rendimiento: cómo se aplica", () => {
  it("≤35 presentes es media plantilla; 36 con faltas sigue siendo completa (definición del dueño)", () => {
    expect(regimenPlantilla(27)).toBe("reducida");
    expect(regimenPlantilla(35)).toBe("reducida");
    expect(regimenPlantilla(36)).toBe("completa");
    expect(regimenPlantilla(45)).toBe("completa");
  });

  it("con otro estándar (el de la tabla) el corte y los listones son los suyos", () => {
    expect(regimenPlantilla(31, OTRO)).toBe("completa");
    expect(regimenPlantilla(30, OTRO)).toBe("reducida");
    expect(calidadDia(2199, "completa", OTRO)).toBe("medio");
    expect(calidadDia(2200, "completa", OTRO)).toBe("bueno");
    expect(calidadDia(2299, "reducida", OTRO)).toBe("malo");
  });

  it("cada régimen tiene su listón", () => {
    expect(calidadDia(2100, "completa")).toBe("bueno");
    expect(calidadDia(1700, "completa")).toBe("medio");
    expect(calidadDia(1699, "completa")).toBe("malo");
    expect(calidadDia(2100, "reducida")).toBe("malo");
    expect(calidadDia(2200, "reducida")).toBe("medio");
    expect(calidadDia(2600, "reducida")).toBe("bueno");
  });

  it("los seis tipos, completa primero", () => {
    expect(ORDEN_TIPOS_DIA).toEqual([
      "Plantilla completa · día bueno", "Plantilla completa · día medio", "Plantilla completa · día malo",
      "Plantilla reducida · día bueno", "Plantilla reducida · día medio", "Plantilla reducida · día malo",
    ]);
    expect(tipoDia("reducida", "medio")).toBe("Plantilla reducida · día medio");
  });
});
