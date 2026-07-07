import { describe, expect, it } from "vitest";
import { extraerRecuerdos, formatearMemoriasParaPrompt, type MemoriaRow } from "./chatMemoria";

describe("extraerRecuerdos", () => {
  it("devuelve el texto tal cual cuando no hay etiquetas", () => {
    const texto = "El DJPMN de esta semana está en verde (2,1%).";
    const { textoLimpio, recuerdos } = extraerRecuerdos(texto);
    expect(textoLimpio).toBe(texto);
    expect(recuerdos).toEqual([]);
  });

  it("extrae una única etiqueta al final de la respuesta", () => {
    const texto = "Entendido, a partir de ahora usaré ese objetivo.\n\n[[recordar objetivo-tph: El objetivo de T/h acordado con el usuario es 15 T/h, no 14,5]]";
    const { textoLimpio, recuerdos } = extraerRecuerdos(texto);
    expect(textoLimpio).toBe("Entendido, a partir de ahora usaré ese objetivo.");
    expect(recuerdos).toEqual([
      { clave: "objetivo-tph", contenido: "El objetivo de T/h acordado con el usuario es 15 T/h, no 14,5" },
    ]);
  });

  it("extrae varias etiquetas (1-2 por respuesta) y limpia ambas del texto visible", () => {
    const texto = [
      "Anotado, gracias por la corrección.",
      "[[recordar turno-tarde: El turno de tarde empieza a las 15:00, no a las 14:00]]",
      "[[recordar productor-preferido: El usuario suele preguntar primero por el productor Finca Lasarte]]",
    ].join("\n");
    const { textoLimpio, recuerdos } = extraerRecuerdos(texto);
    expect(textoLimpio).toBe("Anotado, gracias por la corrección.");
    expect(recuerdos).toHaveLength(2);
    expect(recuerdos[0]).toEqual({ clave: "turno-tarde", contenido: "El turno de tarde empieza a las 15:00, no a las 14:00" });
    expect(recuerdos[1]).toEqual({ clave: "productor-preferido", contenido: "El usuario suele preguntar primero por el productor Finca Lasarte" });
  });

  it("es tolerante a espacios extra y mayúsculas en la palabra clave", () => {
    const texto = "Vale.\n[[ RECORDAR   objetivo-tph :   15 T/h es el objetivo   ]]";
    const { textoLimpio, recuerdos } = extraerRecuerdos(texto);
    expect(textoLimpio).toBe("Vale.");
    expect(recuerdos).toEqual([{ clave: "objetivo-tph", contenido: "15 T/h es el objetivo" }]);
  });

  it("normaliza la clave a minúsculas y colapsa espacios internos del contenido", () => {
    const texto = "[[recordar Objetivo-TPH: línea   con\n  saltos   internos]]";
    const { recuerdos } = extraerRecuerdos(texto);
    expect(recuerdos).toEqual([{ clave: "objetivo-tph", contenido: "línea con saltos internos" }]);
  });

  it("ignora etiquetas malformadas sin cierre ']]' y conserva el texto tal cual", () => {
    const texto = "Respuesta normal. [[recordar objetivo-tph: falta el cierre";
    const { textoLimpio, recuerdos } = extraerRecuerdos(texto);
    expect(textoLimpio).toBe(texto);
    expect(recuerdos).toEqual([]);
  });

  it("ignora etiquetas con clave vacía (no matchea, se deja el texto intacto) o contenido vacío (se limpia sin generar recuerdo)", () => {
    const texto = "Texto. [[recordar : contenido sin clave]] Más texto. [[recordar clave-sola:   ]] Fin.";
    const { textoLimpio, recuerdos } = extraerRecuerdos(texto);
    expect(recuerdos).toEqual([]);
    // La etiqueta sin clave no cumple el patrón de clave y se deja tal cual;
    // la de contenido vacío sí matchea el patrón y se elimina del texto visible.
    expect(textoLimpio).toBe("Texto. [[recordar : contenido sin clave]] Más texto.  Fin.");
  });

  it("devuelve vacío para texto vacío", () => {
    expect(extraerRecuerdos("")).toEqual({ textoLimpio: "", recuerdos: [] });
  });

  it("limpia líneas en blanco sobrantes dejadas por la etiqueta eliminada", () => {
    const texto = "Primera línea.\n\n[[recordar clave-x: contenido x]]\n\nSegunda línea.";
    const { textoLimpio } = extraerRecuerdos(texto);
    expect(textoLimpio).toBe("Primera línea.\n\nSegunda línea.");
  });
});

describe("formatearMemoriasParaPrompt", () => {
  const base: MemoriaRow = {
    id: "1",
    clave: "objetivo-tph",
    contenido: "El objetivo de T/h acordado es 15 T/h",
    origen: "el usuario dijo que el objetivo real es 15",
    user_id: "u1",
    activa: true,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-02T00:00:00Z",
  };

  it("devuelve cadena vacía si no hay memorias", () => {
    expect(formatearMemoriasParaPrompt([])).toBe("");
  });

  it("formatea un bloque compacto con encabezado y viñetas por contenido", () => {
    const memorias: MemoriaRow[] = [
      base,
      { ...base, id: "2", clave: "turno-tarde", contenido: "El turno de tarde empieza a las 15:00" },
    ];
    const resultado = formatearMemoriasParaPrompt(memorias);
    expect(resultado).toContain("MEMORIA PERSISTENTE (hechos aprendidos en conversaciones anteriores):");
    expect(resultado).toContain("- El objetivo de T/h acordado es 15 T/h");
    expect(resultado).toContain("- El turno de tarde empieza a las 15:00");
    expect(resultado.split("\n")).toHaveLength(3);
  });
});
