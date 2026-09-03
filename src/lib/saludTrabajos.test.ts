// La lógica que decide cuándo se avisa a una persona merece banco de pruebas:
// una falsa alarma enseña a ignorar los avisos, y un silencio indebido es
// exactamente el fallo mudo que la Fase 1 viene a matar.
//
// Todas las horas van con desfase +02:00 (Madrid en agosto) para que los tests
// no dependan de la zona horaria de la máquina que los corre.
import { describe, expect, it } from "vitest";
import { evaluarTrabajos, problemasQueAvisa, renderAvisoVigilante, type LatidoRow } from "./saludTrabajos";

const latido = (trabajo: string, visto_a: string, estado = "ok", detalle: string | null = null): LatidoRow =>
  ({ trabajo, visto_a, estado, detalle, equipo: "PORTATIL-OFICINA" });

const en = (iso: string) => new Date(iso);

function estadoDe(latidos: LatidoRow[], ahora: Date, id: string) {
  const t = evaluarTrabajos(latidos, ahora).find((x) => x.id === id);
  if (!t) throw new Error(`no existe el trabajo ${id}`);
  return t;
}

describe("evaluarTrabajos", () => {
  it("sin latidos, todo aparece como sin estrenar y sin alarma", () => {
    const salud = evaluarTrabajos([], en("2026-08-14T09:00:00+02:00"));
    expect(salud.length).toBeGreaterThanOrEqual(5);
    for (const t of salud) {
      expect(t.estado).toBe("sin-estrenar");
      expect(t.queHacer).toBeNull();
    }
  });

  describe("tarea diaria (07:40 con reintentos hasta las 12:40)", () => {
    it("corrió hoy → bien, con la hora en el texto", () => {
      const t = estadoDe([latido("tarea-diaria", "2026-08-14T07:15:00+02:00")], en("2026-08-14T09:00:00+02:00"), "tarea-diaria");
      expect(t.estado).toBe("bien");
      expect(t.titulo).toContain("07:15");
    });

    it("de madrugada no alarma aunque lo último sea de ayer", () => {
      const t = estadoDe([latido("tarea-diaria", "2026-08-13T07:12:00+02:00")], en("2026-08-14T06:00:00+02:00"), "tarea-diaria");
      expect(t.estado).toBe("bien");
      expect(t.titulo).toContain("07:40");
    });

    it("a media mañana sin correr → atención (aún quedan reintentos), no alarma", () => {
      const t = estadoDe([latido("tarea-diaria", "2026-08-13T07:12:00+02:00")], en("2026-08-14T09:00:00+02:00"), "tarea-diaria");
      expect(t.estado).toBe("atencion");
    });

    it("pasada la ventana de reintentos sin correr → mal, con los pasos para recuperar el día", () => {
      const t = estadoDe([latido("tarea-diaria", "2026-08-13T07:12:00+02:00")], en("2026-08-14T13:00:00+02:00"), "tarea-diaria");
      expect(t.estado).toBe("mal");
      expect(t.queHacer).toContain("Lasarte - Sincronizar ERP");
    });

    it("terminó con error: atención mientras se reintenta, mal cuando ya no queda reintento", () => {
      const l = [latido("tarea-diaria", "2026-08-14T07:20:00+02:00", "error", "EHOSTUNREACH 192.168.1.10")];
      expect(estadoDe(l, en("2026-08-14T08:00:00+02:00"), "tarea-diaria").estado).toBe("atencion");
      expect(estadoDe(l, en("2026-08-14T13:00:00+02:00"), "tarea-diaria").estado).toBe("mal");
    });
  });

  describe("receptor (escucha de 06:00 a 22:00, latido cada 5 min)", () => {
    it("latido reciente en horario → bien", () => {
      const t = estadoDe([latido("receptor", "2026-08-14T09:50:00+02:00")], en("2026-08-14T10:00:00+02:00"), "receptor");
      expect(t.estado).toBe("bien");
    });

    // Desde el 18-08 los informes llegan por CORREO: el receptor es el respaldo
    // de la LAN, y caído ya no se pierde nada — el aviso tiene que decir eso.
    it("dos horas mudo en horario → mal, pero deja claro que no se pierde nada (es el respaldo)", () => {
      const t = estadoDe([latido("receptor", "2026-08-14T08:00:00+02:00")], en("2026-08-14T10:00:00+02:00"), "receptor");
      expect(t.estado).toBe("mal");
      expect(t.titulo).toContain("no se pierde nada");
      expect(t.queHacer).toContain("Lasarte - Receptor calibrador");
    });

    it("de noche no alarma: el receptor no escucha fuera de su horario", () => {
      const t = estadoDe([latido("receptor", "2026-08-14T21:58:00+02:00")], en("2026-08-14T23:30:00+02:00"), "receptor");
      expect(t.estado).toBe("bien");
    });
  });

  describe("trabajos periódicos", () => {
    it("la foto de palets de hace un rato está bien; parada 30 horas es una avería", () => {
      expect(estadoDe([latido("foto-palets", "2026-08-14T08:00:00+02:00")], en("2026-08-14T10:00:00+02:00"), "foto-palets").estado).toBe("bien");
      const parado = estadoDe([latido("foto-palets", "2026-08-13T04:00:00+02:00")], en("2026-08-14T10:00:00+02:00"), "foto-palets");
      expect(parado.estado).toBe("mal");
      expect(parado.queHacer).toContain("Lasarte - Foto palets ERP");
    });

    it("el vigilante de ayer sigue siendo bien: corre una vez al día", () => {
      const t = estadoDe([latido("vigilante", "2026-08-13T13:45:00+02:00")], en("2026-08-14T10:00:00+02:00"), "vigilante");
      expect(t.estado).toBe("bien");
    });

    it("la copia de anoche es bien por la mañana; tres días sin copia es una avería con pasos", () => {
      const anoche = estadoDe([latido("copia-seguridad", "2026-08-13T21:35:00+02:00")], en("2026-08-14T10:00:00+02:00"), "copia-seguridad");
      expect(anoche.estado).toBe("bien");
      const parada = estadoDe([latido("copia-seguridad", "2026-08-11T21:35:00+02:00")], en("2026-08-14T10:00:00+02:00"), "copia-seguridad");
      expect(parada.estado).toBe("mal");
      expect(parada.queHacer).toContain("Lasarte - Copia de seguridad");
    });

    it("un pendiente conocido (estado aviso) es atención mientras siga latiendo, no alarma", () => {
      const l = [latido("foto-palets", "2026-08-14T09:30:00+02:00", "aviso", "pendiente conocido de ejemplo")];
      const t = estadoDe(l, en("2026-08-14T10:00:00+02:00"), "foto-palets");
      expect(t.estado).toBe("atencion");
      expect(t.titulo).toContain("pendiente conocido");
      // Pero si ADEMÁS deja de latir, el silencio manda: parado.
      const parado = estadoDe(l, en("2026-08-16T10:00:00+02:00"), "foto-palets");
      expect(parado.estado).toBe("mal");
    });
  });
});

