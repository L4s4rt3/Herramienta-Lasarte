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
      asistencia_bajas_laborales: {
        Row: {
          created_at: string
          fecha_fin: string | null
          fecha_inicio: string
          id: string
          motivo: string
          trabajador_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          fecha_fin?: string | null
          fecha_inicio: string
          id?: string
          motivo?: string
          trabajador_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          fecha_fin?: string | null
          fecha_inicio?: string
          id?: string
          motivo?: string
          trabajador_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "asistencia_bajas_laborales_trabajador_id_fkey"
            columns: ["trabajador_id"]
            isOneToOne: false
            referencedRelation: "trabajadores"
            referencedColumns: ["id"]
          },
        ]
      }
      asistencia_detalle: {
        Row: {
          created_at: string
          date: string
          id: string
          motivo_ausencia: string | null
          presente: boolean
          trabajador_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          date: string
          id?: string
          motivo_ausencia?: string | null
          presente?: boolean
          trabajador_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          date?: string
          id?: string
          motivo_ausencia?: string | null
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
          source: string
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
          source?: string
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
          source?: string
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
      calidad_adjuntos: {
        Row: {
          created_at: string
          file_name: string
          file_path: string
          file_size: number | null
          id: string
          lote_id: string
          mime_type: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          file_name: string
          file_path: string
          file_size?: number | null
          id?: string
          lote_id: string
          mime_type?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          file_name?: string
          file_path?: string
          file_size?: number | null
          id?: string
          lote_id?: string
          mime_type?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "calidad_adjuntos_lote_id_fkey"
            columns: ["lote_id"]
            isOneToOne: false
            referencedRelation: "calidad_lotes"
            referencedColumns: ["id"]
          },
        ]
      }
      calidad_jornadas: {
        Row: {
          created_at: string
          estado: string
          fecha: string
          id: string
          responsable: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          estado?: string
          fecha: string
          id?: string
          responsable?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          estado?: string
          fecha?: string
          id?: string
          responsable?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      calidad_lotes: {
        Row: {
          accion_recomendada: string
          aerobotics_realizado: boolean
          calidad: string
          cantidad: string
          created_at: string
          defecto_otro: string
          defectos: string[]
          fecha: string
          hora: string | null
          ia_accion_recomendada: string
          ia_calidad: string | null
          ia_defectos: string[]
          ia_resumen: string
          id: string
          informe_estado: string
          informe_generado: string
          jornada_id: string
          motivo_reapertura: string
          numero_lote: string
          observacion: string
          producto: string
          productor_finca_id: string | null
          productor_finca_nombre: string
          reabierto_at: string | null
          reabierto_by: string | null
          updated_at: string
          user_id: string
          validado_at: string | null
          validado_by: string | null
          variedad: string
        }
        Insert: {
          accion_recomendada?: string
          aerobotics_realizado?: boolean
          calidad?: string
          cantidad?: string
          created_at?: string
          defecto_otro?: string
          defectos?: string[]
          fecha: string
          hora?: string | null
          ia_accion_recomendada?: string
          ia_calidad?: string | null
          ia_defectos?: string[]
          ia_resumen?: string
          id?: string
          informe_estado?: string
          informe_generado?: string
          jornada_id: string
          motivo_reapertura?: string
          numero_lote?: string
          observacion?: string
          producto?: string
          productor_finca_id?: string | null
          productor_finca_nombre?: string
          reabierto_at?: string | null
          reabierto_by?: string | null
          updated_at?: string
          user_id: string
          validado_at?: string | null
          validado_by?: string | null
          variedad?: string
        }
        Update: {
          accion_recomendada?: string
          aerobotics_realizado?: boolean
          calidad?: string
          cantidad?: string
          created_at?: string
          defecto_otro?: string
          defectos?: string[]
          fecha?: string
          hora?: string | null
          ia_accion_recomendada?: string
          ia_calidad?: string | null
          ia_defectos?: string[]
          ia_resumen?: string
          id?: string
          informe_estado?: string
          informe_generado?: string
          jornada_id?: string
          motivo_reapertura?: string
          numero_lote?: string
          observacion?: string
          producto?: string
          productor_finca_id?: string | null
          productor_finca_nombre?: string
          reabierto_at?: string | null
          reabierto_by?: string | null
          updated_at?: string
          user_id?: string
          validado_at?: string | null
          validado_by?: string | null
          variedad?: string
        }
        Relationships: [
          {
            foreignKeyName: "calidad_lotes_jornada_id_fkey"
            columns: ["jornada_id"]
            isOneToOne: false
            referencedRelation: "calidad_jornadas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calidad_lotes_productor_finca_id_fkey"
            columns: ["productor_finca_id"]
            isOneToOne: false
            referencedRelation: "calidad_productores"
            referencedColumns: ["id"]
          },
        ]
      }
      calidad_productores: {
        Row: {
          created_at: string
          id: string
          nombre: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          nombre: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          nombre?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      chat_conversations: {
        Row: {
          content: string
          created_at: string | null
          embedding: string | null
          id: string
          metadata: Json | null
          role: string
          user_id: string | null
        }
        Insert: {
          content: string
          created_at?: string | null
          embedding?: string | null
          id?: string
          metadata?: Json | null
          role: string
          user_id?: string | null
        }
        Update: {
          content?: string
          created_at?: string | null
          embedding?: string | null
          id?: string
          metadata?: Json | null
          role?: string
          user_id?: string | null
        }
        Relationships: []
      }
      chat_knowledge: {
        Row: {
          answer: string
          created_at: string | null
          embedding: string | null
          feedback_score: number | null
          id: string
          metadata: Json | null
          question: string
          user_id: string | null
        }
        Insert: {
          answer: string
          created_at?: string | null
          embedding?: string | null
          feedback_score?: number | null
          id?: string
          metadata?: Json | null
          question: string
          user_id?: string | null
        }
        Update: {
          answer?: string
          created_at?: string | null
          embedding?: string | null
          feedback_score?: number | null
          id?: string
          metadata?: Json | null
          question?: string
          user_id?: string | null
        }
        Relationships: []
      }
      chat_memoria: {
        Row: {
          activa: boolean
          clave: string
          contenido: string
          created_at: string
          id: string
          origen: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          activa?: boolean
          clave: string
          contenido: string
          created_at?: string
          id?: string
          origen?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          activa?: boolean
          clave?: string
          contenido?: string
          created_at?: string
          id?: string
          origen?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      cmr_documentos: {
        Row: {
          archivo_nombre: string | null
          archivo_path: string | null
          cliente: string | null
          created_at: string
          datos: Json | null
          destino: string | null
          fecha: string | null
          id: string
          matricula: string | null
          notas: string | null
          numero: string | null
          origen: string
          tipo: string
          transportista: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          archivo_nombre?: string | null
          archivo_path?: string | null
          cliente?: string | null
          created_at?: string
          datos?: Json | null
          destino?: string | null
          fecha?: string | null
          id?: string
          matricula?: string | null
          notas?: string | null
          numero?: string | null
          origen?: string
          tipo: string
          transportista?: string | null
          updated_at?: string
          user_id?: string
        }
        Update: {
          archivo_nombre?: string | null
          archivo_path?: string | null
          cliente?: string | null
          created_at?: string
          datos?: Json | null
          destino?: string | null
          fecha?: string | null
          id?: string
          matricula?: string | null
          notas?: string | null
          numero?: string | null
          origen?: string
          tipo?: string
          transportista?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      code_embeddings: {
        Row: {
          content: string
          created_at: string | null
          embedding: string
          file_path: string
          id: string
          metadata: Json | null
          updated_at: string | null
        }
        Insert: {
          content: string
          created_at?: string | null
          embedding: string
          file_path: string
          id?: string
          metadata?: Json | null
          updated_at?: string | null
        }
        Update: {
          content?: string
          created_at?: string | null
          embedding?: string
          file_path?: string
          id?: string
          metadata?: Json | null
          updated_at?: string | null
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
      consumos_bases_kg: {
        Row: {
          created_at: string
          fecha_fin: string
          fecha_inicio: string
          id: string
          kg: number
          notas: string | null
          referencia: string | null
          tipo_base: string
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
          tipo_base: string
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
          tipo_base?: string
          user_id?: string
        }
        Relationships: []
      }
      consumos_fisicos: {
        Row: {
          cantidad: number
          created_at: string
          fecha_fin: string
          fecha_inicio: string
          fuente: string
          id: string
          notas: string | null
          recurso: string
          referencia: string | null
          unidad: string
          user_id: string
        }
        Insert: {
          cantidad?: number
          created_at?: string
          fecha_fin: string
          fecha_inicio: string
          fuente: string
          id?: string
          notas?: string | null
          recurso: string
          referencia?: string | null
          unidad: string
          user_id: string
        }
        Update: {
          cantidad?: number
          created_at?: string
          fecha_fin?: string
          fecha_inicio?: string
          fuente?: string
          id?: string
          notas?: string | null
          recurso?: string
          referencia?: string | null
          unidad?: string
          user_id?: string
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
      economico_precios: {
        Row: {
          created_at: string
          id: string
          notas: string | null
          precio_por_unidad: number
          recurso: string
          unidad: string
          user_id: string
          vigente_desde: string
        }
        Insert: {
          created_at?: string
          id?: string
          notas?: string | null
          precio_por_unidad: number
          recurso: string
          unidad: string
          user_id?: string
          vigente_desde?: string
        }
        Update: {
          created_at?: string
          id?: string
          notas?: string | null
          precio_por_unidad?: number
          recurso?: string
          unidad?: string
          user_id?: string
          vigente_desde?: string
        }
        Relationships: []
      }
      entradas_bascula: {
        Row: {
          agricultor: string | null
          articulo: string | null
          certificada: boolean
          certificado_ggn: string | null
          comision_kg: number | null
          coste_recoleccion: number | null
          created_at: string
          envases: number | null
          fecha: string
          finca: string | null
          id: string
          importe_compra: number | null
          importe_comision: number | null
          importe_total: number | null
          importe_transporte: number | null
          kg_ajuste_stock: number
          kg_entrada: number
          lote: string
          num_entrada: string | null
          origen: string
          parcela: string | null
          precio_compra_kg: number | null
          recol_kg: number | null
          tipo_envase: string | null
          user_id: string
        }
        Insert: {
          agricultor?: string | null
          articulo?: string | null
          certificada?: boolean
          certificado_ggn?: string | null
          comision_kg?: number | null
          coste_recoleccion?: number | null
          created_at?: string
          envases?: number | null
          fecha: string
          finca?: string | null
          id?: string
          importe_compra?: number | null
          importe_comision?: number | null
          importe_total?: number | null
          importe_transporte?: number | null
          kg_ajuste_stock?: number
          kg_entrada?: number
          lote: string
          num_entrada?: string | null
          origen?: string
          parcela?: string | null
          precio_compra_kg?: number | null
          recol_kg?: number | null
          tipo_envase?: string | null
          user_id: string
        }
        Update: {
          agricultor?: string | null
          articulo?: string | null
          certificada?: boolean
          certificado_ggn?: string | null
          comision_kg?: number | null
          coste_recoleccion?: number | null
          created_at?: string
          envases?: number | null
          fecha?: string
          finca?: string | null
          id?: string
          importe_compra?: number | null
          importe_comision?: number | null
          importe_total?: number | null
          importe_transporte?: number | null
          kg_ajuste_stock?: number
          kg_entrada?: number
          lote?: string
          num_entrada?: string | null
          origen?: string
          parcela?: string | null
          precio_compra_kg?: number | null
          recol_kg?: number | null
          tipo_envase?: string | null
          user_id?: string
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
      lote_clasificacion: {
        Row: {
          archivo_id: string | null
          calidad: string | null
          cartons: number | null
          clase: string
          created_at: string
          duracion_min: number | null
          fecha: string | null
          grupo_destino: string | null
          id: string
          lote_codigo: string
          lote_codigo_base: string | null
          lote_dia_id: string | null
          part_id: string
          pct_cartons: number | null
          pct_peso: number | null
          pct_piezas: number | null
          peso_fruta_promedio_g: number | null
          peso_kg: number
          piezas: number | null
          producto: string
          productor: string | null
          tamano: string
          toneladas_hora: number | null
          user_id: string
        }
        Insert: {
          archivo_id?: string | null
          calidad?: string | null
          cartons?: number | null
          clase: string
          created_at?: string
          duracion_min?: number | null
          fecha?: string | null
          grupo_destino?: string | null
          id?: string
          lote_codigo: string
          lote_codigo_base?: string | null
          lote_dia_id?: string | null
          part_id: string
          pct_cartons?: number | null
          pct_peso?: number | null
          pct_piezas?: number | null
          peso_fruta_promedio_g?: number | null
          peso_kg?: number
          piezas?: number | null
          producto: string
          productor?: string | null
          tamano: string
          toneladas_hora?: number | null
          user_id: string
        }
        Update: {
          archivo_id?: string | null
          calidad?: string | null
          cartons?: number | null
          clase?: string
          created_at?: string
          duracion_min?: number | null
          fecha?: string | null
          grupo_destino?: string | null
          id?: string
          lote_codigo?: string
          lote_codigo_base?: string | null
          lote_dia_id?: string | null
          part_id?: string
          pct_cartons?: number | null
          pct_peso?: number | null
          pct_piezas?: number | null
          peso_fruta_promedio_g?: number | null
          peso_kg?: number
          piezas?: number | null
          producto?: string
          productor?: string | null
          tamano?: string
          toneladas_hora?: number | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lote_clasificacion_archivo_id_fkey"
            columns: ["archivo_id"]
            isOneToOne: false
            referencedRelation: "partes_archivos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lote_clasificacion_lote_dia_id_fkey"
            columns: ["lote_dia_id"]
            isOneToOne: false
            referencedRelation: "lotes_dia"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lote_clasificacion_part_id_fkey"
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
          hora_inicio: string | null
          id: string
          kg_industria: number
          kg_peso_total: number
          lote_codigo: string | null
          notas: string | null
          part_id: string
          peso_fruta_promedio_g: number | null
          producto: string | null
          productor: string | null
          source: Database["public"]["Enums"]["data_source"]
          toneladas_hora: number | null
          user_id: string
        }
        Insert: {
          created_at?: string
          duracion_min?: number | null
          hora_inicio?: string | null
          id?: string
          kg_industria?: number
          kg_peso_total?: number
          lote_codigo?: string | null
          notas?: string | null
          part_id: string
          peso_fruta_promedio_g?: number | null
          producto?: string | null
          productor?: string | null
          source?: Database["public"]["Enums"]["data_source"]
          toneladas_hora?: number | null
          user_id: string
        }
        Update: {
          created_at?: string
          duracion_min?: number | null
          hora_inicio?: string | null
          id?: string
          kg_industria?: number
          kg_peso_total?: number
          lote_codigo?: string | null
          notas?: string | null
          part_id?: string
          peso_fruta_promedio_g?: number | null
          producto?: string | null
          productor?: string | null
          source?: Database["public"]["Enums"]["data_source"]
          toneladas_hora?: number | null
          user_id?: string
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
      mercadona_previsiones: {
        Row: {
          anio: number
          created_at: string
          id: string
          kg_previstos: number | null
          kg_previstos_quincena: number | null
          notas: string | null
          semana: number
          updated_at: string
          user_id: string
        }
        Insert: {
          anio: number
          created_at?: string
          id?: string
          kg_previstos?: number | null
          kg_previstos_quincena?: number | null
          notas?: string | null
          semana: number
          updated_at?: string
          user_id?: string
        }
        Update: {
          anio?: number
          created_at?: string
          id?: string
          kg_previstos?: number | null
          kg_previstos_quincena?: number | null
          notas?: string | null
          semana?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      mercadona_semana_metodos: {
        Row: {
          base_iva: number | null
          cajas: number | null
          comparativa_anterior_pct: number | null
          created_at: string
          descripcion: string | null
          id: string
          kilos: number | null
          lineas: number | null
          metodo: string
          palets: number | null
          pct: number | null
          semana_id: string
        }
        Insert: {
          base_iva?: number | null
          cajas?: number | null
          comparativa_anterior_pct?: number | null
          created_at?: string
          descripcion?: string | null
          id?: string
          kilos?: number | null
          lineas?: number | null
          metodo: string
          palets?: number | null
          pct?: number | null
          semana_id: string
        }
        Update: {
          base_iva?: number | null
          cajas?: number | null
          comparativa_anterior_pct?: number | null
          created_at?: string
          descripcion?: string | null
          id?: string
          kilos?: number | null
          lineas?: number | null
          metodo?: string
          palets?: number | null
          pct?: number | null
          semana_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mercadona_semana_metodos_semana_id_fkey"
            columns: ["semana_id"]
            isOneToOne: false
            referencedRelation: "mercadona_semanas"
            referencedColumns: ["id"]
          },
        ]
      }
      mercadona_semanas: {
        Row: {
          ajustes_base_iva: number | null
          ajustes_lineas: number | null
          anio: number
          antequera_ii_kg: number | null
          antequera_verdura_kg: number | null
          created_at: string
          diferencia_pct: number | null
          id: string
          notas: string[]
          planificado_quincena_kg: number | null
          planificado_semana_kg: number | null
          rango_planificacion: string | null
          semana: number
          updated_at: string
          user_id: string
          vendido_kg: number | null
        }
        Insert: {
          ajustes_base_iva?: number | null
          ajustes_lineas?: number | null
          anio: number
          antequera_ii_kg?: number | null
          antequera_verdura_kg?: number | null
          created_at?: string
          diferencia_pct?: number | null
          id?: string
          notas?: string[]
          planificado_quincena_kg?: number | null
          planificado_semana_kg?: number | null
          rango_planificacion?: string | null
          semana: number
          updated_at?: string
          user_id: string
          vendido_kg?: number | null
        }
        Update: {
          ajustes_base_iva?: number | null
          ajustes_lineas?: number | null
          anio?: number
          antequera_ii_kg?: number | null
          antequera_verdura_kg?: number | null
          created_at?: string
          diferencia_pct?: number | null
          id?: string
          notas?: string[]
          planificado_quincena_kg?: number | null
          planificado_semana_kg?: number | null
          rango_planificacion?: string | null
          semana?: number
          updated_at?: string
          user_id?: string
          vendido_kg?: number | null
        }
        Relationships: []
      }
      palets_dia: {
        Row: {
          campo: boolean
          cliente: string | null
          created_at: string
          destino: string | null
          egipto: boolean
          id: string
          kg_neto: number
          n_cajas: number | null
          palet_id: string | null
          part_id: string
          producto: string | null
          situacion: string | null
          source: string
          user_id: string
        }
        Insert: {
          campo?: boolean
          cliente?: string | null
          created_at?: string
          destino?: string | null
          egipto?: boolean
          id?: string
          kg_neto?: number
          n_cajas?: number | null
          palet_id?: string | null
          part_id: string
          producto?: string | null
          situacion?: string | null
          source?: string
          user_id: string
        }
        Update: {
          campo?: boolean
          cliente?: string | null
          created_at?: string
          destino?: string | null
          egipto?: boolean
          id?: string
          kg_neto?: number
          n_cajas?: number | null
          palet_id?: string | null
          part_id?: string
          producto?: string | null
          situacion?: string | null
          source?: string
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
          kg_palets_campo: number
          kg_palets_egipto: number
          kg_podrido_bolsa_basura: number
          kg_podrido_calibrador_auto: number
          kg_produccion_calibrador: number
          kg_reciclado_malla_z1: number
          kg_reciclado_malla_z2: number
          notas_generales: string | null
          notas_inventario: string | null
          resumen_analisis: Json | null
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
          kg_palets_campo?: number
          kg_palets_egipto?: number
          kg_podrido_bolsa_basura?: number
          kg_podrido_calibrador_auto?: number
          kg_produccion_calibrador?: number
          kg_reciclado_malla_z1?: number
          kg_reciclado_malla_z2?: number
          notas_generales?: string | null
          notas_inventario?: string | null
          resumen_analisis?: Json | null
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
          kg_palets_campo?: number
          kg_palets_egipto?: number
          kg_podrido_bolsa_basura?: number
          kg_podrido_calibrador_auto?: number
          kg_produccion_calibrador?: number
          kg_reciclado_malla_z1?: number
          kg_reciclado_malla_z2?: number
          notas_generales?: string | null
          notas_inventario?: string | null
          resumen_analisis?: Json | null
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
          source: string
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
          source?: string
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
          source?: string
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
      rrhh_amonestaciones: {
        Row: {
          archivo_nombre: string | null
          archivo_path: string | null
          created_at: string
          fecha: string
          gravedad: string
          id: string
          motivo: string
          notas: string | null
          trabajador_id: string
          user_id: string
        }
        Insert: {
          archivo_nombre?: string | null
          archivo_path?: string | null
          created_at?: string
          fecha: string
          gravedad?: string
          id?: string
          motivo: string
          notas?: string | null
          trabajador_id: string
          user_id?: string
        }
        Update: {
          archivo_nombre?: string | null
          archivo_path?: string | null
          created_at?: string
          fecha?: string
          gravedad?: string
          id?: string
          motivo?: string
          notas?: string | null
          trabajador_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "rrhh_amonestaciones_trabajador_id_fkey"
            columns: ["trabajador_id"]
            isOneToOne: false
            referencedRelation: "trabajadores"
            referencedColumns: ["id"]
          },
        ]
      }
      rrhh_horas: {
        Row: {
          created_at: string
          fecha: string
          horas: number
          id: string
          motivo: string | null
          trabajador_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          fecha: string
          horas: number
          id?: string
          motivo?: string | null
          trabajador_id: string
          user_id?: string
        }
        Update: {
          created_at?: string
          fecha?: string
          horas?: number
          id?: string
          motivo?: string | null
          trabajador_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "rrhh_horas_trabajador_id_fkey"
            columns: ["trabajador_id"]
            isOneToOne: false
            referencedRelation: "trabajadores"
            referencedColumns: ["id"]
          },
        ]
      }
      rrhh_justificantes: {
        Row: {
          archivo_nombre: string | null
          archivo_path: string | null
          created_at: string
          fecha: string
          id: string
          notas: string | null
          trabajador_id: string
          user_id: string
        }
        Insert: {
          archivo_nombre?: string | null
          archivo_path?: string | null
          created_at?: string
          fecha: string
          id?: string
          notas?: string | null
          trabajador_id: string
          user_id?: string
        }
        Update: {
          archivo_nombre?: string | null
          archivo_path?: string | null
          created_at?: string
          fecha?: string
          id?: string
          notas?: string | null
          trabajador_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "rrhh_justificantes_trabajador_id_fkey"
            columns: ["trabajador_id"]
            isOneToOne: false
            referencedRelation: "trabajadores"
            referencedColumns: ["id"]
          },
        ]
      }
      rrhh_nominas: {
        Row: {
          anio: number
          archivo_nombre: string | null
          archivo_path: string | null
          created_at: string
          id: string
          mes: number
          notas: string | null
          trabajador_id: string
          user_id: string
        }
        Insert: {
          anio: number
          archivo_nombre?: string | null
          archivo_path?: string | null
          created_at?: string
          id?: string
          mes: number
          notas?: string | null
          trabajador_id: string
          user_id?: string
        }
        Update: {
          anio?: number
          archivo_nombre?: string | null
          archivo_path?: string | null
          created_at?: string
          id?: string
          mes?: number
          notas?: string | null
          trabajador_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "rrhh_nominas_trabajador_id_fkey"
            columns: ["trabajador_id"]
            isOneToOne: false
            referencedRelation: "trabajadores"
            referencedColumns: ["id"]
          },
        ]
      }
      rrhh_vacaciones_periodos: {
        Row: {
          created_at: string
          dias_naturales: number
          fecha_fin: string
          fecha_inicio: string
          id: string
          notas: string | null
          trabajador_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          dias_naturales: number
          fecha_fin: string
          fecha_inicio: string
          id?: string
          notas?: string | null
          trabajador_id: string
          user_id?: string
        }
        Update: {
          created_at?: string
          dias_naturales?: number
          fecha_fin?: string
          fecha_inicio?: string
          id?: string
          notas?: string | null
          trabajador_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "rrhh_vacaciones_periodos_trabajador_id_fkey"
            columns: ["trabajador_id"]
            isOneToOne: false
            referencedRelation: "trabajadores"
            referencedColumns: ["id"]
          },
        ]
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
      trabajadores: {
        Row: {
          activo: boolean
          categoria_profesional: string | null
          computa_kg_persona: boolean | null
          created_at: string
          fecha_alta: string | null
          id: string
          nombre: string
          user_id: string
          vacaciones_dias_anuales: number
          zona: string | null
        }
        Insert: {
          activo?: boolean
          categoria_profesional?: string | null
          computa_kg_persona?: boolean | null
          created_at?: string
          fecha_alta?: string | null
          id?: string
          nombre: string
          user_id: string
          vacaciones_dias_anuales?: number
          zona?: string | null
        }
        Update: {
          activo?: boolean
          categoria_profesional?: string | null
          computa_kg_persona?: boolean | null
          created_at?: string
          fecha_alta?: string | null
          id?: string
          nombre?: string
          user_id?: string
          vacaciones_dias_anuales?: number
          zona?: string | null
        }
        Relationships: []
      }
      trabajadores_alias: {
        Row: {
          alias: string
          created_at: string
          id: string
          trabajador_id: string
          user_id: string
        }
        Insert: {
          alias: string
          created_at?: string
          id?: string
          trabajador_id: string
          user_id?: string
        }
        Update: {
          alias?: string
          created_at?: string
          id?: string
          trabajador_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "trabajadores_alias_trabajador_id_fkey"
            columns: ["trabajador_id"]
            isOneToOne: false
            referencedRelation: "trabajadores"
            referencedColumns: ["id"]
          },
        ]
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
      ventas_categoria_autorizados: {
        Row: {
          activo: boolean
          created_at: string
          email: string
          id: string
          nombre: string | null
          updated_at: string
        }
        Insert: {
          activo?: boolean
          created_at?: string
          email: string
          id?: string
          nombre?: string | null
          updated_at?: string
        }
        Update: {
          activo?: boolean
          created_at?: string
          email?: string
          id?: string
          nombre?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      ventas_categoria_clientes_ajustes: {
        Row: {
          categoria_id: string
          cliente_codigo: string
          cliente_nombre: string
          comision_cent_kg: number
          comision_pct: number
          created_at: string
          id: string
          transporte_cent_kg: number
          transporte_pct: number
          updated_at: string
        }
        Insert: {
          categoria_id: string
          cliente_codigo: string
          cliente_nombre: string
          comision_cent_kg?: number
          comision_pct?: number
          created_at?: string
          id?: string
          transporte_cent_kg?: number
          transporte_pct?: number
          updated_at?: string
        }
        Update: {
          categoria_id?: string
          cliente_codigo?: string
          cliente_nombre?: string
          comision_cent_kg?: number
          comision_pct?: number
          created_at?: string
          id?: string
          transporte_cent_kg?: number
          transporte_pct?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ventas_categoria_clientes_ajustes_categoria_id_fkey"
            columns: ["categoria_id"]
            isOneToOne: false
            referencedRelation: "ventas_categorias"
            referencedColumns: ["id"]
          },
        ]
      }
      ventas_categoria_lineas: {
        Row: {
          articulo: string
          base_iva: number
          campana: string
          categoria_id: string
          cliente_codigo: string
          cliente_nombre: string
          created_at: string
          fecha: string
          id: string
          kilos: number
          mes: string
          metodo_producto: string | null
          pm_venta: number
          pvp: number
          referencia: string | null
        }
        Insert: {
          articulo: string
          base_iva?: number
          campana: string
          categoria_id: string
          cliente_codigo: string
          cliente_nombre: string
          created_at?: string
          fecha: string
          id?: string
          kilos?: number
          mes: string
          metodo_producto?: string | null
          pm_venta?: number
          pvp?: number
          referencia?: string | null
        }
        Update: {
          articulo?: string
          base_iva?: number
          campana?: string
          categoria_id?: string
          cliente_codigo?: string
          cliente_nombre?: string
          created_at?: string
          fecha?: string
          id?: string
          kilos?: number
          mes?: string
          metodo_producto?: string | null
          pm_venta?: number
          pvp?: number
          referencia?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ventas_categoria_lineas_categoria_id_fkey"
            columns: ["categoria_id"]
            isOneToOne: false
            referencedRelation: "ventas_categorias"
            referencedColumns: ["id"]
          },
        ]
      }
      ventas_categoria_productos: {
        Row: {
          base_iva: number
          categoria_id: string
          created_at: string
          descripcion: string | null
          id: string
          kilos: number
          lineas: number
          metodo: string
          updated_at: string
        }
        Insert: {
          base_iva?: number
          categoria_id: string
          created_at?: string
          descripcion?: string | null
          id?: string
          kilos?: number
          lineas?: number
          metodo: string
          updated_at?: string
        }
        Update: {
          base_iva?: number
          categoria_id?: string
          created_at?: string
          descripcion?: string | null
          id?: string
          kilos?: number
          lineas?: number
          metodo?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ventas_categoria_productos_categoria_id_fkey"
            columns: ["categoria_id"]
            isOneToOne: false
            referencedRelation: "ventas_categorias"
            referencedColumns: ["id"]
          },
        ]
      }
      ventas_categorias: {
        Row: {
          created_at: string
          descripcion: string | null
          id: string
          nombre: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          descripcion?: string | null
          id?: string
          nombre: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          descripcion?: string | null
          id?: string
          nombre?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      dashboard_produccion_mensual: {
        Row: {
          ano: number | null
          cajas: number | null
          clientes: number | null
          destinos: number | null
          dias: number | null
          facturacion: number | null
          kilos: number | null
          lineas: number | null
          lotes: number | null
          mes: number | null
          month_start: string | null
          palets: number | null
          precio_medio: number | null
          productores: number | null
          productos: number | null
          refreshed_at: string | null
        }
        Relationships: []
      }
      precios_dashboard_mensual: {
        Row: {
          ano: number | null
          clientes: number | null
          facturacion: number | null
          kilos: number | null
          lineas: number | null
          mes: number | null
          month_start: string | null
          precio_medio: number | null
          productos: number | null
          refreshed_at: string | null
        }
        Relationships: []
      }
      ventas_categoria_lineas_con_ajustes: {
        Row: {
          articulo: string | null
          base_iva: number | null
          campana: string | null
          categoria_id: string | null
          cliente_codigo: string | null
          cliente_nombre: string | null
          comision_cent_kg: number | null
          comision_pct: number | null
          created_at: string | null
          fecha: string | null
          id: string | null
          kilos: number | null
          mes: string | null
          metodo_producto: string | null
          pm_venta: number | null
          pm_venta_real: number | null
          pvp: number | null
          referencia: string | null
          transporte_cent_kg: number | null
          transporte_pct: number | null
        }
        Relationships: [
          {
            foreignKeyName: "ventas_categoria_lineas_categoria_id_fkey"
            columns: ["categoria_id"]
            isOneToOne: false
            referencedRelation: "ventas_categorias"
            referencedColumns: ["id"]
          },
        ]
      }
      ventas_categoria_mensual_cliente: {
        Row: {
          base_iva: number | null
          categoria_id: string | null
          cliente_codigo: string | null
          cliente_nombre: string | null
          kilos: number | null
          lineas: number | null
          mes: string | null
          pm_bruto: number | null
          pm_real: number | null
        }
        Relationships: [
          {
            foreignKeyName: "ventas_categoria_lineas_categoria_id_fkey"
            columns: ["categoria_id"]
            isOneToOne: false
            referencedRelation: "ventas_categorias"
            referencedColumns: ["id"]
          },
        ]
      }
      ventas_categoria_mensual_producto: {
        Row: {
          base_iva: number | null
          categoria_id: string | null
          kilos: number | null
          lineas: number | null
          mes: string | null
          metodo_producto: string | null
          pm_bruto: number | null
          pm_real: number | null
        }
        Relationships: [
          {
            foreignKeyName: "ventas_categoria_lineas_categoria_id_fkey"
            columns: ["categoria_id"]
            isOneToOne: false
            referencedRelation: "ventas_categorias"
            referencedColumns: ["id"]
          },
        ]
      }
      ventas_categoria_ranking_clientes: {
        Row: {
          base_iva: number | null
          categoria_id: string | null
          cliente_codigo: string | null
          cliente_nombre: string | null
          kilos: number | null
          lineas: number | null
          pm_bruto: number | null
          pm_real: number | null
          precio_bruto_max: number | null
          precio_real_max: number | null
        }
        Relationships: [
          {
            foreignKeyName: "ventas_categoria_lineas_categoria_id_fkey"
            columns: ["categoria_id"]
            isOneToOne: false
            referencedRelation: "ventas_categorias"
            referencedColumns: ["id"]
          },
        ]
      }
      ventas_categoria_resumen: {
        Row: {
          articulos: number | null
          base_iva: number | null
          categoria_id: string | null
          clientes: number | null
          fecha_max: string | null
          fecha_min: string | null
          kilos: number | null
          lineas: number | null
          pm_bruto: number | null
          pm_real: number | null
          productos: number | null
        }
        Relationships: [
          {
            foreignKeyName: "ventas_categoria_lineas_categoria_id_fkey"
            columns: ["categoria_id"]
            isOneToOne: false
            referencedRelation: "ventas_categorias"
            referencedColumns: ["id"]
          },
        ]
      }
      ventas_categoria_resumen_articulo: {
        Row: {
          articulo: string | null
          base_iva: number | null
          categoria_id: string | null
          kilos: number | null
          lineas: number | null
          pm_bruto: number | null
          pm_real: number | null
          referencia: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ventas_categoria_lineas_categoria_id_fkey"
            columns: ["categoria_id"]
            isOneToOne: false
            referencedRelation: "ventas_categorias"
            referencedColumns: ["id"]
          },
        ]
      }
      ventas_categoria_validacion_catalogo: {
        Row: {
          base_iva_catalogo: number | null
          base_iva_lineas: number | null
          categoria_id: string | null
          descripcion: string | null
          diferencia_base_iva: number | null
          diferencia_kilos: number | null
          kilos_catalogo: number | null
          kilos_lineas: number | null
          lineas_catalogo: number | null
          lineas_detectadas: number | null
          metodo: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      can_access_ventas_categoria: { Args: never; Returns: boolean }
      has_role:
        | {
            Args: {
              _role: Database["public"]["Enums"]["app_role"]
              _user_id: string
            }
            Returns: boolean
          }
        | { Args: { _role: string; _user_id: string }; Returns: boolean }
      search_code: {
        Args: {
          match_count?: number
          match_threshold?: number
          query_embedding: string
        }
        Returns: {
          content: string
          file_path: string
          id: string
          similarity: number
        }[]
      }
      search_conversations: {
        Args: {
          match_count?: number
          match_threshold?: number
          query_embedding: string
          user_uuid: string
        }
        Returns: {
          content: string
          created_at: string
          id: string
          role: string
          similarity: number
        }[]
      }
      search_knowledge: {
        Args: {
          match_count?: number
          match_threshold?: number
          query_embedding: string
        }
        Returns: {
          answer: string
          id: string
          question: string
          similarity: number
        }[]
      }
      ventas_categoria_articulos_filtrado: {
        Args: {
          p_campana?: string
          p_categoria_id: string
          p_cliente_codigo?: string
          p_mes?: string
          p_metodo?: string
        }
        Returns: {
          articulo: string
          base_iva: number
          kilos: number
          lineas: number
          pm_bruto: number
          pm_real: number
          referencia: string
        }[]
      }
      ventas_categoria_mensual_articulo_filtrado: {
        Args: {
          p_campana?: string
          p_categoria_id: string
          p_cliente_codigo?: string
          p_mes?: string
          p_metodo?: string
        }
        Returns: {
          articulo: string
          base_iva: number
          kilos: number
          lineas: number
          mes: string
          pm_bruto: number
          referencia: string
        }[]
      }
      ventas_categoria_mensual_cliente_filtrado: {
        Args: {
          p_campana?: string
          p_categoria_id: string
          p_cliente_codigo?: string
          p_mes?: string
          p_metodo?: string
        }
        Returns: {
          base_iva: number
          cliente_codigo: string
          cliente_nombre: string
          kilos: number
          lineas: number
          mes: string
          pm_bruto: number
          pm_real: number
        }[]
      }
      ventas_categoria_mensual_producto_filtrado: {
        Args: {
          p_campana?: string
          p_categoria_id: string
          p_cliente_codigo?: string
          p_mes?: string
          p_metodo?: string
        }
        Returns: {
          base_iva: number
          kilos: number
          lineas: number
          mes: string
          metodo_producto: string
          pm_bruto: number
          pm_real: number
        }[]
      }
      ventas_categoria_ranking_clientes_filtrado: {
        Args: {
          p_campana?: string
          p_categoria_id: string
          p_cliente_codigo?: string
          p_mes?: string
          p_metodo?: string
        }
        Returns: {
          base_iva: number
          cliente_codigo: string
          cliente_nombre: string
          kilos: number
          lineas: number
          pm_bruto: number
          pm_real: number
          precio_bruto_max: number
          precio_real_max: number
        }[]
      }
      ventas_categoria_resumen_filtrado: {
        Args: {
          p_campana?: string
          p_categoria_id: string
          p_cliente_codigo?: string
          p_mes?: string
          p_metodo?: string
        }
        Returns: {
          articulos: number
          base_iva: number
          clientes: number
          kilos: number
          pm_bruto: number
          pm_real: number
          productos: number
        }[]
      }
    }
    Enums: {
      app_role: "admin" | "operario" | "ventas" | "rrhh"
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
      app_role: ["admin", "operario", "ventas", "rrhh"],
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
