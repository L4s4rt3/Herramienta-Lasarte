/**
 * useEstadoFuentes — ¿está entrando todo lo que tiene que entrar?
 *
 * POR QUÉ EXISTE. El registro de cámaras externas estuvo 78 días sin
 * actualizarse y nadie se enteró; el 13-08-2026 volvía a llevar 17. Una fuente
 * que deja de llegar no da error en ninguna pantalla: simplemente los números
 * se quedan quietos, y quien los mira los da por buenos.
 *
 * Cada fuente declara cada cuánto DEBERÍA llegar. Si tarda más, se dice.
 * No se inventa ninguna alarma: el umbral es el ritmo real de cada una
 * (los palets del ERP llegan cada día; la asistencia, por semanas completas
 * los lunes, así que en martes-domingo es NORMAL que la semana en curso esté
 * vacía y eso no es una avería — ver la memoria asistencia-volcado-semanal).
 */
import { useQuery } from "@tanstack/react-query";
import { supabase, supabaseLibre } from "@/integrations/supabase/client";
import { evaluarTrabajos, type LatidoRow, type TrabajoSalud } from "@/lib/saludTrabajos";

export type { TrabajoSalud } from "@/lib/saludTrabajos";


export type EstadoFuente = "al-dia" | "con-retraso" | "parada" | "sin-datos";

export interface FilaFuente {
  id: string;
  nombre: string;
  /** De dónde sale y quién la trae, en una frase. */
  origen: string;
  ultimo: string | null;
  diasDesde: number | null;
  /** Días a partir de los cuales se considera retraso. */
  toleranciaDias: number;
  estado: EstadoFuente;
}

interface Definicion {
  id: string;
  nombre: string;
  origen: string;
  tabla: string;
  campo: string;
  toleranciaDias: number;
}

/**
 * El orden es el de la cadena real: primero lo que entra por la puerta (fruta),
 * luego lo que la máquina hace con ella, luego lo que sale.
 */
const FUENTES: Definicion[] = [
  {
    id: "entradas", nombre: "Entradas de fruta", tabla: "entradas_bascula", campo: "fecha",
    origen: "Báscula, vía sincronización con el ERP (tarea diaria de las 07:10)",
    toleranciaDias: 3,
  },
  {
    id: "calibrador", nombre: "Informes del calibrador", tabla: "calibrador_informe", campo: "recibido_at",
    origen: "El propio Compac Sizer, al receptor SMTP de la red local",
    toleranciaDias: 2,
  },
  {
    id: "palets", nombre: "Palets del ERP", tabla: "erp_palet", campo: "sincronizado_at",
    origen: "GSTOCK (palets_cab), sincronización diaria",
    toleranciaDias: 2,
  },
  {
    id: "precalibrado", nombre: "Origen del precalibrado", tabla: "erp_precalibrado_origen", campo: "sincronizado_at",
    origen: "ERP (agri_produc_mp_pt): devuelve la fruta del almacén a su finca",
    toleranciaDias: 3,
  },
  {
    id: "camaras", nombre: "Cámaras externas", tabla: "camara_externa_camiones", campo: "created_at",
    origen: "Excel del registro de cámaras, por la bandeja o el buzón de correo",
    toleranciaDias: 10,
  },
  {
    id: "asistencia", nombre: "Asistencia", tabla: "asistencia_detalle", campo: "fecha",
    // Se carga los LUNES por semanas completas: la semana en curso siempre
    // está vacía y eso no es una avería (memoria: asistencia-volcado-semanal).
    origen: "Volcado semanal de fichajes, los lunes por semanas completas",
    toleranciaDias: 10,
  },
  {
    id: "calidad", nombre: "Diarios de calidad", tabla: "calidad_jornadas", campo: "fecha",
    origen: "Informes de Eusebio (.doc/.docx), por la bandeja de importación",
    toleranciaDias: 10,
  },
];

function estadoDe(dias: number | null, tolerancia: number): EstadoFuente {
  if (dias === null) return "sin-datos";
  if (dias <= tolerancia) return "al-dia";
  // El doble de la tolerancia ya no es "va con retraso", es "dejó de llegar".
  return dias <= tolerancia * 2 ? "con-retraso" : "parada";
}