describe("trabajos que hasta el 02-09-2026 latían sin que nadie los mirara", () => {
  it("el correo de rendimiento de esta mañana es bien; dos días mudo es una avería con su tarea", () => {
    const ok = estadoDe([latido("informe-rendimiento-diario", "2026-09-02T09:00:50+02:00")], en("2026-09-02T13:45:00+02:00"), "informe-rendimiento-diario");
    expect(ok.estado).toBe("bien");
    const mal = estadoDe([latido("informe-rendimiento-diario", "2026-08-31T09:00:50+02:00")], en("2026-09-02T13:45:00+02:00"), "informe-rendimiento-diario");
    expect(mal.estado).toBe("mal");
    expect(mal.queHacer).toContain("Informe rendimiento diario");
  });

  it("un aviso del correo de rendimiento (falta el reloj) es atención, no alarma", () => {
    const t = estadoDe(
      [latido("informe-rendimiento-diario", "2026-09-02T09:00:50+02:00", "aviso", "Ayer no hay datos del reloj de personas")],
      en("2026-09-02T13:45:00+02:00"),
      "informe-rendimiento-diario",
    );
    expect(t.estado).toBe("atencion");
    expect(t.queHacer).toBeNull();
  });

  it("el ensayo de restauración de hace dos meses vale; cinco meses sin ensayar es una avería", () => {
    const bien = estadoDe([latido("prueba-restauracion", "2026-08-14T09:25:00+02:00")], en("2026-10-14T10:00:00+02:00"), "prueba-restauracion");
    expect(bien.estado).toBe("bien");
    const mal = estadoDe([latido("prueba-restauracion", "2026-08-14T09:25:00+02:00")], en("2027-01-14T10:00:00+01:00"), "prueba-restauracion");
    expect(mal.estado).toBe("mal");
    expect(mal.queHacer).toContain("restaurar-copia.mjs");
  });
});

