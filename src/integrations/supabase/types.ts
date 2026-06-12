export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      trabajadores: {
        Row: {
          activo: boolean
          created_at: string
          id: string
          nombre: string
          user_id: string
          zona: string | null
        }
        Insert: {
          activo?: boolean
          created_at?: string
          id?: string
          nombre: string
          user_id: string
          zona?: string | null
        }
        Update: {
          activo?: boolean
          created_at?: string
          id?: string
          nombre?: string
          user_id?: string
          zona?: string | null
        }
        Relationships: []
      }
      asistencia_detalle: {
        Row: {
          created_at: string
          date: string
          id: string
          presente: boolean
          trabajador_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          date: string
          id?: string
          presente?: boolean
          trabajador_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          date?: string
          id?: string
          presente?: boolean
          trabajador_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "asistencia_detalle_trabajador_id_fkey"
            columns: ["trabajador_id"]
            isOneToOne: false
            referencedRelation: "trabajadores"
            referencedColumns: ["id"]
          },
        ]
      }
      asistencia_diaria: {
        Row: {
          ausentes: number
          created_at: string
          date: string
          id: string
          plantilla_total: number
          presentes: number
          user_id: string
          zona_id: string | null
        }
        Insert: {
          ausentes?: number
          created_at?: string
          date: string
          id?: string
          plantilla_total?: number
          presentes?: number
          user_id: string
          zona_id?: string | null
        }
        Update: {
          ausentes?: number
          created_at?: string
          date?: string
          id?: string
          plantilla_total?: number
          presentes?: number
          user_id?: string
          zona_id?: string | null
        }
        Relationships: []
      }
      costes_diarios: {
        Row: {
          cantidad: number
          coste_unitario: number
          created_at: string
          date: string
          id: string
          tipo: string
          unidad: string | null
          user_id: string
          zona_id: string | null
        }
        Insert: {
          cantidad?: number
          coste_unitario?: number
          created_at?: string
          date: string
          id?: string
          tipo: string
          unidad?: string | null
          user_id: string
          zona_id?: string | null
        }
        Update: {
          cantidad?: number
          coste_unitario?: number
          created_at?: string
          date?: string
          id?: string
          tipo?: string
          unidad?: string | null
          user_id?: string
          zona_id?: string | null
        }
        Relationships: []
      }
      gstock_entries: {
        Row: {
          created_at: string
          date: string
          id: string
          kg_expected: number
          part_id: string
          product: string | null
          size_range: string | null
          source: Database["public"]["Enums"]["data_source"]
          user_id: string
        }
        Insert: {
          created_at?: string
          date: string
          id?: string
          kg_expected?: number
          part_id: string
          product?: string | null
          size_range?: string | null
          source?: Database["public"]["Enums"]["data_source"]
          user_id: string
        }
        Update: {
          created_at?: string
          date?: string
          id?: string
          kg_expected?: number
          part_id?: string
          product?: string | null
          size_range?: string | null
          source?: Database["public"]["Enums"]["data_source"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "gstock_entries_part_id_fkey"
            columns: ["part_id"]
            isOneToOne: false
            referencedRelation: "partes_diarios"
            referencedColumns: ["id"]
          },
        ]
      }
      lotes_dia: {
        Row: {
          created_at: string
          duracion_min: number | null
          id: string
          kg_peso_total: number
          lote_codigo: string | null
          notas: string | null
          part_id: string
          peso_fruta_promedio_g: number | null
          productor: string | null
          producto: string | null
          source: Database["public"]["Enums"]["data_source"]
          toneladas_hora: number | null
          user_id: string
          hora_inicio: string | null
        }
        Insert: {
          created_at?: string
          duracion_min?: number | null
          id?: string
          kg_peso_total?: number
          lote_codigo?: string | null
          notas?: string | null
          part_id: string
          peso_fruta_promedio_g?: number | null
          productor?: string | null
          producto?: string | null
          source?: Database["public"]["Enums"]["data_source"]
          toneladas_hora?: number | null
          user_id: string
          hora_inicio?: string | null
        }
        Update: {
          created_at?: string
          duracion_min?: number | null
          id?: string
          kg_peso_total?: number
          lote_codigo?: string | null
          notas?: string | null
          part_id?: string
          peso_fruta_promedio_g?: number | null
          productor?: string | null
          producto?: string | null
          source?: Database["public"]["Enums"]["data_source"]
          toneladas_hora?: number | null
          user_id?: string
          hora_inicio?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lotes_dia_part_id_fkey"
            columns: ["part_id"]
            isOneToOne: false
            referencedRelation: "partes_diarios"
            referencedColumns: ["id"]
          },
        ]
      }
      palets_dia: {
        Row: {
          cliente: string | null
          created_at: string
          destino: string | null
          egipto: boolean
          campo: boolean
          id: string
          kg_neto: number
          n_cajas: number | null
          palet_id: string | null
          part_id: string
          producto: string | null
          situacion: string | null
          source: Database["public"]["Enums"]["data_source"]
          user_id: string
        }
        Insert: {
          cliente?: string | null
          created_at?: string
          destino?: string | null
          egipto?: boolean
          campo?: boolean
          id?: string
          kg_neto?: number
          n_cajas?: number | null
          palet_id?: string | null
          part_id: string
          producto?: string | null
          situacion?: string | null
          source?: Database["public"]["Enums"]["data_source"]
          user_id: string
        }
        Update: {
          cliente?: string | null
          created_at?: string
          destino?: string | null
          egipto?: boolean
          campo?: boolean
          id?: string
          kg_neto?: number
          n_cajas?: number | null
          palet_id?: string | null
          part_id?: string
          producto?: string | null
          situacion?: string | null
          source?: Database["public"]["Enums"]["data_source"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "palets_dia_part_id_fkey"
            columns: ["part_id"]
            isOneToOne: false
            referencedRelation: "partes_diarios"
            referencedColumns: ["id"]
          },
        ]
      }
      calibres_dia: {
        Row: {
          calibre: string
          clase: string | null
          created_at: string
          grupo_destino: string | null
          id: string
          kg: number
          part_id: string
          pct: number
          piezas: number
          source: Database["public"]["Enums"]["data_source"]
          user_id: string
        }
        Insert: {
          calibre: string
          clase?: string | null
          created_at?: string
          grupo_destino?: string | null
          id?: string
          kg?: number
          part_id: string
          pct?: number
          piezas?: number
          source?: Database["public"]["Enums"]["data_source"]
          user_id: string
        }
        Update: {
          calibre?: string
          clase?: string | null
          created_at?: string
          grupo_destino?: string | null
          id?: string
          kg?: number
          part_id?: string
          pct?: number
          piezas?: number
          source?: Database["public"]["Enums"]["data_source"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "calibres_dia_part_id_fkey"
            columns: ["part_id"]
            isOneToOne: false
            referencedRelation: "partes_diarios"
            referencedColumns: ["id"]
          },
        ]
      }
      producto_dia: {
        Row: {
          created_at: string
          formato_caja: string | null
          grupo_destino: string | null
          id: string
          kg: number
          linea: string | null
          n_cajas: number | null
          part_id: string
          producto: string | null
          source: Database["public"]["Enums"]["data_source"]
          user_id: string
        }
        Insert: {
          created_at?: string
          formato_caja?: string | null
          grupo_destino?: string | null
          id?: string
          kg?: number
          linea?: string | null
          n_cajas?: number | null
          part_id: string
          producto?: string | null
          source?: Database["public"]["Enums"]["data_source"]
          user_id: string
        }
        Update: {
          created_at?: string
          formato_caja?: string | null
          grupo_destino?: string | null
          id?: string
          kg?: number
          linea?: string | null
          n_cajas?: number | null
          part_id?: string
          producto?: string | null
          source?: Database["public"]["Enums"]["data_source"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "producto_dia_part_id_fkey"
            columns: ["part_id"]
            isOneToOne: false
            referencedRelation: "partes_diarios"
            referencedColumns: ["id"]
          },
        ]
      }
      partes_archivos: {
        Row: {
          file_name: string | null
          file_path: string
          file_size: number | null
          file_type: string | null
          id: string
          mime_type: string | null
          part_id: string
          uploaded_at: string
          user_id: string
        }
        Insert: {
          file_name?: string | null
          file_path: string
          file_size?: number | null
          file_type?: string | null
          id?: string
          mime_type?: string | null
          part_id: string
          uploaded_at?: string
          user_id: string
        }
        Update: {
          file_name?: string | null
          file_path?: string
          file_size?: number | null
          file_type?: string | null
          id?: string
          mime_type?: string | null
          part_id?: string
          uploaded_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "partes_archivos_part_id_fkey"
            columns: ["part_id"]
            isOneToOne: false
            referencedRelation: "partes_diarios"
            referencedColumns: ["id"]
          },
        ]
      }
      partes_diarios: {
        Row: {
          created_at: string
          date: string
          estado: Database["public"]["Enums"]["parte_estado"]
          id: string
          kg_industria_manual: number
          kg_inventario_anterior_sin_alta: number
          kg_inventario_sin_alta: number
          kg_mujeres_calibrador: number
          kg_palets_brutos: number
          kg_palets_egipto: number
          kg_palets_campo: number
          kg_podrido_bolsa_basura: number
          kg_podrido_calibrador_auto: number
          kg_produccion_calibrador: number
          kg_reciclado_malla_z1: number
          kg_reciclado_malla_z2: number
          notas_generales: string | null
          notas_inventario: string | null
          resumen_ia: Json | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          date: string
          estado?: Database["public"]["Enums"]["parte_estado"]
          id?: string
          kg_industria_manual?: number
          kg_inventario_anterior_sin_alta?: number
          kg_inventario_sin_alta?: number
          kg_mujeres_calibrador?: number
          kg_palets_brutos?: number
          kg_palets_egipto?: number
          kg_palets_campo?: number
          kg_podrido_bolsa_basura?: number
          kg_podrido_calibrador_auto?: number
          kg_produccion_calibrador?: number
          kg_reciclado_malla_z1?: number
          kg_reciclado_malla_z2?: number
          notas_generales?: string | null
          notas_inventario?: string | null
          resumen_ia?: Json | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          date?: string
          estado?: Database["public"]["Enums"]["parte_estado"]
          id?: string
          kg_industria_manual?: number
          kg_inventario_anterior_sin_alta?: number
          kg_inventario_sin_alta?: number
          kg_mujeres_calibrador?: number
          kg_palets_brutos?: number
          kg_palets_egipto?: number
          kg_palets_campo?: number
          kg_podrido_bolsa_basura?: number
          kg_podrido_calibrador_auto?: number
          kg_produccion_calibrador?: number
          kg_reciclado_malla_z1?: number
          kg_reciclado_malla_z2?: number
          notas_generales?: string | null
          notas_inventario?: string | null
          resumen_ia?: Json | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      production_runs: {
        Row: {
          created_at: string
          date: string
          id: string
          kg_produced: number
          part_id: string
          product: string | null
          size_range: string | null
          source: Database["public"]["Enums"]["data_source"]
          user_id: string
        }
        Insert: {
          created_at?: string
          date: string
          id?: string
          kg_produced?: number
          part_id: string
          product?: string | null
          size_range?: string | null
          source?: Database["public"]["Enums"]["data_source"]
          user_id: string
        }
        Update: {
          created_at?: string
          date?: string
          id?: string
          kg_produced?: number
          part_id?: string
          product?: string | null
          size_range?: string | null
          source?: Database["public"]["Enums"]["data_source"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "production_runs_part_id_fkey"
            columns: ["part_id"]
            isOneToOne: false
            referencedRelation: "partes_diarios"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string | null
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      consumo_maquinas: {
        Row: {
          created_at: string
          id: string
          kwh: number
          maquina_id: string
          sesion_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          kwh?: number
          maquina_id: string
          sesion_id: string
        }
        Update: {
          created_at?: string
          id?: string
          kwh?: number
          maquina_id?: string
          sesion_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "consumo_maquinas_maquina_id_fkey"
            columns: ["maquina_id"]
            isOneToOne: false
            referencedRelation: "maquinas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consumo_maquinas_sesion_id_fkey"
            columns: ["sesion_id"]
            isOneToOne: false
            referencedRelation: "sesiones_consumo"
            referencedColumns: ["id"]
          },
        ]
      }
      consumos_fisicos: {
        Row: {
          cantidad: number
          created_at: string
          fecha_fin: string
          fecha_inicio: string
          fuente: "contador" | "factura_detallada" | "albaran" | "estimacion_manual"
          id: string
          notas: string | null
          recurso: "agua" | "electricidad" | "gasoil" | "quimicos"
          referencia: string | null
          unidad: "l" | "m3" | "kwh"
          user_id: string
        }
        Insert: {
          cantidad?: number
          created_at?: string
          fecha_fin: string
          fecha_inicio: string
          fuente: "contador" | "factura_detallada" | "albaran" | "estimacion_manual"
          id?: string
          notas?: string | null
          recurso: "agua" | "electricidad" | "gasoil" | "quimicos"
          referencia?: string | null
          unidad: "l" | "m3" | "kwh"
          user_id: string
        }
        Update: {
          cantidad?: number
          created_at?: string
          fecha_fin?: string
          fecha_inicio?: string
          fuente?: "contador" | "factura_detallada" | "albaran" | "estimacion_manual"
          id?: string
          notas?: string | null
          recurso?: "agua" | "electricidad" | "gasoil" | "quimicos"
          referencia?: string | null
          unidad?: "l" | "m3" | "kwh"
          user_id?: string
        }
        Relationships: []
      }
      consumos_bases_kg: {
        Row: {
          created_at: string
          fecha_fin: string
          fecha_inicio: string
          id: string
          kg: number
          notas: string | null
          referencia: string | null
          tipo_base: "ventas" | "manual"
          user_id: string
        }
        Insert: {
          created_at?: string
          fecha_fin: string
          fecha_inicio: string
          id?: string
          kg?: number
          notas?: string | null
          referencia?: string | null
          tipo_base: "ventas" | "manual"
          user_id: string
        }
        Update: {
          created_at?: string
          fecha_fin?: string
          fecha_inicio?: string
          id?: string
          kg?: number
          notas?: string | null
          referencia?: string | null
          tipo_base?: "ventas" | "manual"
          user_id?: string
        }
        Relationships: []
      }
      maquinas: {
        Row: {
          created_at: string
          id: string
          nombre: string
          user_id: string
          zona: string
        }
        Insert: {
          created_at?: string
          id?: string
          nombre: string
          user_id: string
          zona: string
        }
        Update: {
          created_at?: string
          id?: string
          nombre?: string
          user_id?: string
          zona?: string
        }
        Relationships: []
      }
      sesiones_consumo: {
        Row: {
          agua_drencher_l: number
          agua_linea_l: number
          created_at: string
          electricidad_total_kwh: number
          fecha_fin: string
          fecha_inicio: string
          gasoil_l: number
          id: string
          kg_procesados: number
          notas: string | null
          quimicos_drencher_l: number
          user_id: string
        }
        Insert: {
          agua_drencher_l?: number
          agua_linea_l?: number
          created_at?: string
          electricidad_total_kwh?: number
          fecha_fin: string
          fecha_inicio: string
          gasoil_l?: number
          id?: string
          kg_procesados?: number
          notas?: string | null
          quimicos_drencher_l?: number
          user_id: string
        }
        Update: {
          agua_drencher_l?: number
          agua_linea_l?: number
          created_at?: string
          electricidad_total_kwh?: number
          fecha_fin?: string
          fecha_inicio?: string
          gasoil_l?: number
          id?: string
          kg_procesados?: number
          notas?: string | null
          quimicos_drencher_l?: number
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "operario"
      data_source: "manual" | "ia"
      parte_archivo_tipo:
        | "GSTOCK"
        | "Produccion"
        | "BoxAzules"
        | "FotoLotes"
        | "Otro"
      parte_estado: "Borrador" | "Analizado" | "Con descuadre" | "Validado"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "operario"],
      data_source: ["manual", "ia"],
      parte_archivo_tipo: [
        "GSTOCK",
        "Produccion",
        "BoxAzules",
        "FotoLotes",
        "Otro",
      ],
      parte_estado: ["Borrador", "Analizado", "Con descuadre", "Validado"],
    },
  },
} as const