export function useEstadoFuentes() {
  return useQuery({
    queryKey: ["estado-fuentes"],
    queryFn: async (): Promise<FilaFuente[]> => {
      const filas = await Promise.all(FUENTES.map(async (f): Promise<FilaFuente> => {
        const { data, error } = await supabaseLibre
          .from(f.tabla).select(f.campo).order(f.campo, { ascending: false }).limit(1);
        // Una tabla que falla NO se pinta como "al día": se pinta como sin
        // datos, que es lo honesto cuando no se ha podido mirar.
        const primera = (data?.[0] ?? null) as Record<string, unknown> | null;
        const ultimo = error || !primera ? null : ((primera[f.campo] as string | null) ?? null);
        const diasDesde = ultimo
          ? Math.floor((Date.now() - new Date(ultimo).getTime()) / 86_400_000)
          : null;
        return {
          id: f.id, nombre: f.nombre, origen: f.origen,
          ultimo: ultimo ? String(ultimo).slice(0, 10) : null,
          diasDesde,
          toleranciaDias: f.toleranciaDias,
          estado: estadoDe(diasDesde, f.toleranciaDias),
        };
      }));
      return filas;
    },
    // Una fuente no cambia de estado en segundos: media hora de caché sobra y
    // evita machacar la base cada vez que alguien entra en la página.
    staleTime: 30 * 60 * 1000,
  });
}

/**
 * Los TRABAJOS que traen los datos: ¿están vivos? La lógica (umbral por trabajo,
 * texto del estado, qué hacer) vive en supabase/functions/_shared/saludTrabajos.ts
 * y es la MISMA que usa la edge function `vigilante` para avisar por correo:
 * la página y el correo no pueden contradecirse.
 */
export function useTrabajosAutomaticos() {
  return useQuery({
    queryKey: ["estado-fuentes", "trabajos"],
    queryFn: async (): Promise<TrabajoSalud[]> => {
      const { data, error } = await supabase
        .from("sistema_latidos")
        .select("trabajo, visto_a, estado, detalle, equipo");
      if (error) throw new Error(error.message);
      return evaluarTrabajos((data ?? []) as LatidoRow[], new Date());
    },
    // Un receptor caído se tiene que ver en minutos, no en media hora: caché corta.
    staleTime: 5 * 60 * 1000,
  });
}

/** Contradicciones entre lo que dice la app y lo que dicen las fuentes. */
export interface FilaDesviacion {
  id: string;
  titulo: string;
  detalle: string;
  valor: number;
  /** true si hace falta que alguien mire. */
  problema: boolean;
}

export function useDesviacionesFuentes() {
  return useQuery({
    queryKey: ["estado-fuentes", "desviaciones"],
    queryFn: async (): Promise<FilaDesviacion[]> => {
      const filas: FilaDesviacion[] = [];

      // Nombres de productor que el catálogo canónico no reconoce: son los que
      // hacían que dos páginas contestasen distinto a la misma pregunta.
      const { data: sinCasar, error: e1 } = await supabase.rpc("productores_sin_casar");
      if (!e1) {
        const n = (sinCasar ?? []).length;
        filas.push({
          id: "productores",
          titulo: "Productores sin casar con el catálogo",
          detalle: n === 0
            ? "Todos los nombres de la clasificación resuelven a un productor del catálogo."
            : `${(sinCasar ?? []).slice(0, 4).map((r: { productor: string }) => r.productor).join(", ")}${n > 4 ? "…" : ""}`,
          valor: n,
          problema: n > 0,
        });
      }

      // Días de palets que el ERP todavía puede mover: es normal que haya uno o
      // dos (el día en curso y el anterior hasta las 09:00), no más.
      const { data: palets, error: e2 } = await supabase.rpc("palets_kg_por_dia");
      if (!e2) {
        const abiertos = (palets ?? []).filter((p: { cerrado: boolean }) => !p.cerrado).length;
        filas.push({
          id: "dias-abiertos",
          titulo: "Días de palets sin cerrar",
          detalle: "El ERP sigue admitiendo palets de estos días, así que su total todavía no es definitivo. "
            + "Un día cierra pasadas las 09:00 del día siguiente.",
          valor: abiertos,
          problema: abiertos > 2,
        });
      }

      return filas;
    },
    staleTime: 30 * 60 * 1000,
  });
}