describe("mitad ERP de la tarea diaria", () => {
  it("se juzga como la tarea diaria: corrió hoy → bien; sin correr pasada la ventana → mal", () => {
    expect(estadoDe([latido("tarea-erp", "2026-09-03T07:12:00+02:00")], en("2026-09-03T09:00:00+02:00"), "tarea-erp").estado).toBe("bien");
    const mal = estadoDe([latido("tarea-erp", "2026-09-02T07:12:00+02:00")], en("2026-09-03T13:45:00+02:00"), "tarea-erp");
    expect(mal.estado).toBe("mal");
    expect(mal.queHacer).toContain("portátil");
  });
});

describe("problemasQueAvisa (lo que entra en el correo del vigilante)", () => {
  const ahora = en("2026-09-02T13:45:00+02:00");

  it("mete lo que está mal y deja fuera lo que está bien o sin estrenar", () => {
    const salud = evaluarTrabajos([latido("tarea-diaria", "2026-08-31T07:12:00+02:00")], ahora);
    const ids = problemasQueAvisa(salud).map((t) => t.id);
    expect(ids).toEqual(["tarea-diaria"]);
  });

  it("de sí mismo también avisa cuando AYER terminó con error (p. ej. no pudo enviar)", () => {
    const salud = evaluarTrabajos(
      [latido("vigilante", "2026-09-01T13:45:00+02:00", "error", "NO se pudo avisar: Resend 401")],
      ahora,
    );
    const yo = salud.find((t) => t.id === "vigilante")!;
    expect(yo.estado).toBe("atencion");
    expect(problemasQueAvisa(salud).map((t) => t.id)).toEqual(["vigilante"]);
  });

  it("de sí mismo NO avisa cuando ayer fue bien: su fila es la de ayer por definición", () => {
    const salud = evaluarTrabajos([latido("vigilante", "2026-09-01T13:45:00+02:00")], ahora);
    expect(problemasQueAvisa(salud)).toHaveLength(0);
  });
});

describe("renderAvisoVigilante", () => {
  it("compone asunto con el recuento y cuerpo con el qué hacer de cada problema", () => {
    const salud = evaluarTrabajos(
      [latido("tarea-diaria", "2026-08-13T07:12:00+02:00")],
      en("2026-08-14T13:45:00+02:00"),
    );
    const problemas = problemasQueAvisa(salud);
    expect(problemas).toHaveLength(1);
    const { asunto, cuerpo } = renderAvisoVigilante(problemas);
    expect(asunto).toContain("1 trabajo");
    expect(cuerpo).toContain("Qué hacer:");
    expect(cuerpo).toContain("/datos/fuentes");
  });
});
