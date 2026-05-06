// ─── Supabase row types ────────────────────────────────────────────────────────

/** Refleja la tabla partes_diarios del esquema actual. */
export interface ParteRow {
  id: string;
  user_id: string;
  date: string;
  estado: "Borrador" | "Analizado" | "Con descuadre" | "Validado";
  // Campos de kg
  kg_industria_manual: number;
  kg_reciclado_malla_z1: number;
  kg_reciclado_malla_z2: number;
  kg_inventario_sin_alta: number;
  kg_podrido_bolsa_basura: number;
  kg_produccion_calibrador: number;
  kg_mujeres_calibrador: number;
  kg_palets_brutos: number;
  kg_podrido_calibrador_auto: number;
  kg_inventario_anterior_sin_alta: number;
  // Opcionales
  notas_generales?: string | null;
  notas_inventario?: string | null;
  resumen_ia?: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export interface AsistenciaRow {
  id: string;
  date: string;
  trabajador: string;
  linea: string;
  entrada?: string;
  status: "present" | "absent" | "late";
}

// ─── Dashboard view types ──────────────────────────────────────────────────────

export interface LineProduction {
  line: string;
  kg: number;
  goal: number;
  status: "optimal" | "warning" | "critical";
}

export interface DailyProduction {
  date: string;
  kg: number;
  objetivo: number;
}

export interface WorkerAttendance {
  id: string;
  name: string;
  line: string;
  status: "present" | "absent" | "late";
  entry_time?: string;
}

export interface ProduccionResumen {
  totalKg: number;
  objetivo: number;
  completion: number;
}
