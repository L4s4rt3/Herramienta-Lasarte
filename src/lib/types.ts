// ─── Supabase row types ────────────────────────────────────────────────────────

export interface MaquinaRow {
  id: string;
  user_id: string;
  nombre: string;
  zona: string;
  created_at: string;
}

export interface SesionConsumoRow {
  id: string;
  user_id: string;
  fecha_inicio: string;
  fecha_fin: string;
  kg_procesados: number;
  agua_linea_l: number;
  agua_drencher_l: number;
  quimicos_drencher_l: number;
  gasoil_l: number;
  electricidad_total_kwh: number;
  notas: string | null;
  created_at: string;
}

export interface ConsumoMaquinaRow {
  id: string;
  sesion_id: string;
  maquina_id: string;
  kwh: number;
  created_at: string;
}

export interface ParteRow {
  id: string;
  user_id: string;
  date: string;
  estado: "Borrador" | "Analizado" | "Con descuadre" | "Validado";
  kg_industria_manual: number;
  kg_reciclado_malla_z1: number;
  kg_reciclado_malla_z2: number;
  kg_inventario_sin_alta: number;
  kg_podrido_bolsa_basura: number;
  kg_produccion_calibrador: number;
  kg_mujeres_calibrador: number;
  kg_palets_brutos: number;
  kg_palets_egipto: number;
  kg_palets_campo: number;
  kg_podrido_calibrador_auto: number;
  kg_inventario_anterior_sin_alta: number;
  notas_generales?: string | null;
  notas_inventario?: string | null;
  resumen_ia?: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export interface AsistenciaDiariaRow {
  id: string;
  user_id: string;
  date: string;
  zona_id?: string | null;
  plantilla_total: number;
  presentes: number;
  ausentes: number;
  created_at: string;
}

// ─── Dashboard view types ──────────────────────────────────────────────────────

/** Un día en el gráfico de producción semanal. */
export interface DailyProduction {
  date: string;   // label del día: "lun. 5"
  kg: number;     // producción real del día
  objetivo: number; // siempre 0 — sin objetivo por turno
}

export interface ProduccionResumen {
  totalKg: number;
  objetivo: number;
  completion: number;
}

export interface AusentesResumen {
  ausentes: number;
  presentes: number;
  plantilla: number;
}
