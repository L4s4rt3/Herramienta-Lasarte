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
      app_errores: {
        Row: {
          agente: string | null
          componente: string | null
          creado_at: string
          id: number
          mensaje: string
          pila: string | null
          ruta: string | null
          user_id: string | null
          version_app: string | null
        }
        Insert: {
          agente?: string | null
          componente?: string | null
          creado_at?: string
          id?: never
          mensaje: string
          pila?: string | null
          ruta?: string | null
          user_id?: string | null
          version_app?: string | null
        }
        Update: {
          agente?: string | null
          componente?: string | null
          creado_at?: string
          id?: never
          mensaje?: string
          pila?: string | null
          ruta?: string | null
          user_id?: string | null
          version_app?: string | null
        }
        Relationships: []
      }
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
      calibrador_batch: {
        Row: {
          batch_id: number
          batch_name: string | null
          bins: number | null
          fin: string | null
          finalizado: boolean | null
          grower_code: string | null
          inicio: string | null
          lote: string
          outlet_reject_kg: number | null
          presort_reject_kg: number | null
          productor: string | null
          sincronizado_at: string
          total_reject_kg: number | null
          variedad: string | null
        }
        Insert: {
          batch_id: number
          batch_name?: string | null
          bins?: number | null
          fin?: string | null
          finalizado?: boolean | null
          grower_code?: string | null
          inicio?: string | null
          lote: string
          outlet_reject_kg?: number | null
          presort_reject_kg?: number | null
          productor?: string | null
          sincronizado_at?: string
          total_reject_kg?: number | null
          variedad?: string | null
        }
        Update: {
          batch_id?: number
          batch_name?: string | null
          bins?: number | null
          fin?: string | null
          finalizado?: boolean | null
          grower_code?: string | null
          inicio?: string | null
          lote?: string
          outlet_reject_kg?: number | null
          presort_reject_kg?: number | null
          productor?: string | null
          sincronizado_at?: string
          total_reject_kg?: number | null
          variedad?: string | null
        }
        Relationships: []
      }
      calibrador_clasificacion: {
        Row: {
          batch_id: number
          calidad: string
          cartons: number | null
          clase: string
          grupo_destino: string | null
          lote: string | null
          pct_cartons: number | null
          pct_peso: number | null
          pct_piezas: number | null
          peso_kg: number | null
          piezas: number | null
          producto: string
          tamano: string
        }
        Insert: {
          batch_id: number
          calidad?: string
          cartons?: number | null
          clase: string
          grupo_destino?: string | null
          lote?: string | null
          pct_cartons?: number | null
          pct_peso?: number | null
          pct_piezas?: number | null
          peso_kg?: number | null
          piezas?: number | null
          producto: string
          tamano: string
        }
        Update: {
          batch_id?: number
          calidad?: string
          cartons?: number | null
          clase?: string
          grupo_destino?: string | null
          lote?: string | null
          pct_cartons?: number | null
          pct_peso?: number | null
          pct_piezas?: number | null
          peso_kg?: number | null
          piezas?: number | null
          producto?: string
          tamano?: string
        }
        Relationships: []
      }
      calibrador_informe: {
        Row: {
          batch_id: number | null
          bins_ejecutados: number | null
          bins_hora: number | null
          cartons: number | null
          cartons_hora: number | null
          comienzo: string
          commodity: string | null
          conteo_fruta_medio: number | null
          fecha: string | null
          fichero: string | null
          lote: string
          peso_fruta_media_g: number | null
          productor: string | null
          productor_codigo: string | null
          rechazo_pct: number | null
          recibido_at: string
          tiempo_lote: string | null
          tiempo_maquina: string | null
          toneladas_hora: number | null
          utilizacion_pct: number | null
        }
        Insert: {
          batch_id?: number | null
          bins_ejecutados?: number | null
          bins_hora?: number | null
          cartons?: number | null
          cartons_hora?: number | null
          comienzo: string
          commodity?: string | null
          conteo_fruta_medio?: number | null
          fecha?: string | null
          fichero?: string | null
          lote: string
          peso_fruta_media_g?: number | null
          productor?: string | null
          productor_codigo?: string | null
          rechazo_pct?: number | null
          recibido_at?: string
          tiempo_lote?: string | null
          tiempo_maquina?: string | null
          toneladas_hora?: number | null
          utilizacion_pct?: number | null
        }
        Update: {
          batch_id?: number | null
          bins_ejecutados?: number | null
          bins_hora?: number | null
          cartons?: number | null
          cartons_hora?: number | null
          comienzo?: string
          commodity?: string | null
          conteo_fruta_medio?: number | null
          fecha?: string | null
          fichero?: string | null
          lote?: string
          peso_fruta_media_g?: number | null
          productor?: string | null
          productor_codigo?: string | null
          rechazo_pct?: number | null
          recibido_at?: string
          tiempo_lote?: string | null
          tiempo_maquina?: string | null
          toneladas_hora?: number | null
          utilizacion_pct?: number | null
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
            referencedRelation: "palets"
            referencedColumns: ["part_id"]
          },
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
      calidad_import_controles: {
        Row: {
          barco: string
          calibre: string
          clasificacion: string
          conclusion: string
          created_at: string
          defectos_evolutivos: Json
          defectos_graves: Json
          defectos_leves: Json
          estado: string
          etiquetado: string
          evaluador: string
          fecha: string
          fecha_descarga: string | null
          firma_path: string | null
          ggn: string
          id: string
          kg_total: string
          marca: string
          muestras_internas: Json
          muestreo_evolutivos: string
          muestreo_no_evolutivos: string
          nuestra_ref: string
          num_contenedor: string
          obs_calidad_interna: string
          obs_evolutivos: string
          obs_no_evolutivos: string
          origen: string
          paletizacion: string
          papel: string
          peso_medio_cajas: string
          proveedor: string
          puc_orchard: string
          referencia: string
          sticker: string
          temperatura: string
          tipo_confeccion: string
          tipo_producto: string
          tratamientos: string
          updated_at: string
          user_id: string
        }
        Insert: {
          barco?: string
          calibre?: string
          clasificacion?: string
          conclusion?: string
          created_at?: string
          defectos_evolutivos?: Json
          defectos_graves?: Json
          defectos_leves?: Json
          estado?: string
          etiquetado?: string
          evaluador?: string
          fecha?: string
          fecha_descarga?: string | null
          firma_path?: string | null
          ggn?: string
          id?: string
          kg_total?: string
          marca?: string
          muestras_internas?: Json
          muestreo_evolutivos?: string
          muestreo_no_evolutivos?: string
          nuestra_ref?: string
          num_contenedor?: string
          obs_calidad_interna?: string
          obs_evolutivos?: string
          obs_no_evolutivos?: string
          origen?: string
          paletizacion?: string
          papel?: string
          peso_medio_cajas?: string
          proveedor?: string
          puc_orchard?: string
          referencia?: string
          sticker?: string
          temperatura?: string
          tipo_confeccion?: string
          tipo_producto?: string
          tratamientos?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          barco?: string
          calibre?: string
          clasificacion?: string
          conclusion?: string
          created_at?: string
          defectos_evolutivos?: Json
          defectos_graves?: Json
          defectos_leves?: Json
          estado?: string
          etiquetado?: string
          evaluador?: string
          fecha?: string
          fecha_descarga?: string | null
          firma_path?: string | null
          ggn?: string
          id?: string
          kg_total?: string
          marca?: string
          muestras_internas?: Json
          muestreo_evolutivos?: string
          muestreo_no_evolutivos?: string
          nuestra_ref?: string
          num_contenedor?: string
          obs_calidad_interna?: string
          obs_evolutivos?: string
          obs_no_evolutivos?: string
          origen?: string
          paletizacion?: string
          papel?: string
          peso_medio_cajas?: string
          proveedor?: string
          puc_orchard?: string
          referencia?: string
          sticker?: string
          temperatura?: string
          tipo_confeccion?: string
          tipo_producto?: string
          tratamientos?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      calidad_import_fotos: {
        Row: {
          control_id: string
          created_at: string
          file_name: string
          file_path: string
          file_size: number | null
          id: string
          mime_type: string | null
          orden: number
          user_id: string
        }
        Insert: {
          control_id: string
          created_at?: string
          file_name: string
          file_path: string
          file_size?: number | null
          id?: string
          mime_type?: string | null
          orden?: number
          user_id: string
        }
        Update: {
          control_id?: string
          created_at?: string
          file_name?: string
          file_path?: string
          file_size?: number | null
          id?: string
          mime_type?: string | null
          orden?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "calidad_import_fotos_control_id_fkey"
            columns: ["control_id"]
            isOneToOne: false
            referencedRelation: "calidad_import_controles"
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
          codigo_erp: string | null
          creado_automaticamente: boolean
          created_at: string
          id: string
          nombre: string
          updated_at: string
          user_id: string
        }
        Insert: {
          codigo_erp?: string | null
          creado_automaticamente?: boolean
          created_at?: string
          id?: string
          nombre: string
          updated_at?: string
          user_id: string
        }
        Update: {
          codigo_erp?: string | null
          creado_automaticamente?: boolean
          created_at?: string
          id?: string
          nombre?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      calidad_referencias_productor: {
        Row: {
          created_at: string
          fuente: string
          id: string
          kg_podrido: number
          kg_total: number
          productor_id: string | null
          productor_nombre: string
          rango_desde: string | null
          rango_hasta: string | null
          user_id: string
          variedad: string | null
        }
        Insert: {
          created_at?: string
          fuente?: string
          id?: string
          kg_podrido: number
          kg_total: number
          productor_id?: string | null
          productor_nombre: string
          rango_desde?: string | null
          rango_hasta?: string | null
          user_id: string
          variedad?: string | null
        }
        Update: {
          created_at?: string
          fuente?: string
          id?: string
          kg_podrido?: number
          kg_total?: number
          productor_id?: string | null
          productor_nombre?: string
          rango_desde?: string | null
          rango_hasta?: string | null
          user_id?: string
          variedad?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "calidad_referencias_productor_productor_id_fkey"
            columns: ["productor_id"]
            isOneToOne: false
            referencedRelation: "calidad_productores"
            referencedColumns: ["id"]
          },
        ]
      }
      camara_externa_camiones: {
        Row: {
          created_at: string
          entrada_lst_1: string | null
          entrada_lst_2: string | null
          envases: number | null
          envases_1: number | null
          envases_2: number | null
          fecha_almacenamiento: string
          finca: string | null
          id: string
          kg: number
          lote: string | null
          nota_entrada: string | null
          procedencia: string
          proveedor: string | null
          s_ref: string
          transporte_lst: string | null
          updated_at: string
          user_id: string | null
          variedad: string | null
          venta_directa: string | null
        }
        Insert: {
          created_at?: string
          entrada_lst_1?: string | null
          entrada_lst_2?: string | null
          envases?: number | null
          envases_1?: number | null
          envases_2?: number | null
          fecha_almacenamiento: string
          finca?: string | null
          id?: string
          kg?: number
          lote?: string | null
          nota_entrada?: string | null
          procedencia: string
          proveedor?: string | null
          s_ref: string
          transporte_lst?: string | null
          updated_at?: string
          user_id?: string | null
          variedad?: string | null
          venta_directa?: string | null
        }
        Update: {
          created_at?: string
          entrada_lst_1?: string | null
          entrada_lst_2?: string | null
          envases?: number | null
          envases_1?: number | null
          envases_2?: number | null
          fecha_almacenamiento?: string
          finca?: string | null
          id?: string
          kg?: number
          lote?: string | null
          nota_entrada?: string | null
          procedencia?: string
          proveedor?: string | null
          s_ref?: string
          transporte_lst?: string | null
          updated_at?: string
          user_id?: string | null
          variedad?: string | null
          venta_directa?: string | null
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
      cierre_mensual_envios: {
        Row: {
          anio: number
          asunto: string
          destinatarios: string[]
          detalle: string | null
          enviado_at: string
          estado: string
          id: string
          kg_calibrado: number | null
          kg_entrada: number | null
          mes: number
        }
        Insert: {
          anio: number
          asunto: string
          destinatarios: string[]
          detalle?: string | null
          enviado_at?: string
          estado?: string
          id?: string
          kg_calibrado?: number | null
          kg_entrada?: number | null
          mes: number
        }
        Update: {
          anio?: number
          asunto?: string
          destinatarios?: string[]
          detalle?: string | null
          enviado_at?: string
          estado?: string
          id?: string
          kg_calibrado?: number | null
          kg_entrada?: number | null
          mes?: number
        }
        Relationships: []
      }
      clasificacion_lote_mix_meta: {
        Row: {
          duracion_ms: number | null
          filas: number | null
          id: boolean
          refrescado_en: string | null
        }
        Insert: {
          duracion_ms?: number | null
          filas?: number | null
          id?: boolean
          refrescado_en?: string | null
        }
        Update: {
          duracion_ms?: number | null
          filas?: number | null
          id?: boolean
          refrescado_en?: string | null
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
      cmv_costes_mensuales: {
        Row: {
          concepto: string | null
          created_at: string
          id: string
          importe: number
          mes: string
          notas: string | null
          tipo: string
          user_id: string | null
        }
        Insert: {
          concepto?: string | null
          created_at?: string
          id?: string
          importe: number
          mes: string
          notas?: string | null
          tipo: string
          user_id?: string | null
        }
        Update: {
          concepto?: string | null
          created_at?: string
          id?: string
          importe?: number
          mes?: string
          notas?: string | null
          tipo?: string
          user_id?: string | null
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
      comunicaciones_campo: {
        Row: {
          asunto: string
          created_at: string
          cuerpo: string
          destinatarios: Json
          enviados: number
          estado: string
          fallidos: Json | null
          id: string
          provider_ids: Json | null
          user_id: string | null
        }
        Insert: {
          asunto: string
          created_at?: string
          cuerpo: string
          destinatarios?: Json
          enviados?: number
          estado: string
          fallidos?: Json | null
          id?: string
          provider_ids?: Json | null
          user_id?: string | null
        }
        Update: {
          asunto?: string
          created_at?: string
          cuerpo?: string
          destinatarios?: Json
          enviados?: number
          estado?: string
          fallidos?: Json | null
          id?: string
          provider_ids?: Json | null
          user_id?: string | null
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
      contactos_campo: {
        Row: {
          activo: boolean
          created_at: string
          email: string
          id: string
          nombre: string
          notas: string | null
          productor_id: string | null
          tipo: string
          user_id: string | null
        }
        Insert: {
          activo?: boolean
          created_at?: string
          email: string
          id?: string
          nombre: string
          notas?: string | null
          productor_id?: string | null
          tipo: string
          user_id?: string | null
        }
        Update: {
          activo?: boolean
          created_at?: string
          email?: string
          id?: string
          nombre?: string
          notas?: string | null
          productor_id?: string | null
          tipo?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contactos_campo_productor_id_fkey"
            columns: ["productor_id"]
            isOneToOne: false
            referencedRelation: "calidad_productores"
            referencedColumns: ["id"]
          },
        ]
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
      economico_mallas_config: {
        Row: {
          created_at: string
          id: string
          kg_por_malla: number | null
          notas: string | null
          precio_malla: number | null
          tipo_malla: string | null
          user_id: string
          vigente_desde: string
          zona: string
        }
        Insert: {
          created_at?: string
          id?: string
          kg_por_malla?: number | null
          notas?: string | null
          precio_malla?: number | null
          tipo_malla?: string | null
          user_id?: string
          vigente_desde?: string
          zona: string
        }
        Update: {
          created_at?: string
          id?: string
          kg_por_malla?: number | null
          notas?: string | null
          precio_malla?: number | null
          tipo_malla?: string | null
          user_id?: string
          vigente_desde?: string
          zona?: string
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
      empaque_precios: {
        Row: {
          componente: string
          created_at: string
          id: string
          notas: string | null
          precio_malla: number
          tipo_malla: string
          user_id: string | null
          vigente_desde: string
        }
        Insert: {
          componente: string
          created_at?: string
          id?: string
          notas?: string | null
          precio_malla?: number
          tipo_malla: string
          user_id?: string | null
          vigente_desde: string
        }
        Update: {
          componente?: string
          created_at?: string
          id?: string
          notas?: string | null
          precio_malla?: number
          tipo_malla?: string
          user_id?: string | null
          vigente_desde?: string
        }
        Relationships: []
      }
      entradas_bascula: {
        Row: {
          agricultor: string | null
          articulo: string | null
          camara_confirmada_fecha: string | null
          camara_confirmada_nombre: string | null
          cerrado_at: string | null
          certificada: boolean
          certificado_ggn: string | null
          cierre_modo: string | null
          comision_kg: number | null
          coste_recoleccion: number | null
          coste_recoleccion_estimado: number | null
          created_at: string
          envases: number | null
          fecha: string
          fecha_salida_camara: string | null
          finca: string | null
          id: string
          importe_comision: number | null
          importe_compra: number | null
          importe_total: number | null
          importe_transporte: number | null
          kg_ajuste_stock: number
          kg_bruto_bascula: number | null
          kg_entrada: number
          lote: string
          merma_camara_kg: number | null
          num_entrada: string | null
          origen: string
          parcela: string | null
          precio_compra_kg: number | null
          productor_id: string | null
          recol_estimacion_origen: string | null
          recol_kg: number | null
          recol_kg_estimado: number | null
          tipo_envase: string | null
          user_id: string
        }
        Insert: {
          agricultor?: string | null
          articulo?: string | null
          camara_confirmada_fecha?: string | null
          camara_confirmada_nombre?: string | null
          cerrado_at?: string | null
          certificada?: boolean
          certificado_ggn?: string | null
          cierre_modo?: string | null
          comision_kg?: number | null
          coste_recoleccion?: number | null
          coste_recoleccion_estimado?: number | null
          created_at?: string
          envases?: number | null
          fecha: string
          fecha_salida_camara?: string | null
          finca?: string | null
          id?: string
          importe_comision?: number | null
          importe_compra?: number | null
          importe_total?: number | null
          importe_transporte?: number | null
          kg_ajuste_stock?: number
          kg_bruto_bascula?: number | null
          kg_entrada?: number
          lote: string
          merma_camara_kg?: number | null
          num_entrada?: string | null
          origen?: string
          parcela?: string | null
          precio_compra_kg?: number | null
          productor_id?: string | null
          recol_estimacion_origen?: string | null
          recol_kg?: number | null
          recol_kg_estimado?: number | null
          tipo_envase?: string | null
          user_id: string
        }
        Update: {
          agricultor?: string | null
          articulo?: string | null
          camara_confirmada_fecha?: string | null
          camara_confirmada_nombre?: string | null
          cerrado_at?: string | null
          certificada?: boolean
          certificado_ggn?: string | null
          cierre_modo?: string | null
          comision_kg?: number | null
          coste_recoleccion?: number | null
          coste_recoleccion_estimado?: number | null
          created_at?: string
          envases?: number | null
          fecha?: string
          fecha_salida_camara?: string | null
          finca?: string | null
          id?: string
          importe_comision?: number | null
          importe_compra?: number | null
          importe_total?: number | null
          importe_transporte?: number | null
          kg_ajuste_stock?: number
          kg_bruto_bascula?: number | null
          kg_entrada?: number
          lote?: string
          merma_camara_kg?: number | null
          num_entrada?: string | null
          origen?: string
          parcela?: string | null
          precio_compra_kg?: number | null
          productor_id?: string | null
          recol_estimacion_origen?: string | null
          recol_kg?: number | null
          recol_kg_estimado?: number | null
          tipo_envase?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "entradas_bascula_productor_id_fkey"
            columns: ["productor_id"]
            isOneToOne: false
            referencedRelation: "calidad_productores"
            referencedColumns: ["id"]
          },
        ]
      }
      erp_confeccion_origen: {
        Row: {
          articulo: string | null
          kg_atribuidos: number
          lote_confeccion: string
          lote_entrada: string
          sincronizado_at: string
        }
        Insert: {
          articulo?: string | null
          kg_atribuidos: number
          lote_confeccion: string
          lote_entrada: string
          sincronizado_at?: string
        }
        Update: {
          articulo?: string | null
          kg_atribuidos?: number
          lote_confeccion?: string
          lote_entrada?: string
          sincronizado_at?: string
        }
        Relationships: []
      }
      erp_correcciones: {
        Row: {
          aceptada_en: string | null
          aceptada_por: string | null
          campo: string
          detectada_en: string
          en_el_erp: string | null
          en_la_app: string | null
          fecha: string | null
          lote: string
          nota: string | null
          vista_en: string
        }
        Insert: {
          aceptada_en?: string | null
          aceptada_por?: string | null
          campo: string
          detectada_en?: string
          en_el_erp?: string | null
          en_la_app?: string | null
          fecha?: string | null
          lote: string
          nota?: string | null
          vista_en?: string
        }
        Update: {
          aceptada_en?: string | null
          aceptada_por?: string | null
          campo?: string
          detectada_en?: string
          en_el_erp?: string | null
          en_la_app?: string | null
          fecha?: string | null
          lote?: string
          nota?: string | null
          vista_en?: string
        }
        Relationships: []
      }
      erp_palet: {
        Row: {
          articulo: string | null
          cliente: string | null
          cliente_codigo: string | null
          codigo_sscc: string | null
          comercial: boolean
          fecha: string
          fecha_factura: string | null
          fecha_venta: string | null
          importe_venta: number | null
          kg_brutos: number | null
          kg_netos: number | null
          linea_venta: number | null
          lote_confeccion: string | null
          num_albaran_venta: string | null
          num_cajas: number | null
          num_factura: string | null
          numero: string
          referencia: string | null
          serie_albaran_venta: string | null
          sincronizado_at: string
        }
        Insert: {
          articulo?: string | null
          cliente?: string | null
          cliente_codigo?: string | null
          codigo_sscc?: string | null
          comercial?: boolean
          fecha: string
          fecha_factura?: string | null
          fecha_venta?: string | null
          importe_venta?: number | null
          kg_brutos?: number | null
          kg_netos?: number | null
          linea_venta?: number | null
          lote_confeccion?: string | null
          num_albaran_venta?: string | null
          num_cajas?: number | null
          num_factura?: string | null
          numero: string
          referencia?: string | null
          serie_albaran_venta?: string | null
          sincronizado_at?: string
        }
        Update: {
          articulo?: string | null
          cliente?: string | null
          cliente_codigo?: string | null
          codigo_sscc?: string | null
          comercial?: boolean
          fecha?: string
          fecha_factura?: string | null
          fecha_venta?: string | null
          importe_venta?: number | null
          kg_brutos?: number | null
          kg_netos?: number | null
          linea_venta?: number | null
          lote_confeccion?: string | null
          num_albaran_venta?: string | null
          num_cajas?: number | null
          num_factura?: string | null
          numero?: string
          referencia?: string | null
          serie_albaran_venta?: string | null
          sincronizado_at?: string
        }
        Relationships: []
      }
      erp_palets_foto: {
        Row: {
          dia: string
          kg_campo: number
          kg_egipto: number
          kg_mayor_palet: number | null
          kg_netos: number
          palets: number
          sin_valorar: number
          tomada_a: string
        }
        Insert: {
          dia: string
          kg_campo?: number
          kg_egipto?: number
          kg_mayor_palet?: number | null
          kg_netos: number
          palets: number
          sin_valorar?: number
          tomada_a?: string
        }
        Update: {
          dia?: string
          kg_campo?: number
          kg_egipto?: number
          kg_mayor_palet?: number | null
          kg_netos?: number
          palets?: number
          sin_valorar?: number
          tomada_a?: string
        }
        Relationships: []
      }
      erp_precalibrado_origen: {
        Row: {
          articulo: string | null
          casado: string
          kg_atribuidos: number
          kg_traza: number
          lote_confeccion: string | null
          lote_origen: string
          lote_reentrada: string
          sincronizado_at: string
        }
        Insert: {
          articulo?: string | null
          casado?: string
          kg_atribuidos: number
          kg_traza: number
          lote_confeccion?: string | null
          lote_origen: string
          lote_reentrada: string
          sincronizado_at?: string
        }
        Update: {
          articulo?: string | null
          casado?: string
          kg_atribuidos?: number
          kg_traza?: number
          lote_confeccion?: string | null
          lote_origen?: string
          lote_reentrada?: string
          sincronizado_at?: string
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
            referencedRelation: "palets"
            referencedColumns: ["part_id"]
          },
          {
            foreignKeyName: "gstock_entries_part_id_fkey"
            columns: ["part_id"]
            isOneToOne: false
            referencedRelation: "partes_diarios"
            referencedColumns: ["id"]
          },
        ]
      }
      informe_semanal_envios: {
        Row: {
          anio: number
          asunto: string
          avisos: Json
          beneficio_eur: number | null
          destinatarios: string[]
          detalle: string | null
          enviado_at: string
          estado: string
          id: string
          kg_total: number | null
          semana: number
        }
        Insert: {
          anio: number
          asunto: string
          avisos?: Json
          beneficio_eur?: number | null
          destinatarios: string[]
          detalle?: string | null
          enviado_at?: string
          estado?: string
          id?: string
          kg_total?: number | null
          semana: number
        }
        Update: {
          anio?: number
          asunto?: string
          avisos?: Json
          beneficio_eur?: number | null
          destinatarios?: string[]
          detalle?: string | null
          enviado_at?: string
          estado?: string
          id?: string
          kg_total?: number | null
          semana?: number
        }
        Relationships: []
      }
      limpieza_parte_trabajadores: {
        Row: {
          created_at: string
          horas: number
          id: string
          nombre: string
          parte_id: string
          trabajador_id: string | null
        }
        Insert: {
          created_at?: string
          horas: number
          id?: string
          nombre: string
          parte_id: string
          trabajador_id?: string | null
        }
        Update: {
          created_at?: string
          horas?: number
          id?: string
          nombre?: string
          parte_id?: string
          trabajador_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "limpieza_parte_trabajadores_parte_id_fkey"
            columns: ["parte_id"]
            isOneToOne: false
            referencedRelation: "limpieza_partes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "limpieza_parte_trabajadores_trabajador_id_fkey"
            columns: ["trabajador_id"]
            isOneToOne: false
            referencedRelation: "trabajadores"
            referencedColumns: ["id"]
          },
        ]
      }
      limpieza_partes: {
        Row: {
          box: number
          created_at: string
          escaleras: number | null
          fecha: string
          id: string
          observaciones: string | null
          pies: number | null
          turno: number
          unidad: string
          updated_at: string
          user_id: string
        }
        Insert: {
          box: number
          created_at?: string
          escaleras?: number | null
          fecha: string
          id?: string
          observaciones?: string | null
          pies?: number | null
          turno?: number
          unidad: string
          updated_at?: string
          user_id: string
        }
        Update: {
          box?: number
          created_at?: string
          escaleras?: number | null
          fecha?: string
          id?: string
          observaciones?: string | null
          pies?: number | null
          turno?: number
          unidad?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
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
            referencedRelation: "palets"
            referencedColumns: ["part_id"]
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
          kg_precalibrado_z1: number | null
          kg_precalibrado_z2: number | null
          lote_codigo: string | null
          notas: string | null
          part_id: string
          peso_fruta_promedio_g: number | null
          producto: string | null
          productor: string | null
          productor_id: string | null
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
          kg_precalibrado_z1?: number | null
          kg_precalibrado_z2?: number | null
          lote_codigo?: string | null
          notas?: string | null
          part_id: string
          peso_fruta_promedio_g?: number | null
          producto?: string | null
          productor?: string | null
          productor_id?: string | null
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
          kg_precalibrado_z1?: number | null
          kg_precalibrado_z2?: number | null
          lote_codigo?: string | null
          notas?: string | null
          part_id?: string
          peso_fruta_promedio_g?: number | null
          producto?: string | null
          productor?: string | null
          productor_id?: string | null
          source?: Database["public"]["Enums"]["data_source"]
          toneladas_hora?: number | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lotes_dia_part_id_fkey"
            columns: ["part_id"]
            isOneToOne: false
            referencedRelation: "palets"
            referencedColumns: ["part_id"]
          },
          {
            foreignKeyName: "lotes_dia_part_id_fkey"
            columns: ["part_id"]
            isOneToOne: false
            referencedRelation: "partes_diarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lotes_dia_productor_id_fkey"
            columns: ["productor_id"]
            isOneToOne: false
            referencedRelation: "calidad_productores"
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
          lote_codigo: string | null
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
          lote_codigo?: string | null
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
          lote_codigo?: string | null
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
            referencedRelation: "palets"
            referencedColumns: ["part_id"]
          },
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
            referencedRelation: "palets"
            referencedColumns: ["part_id"]
          },
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
          box_reciclaje: number | null
          box_reciclaje_z1: number | null
          box_reciclaje_z2: number | null
          campos_estimados: Json | null
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
          kg_podrido_bateas: number | null
          kg_podrido_bolsa_basura: number | null
          kg_podrido_calibrador_auto: number | null
          kg_produccion_calibrador: number
          kg_reciclado_malla_z1: number
          kg_reciclado_malla_z1_bruto: number | null
          kg_reciclado_malla_z2: number
          kg_reciclado_malla_z2_bruto: number | null
          notas_generales: string | null
          notas_inventario: string | null
          origen_calibrador: string | null
          resumen_analisis: Json | null
          resumen_ia: Json | null
          updated_at: string
          user_id: string
        }
        Insert: {
          box_reciclaje?: number | null
          box_reciclaje_z1?: number | null
          box_reciclaje_z2?: number | null
          campos_estimados?: Json | null
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
          kg_podrido_bateas?: number | null
          kg_podrido_bolsa_basura?: number | null
          kg_podrido_calibrador_auto?: number | null
          kg_produccion_calibrador?: number
          kg_reciclado_malla_z1?: number
          kg_reciclado_malla_z1_bruto?: number | null
          kg_reciclado_malla_z2?: number
          kg_reciclado_malla_z2_bruto?: number | null
          notas_generales?: string | null
          notas_inventario?: string | null
          origen_calibrador?: string | null
          resumen_analisis?: Json | null
          resumen_ia?: Json | null
          updated_at?: string
          user_id: string
        }
        Update: {
          box_reciclaje?: number | null
          box_reciclaje_z1?: number | null
          box_reciclaje_z2?: number | null
          campos_estimados?: Json | null
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
          kg_podrido_bateas?: number | null
          kg_podrido_bolsa_basura?: number | null
          kg_podrido_calibrador_auto?: number | null
          kg_produccion_calibrador?: number
          kg_reciclado_malla_z1?: number
          kg_reciclado_malla_z1_bruto?: number | null
          kg_reciclado_malla_z2?: number
          kg_reciclado_malla_z2_bruto?: number | null
          notas_generales?: string | null
          notas_inventario?: string | null
          origen_calibrador?: string | null
          resumen_analisis?: Json | null
          resumen_ia?: Json | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      pasada_anotaciones: {
        Row: {
          codigo_extra: string
          created_at: string
          id: string
          lote_dia_id: string
          nota: string | null
          user_id: string
        }
        Insert: {
          codigo_extra: string
          created_at?: string
          id?: string
          lote_dia_id: string
          nota?: string | null
          user_id: string
        }
        Update: {
          codigo_extra?: string
          created_at?: string
          id?: string
          lote_dia_id?: string
          nota?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pasada_anotaciones_lote_dia_id_fkey"
            columns: ["lote_dia_id"]
            isOneToOne: false
            referencedRelation: "lotes_dia"
            referencedColumns: ["id"]
          },
        ]
      }
      pasada_box_lineas: {
        Row: {
          box: number | null
          box_tamano: string
          created_at: string
          id: string
          lote_codigo: string | null
          lote_dia_id: string
          nota: string | null
          posicion: number
          prec_fecha: string | null
          tipo: string
          updated_at: string
          user_id: string
        }
        Insert: {
          box?: number | null
          box_tamano?: string
          created_at?: string
          id?: string
          lote_codigo?: string | null
          lote_dia_id: string
          nota?: string | null
          posicion: number
          prec_fecha?: string | null
          tipo: string
          updated_at?: string
          user_id: string
        }
        Update: {
          box?: number | null
          box_tamano?: string
          created_at?: string
          id?: string
          lote_codigo?: string | null
          lote_dia_id?: string
          nota?: string | null
          posicion?: number
          prec_fecha?: string | null
          tipo?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pasada_box_lineas_lote_dia_id_fkey"
            columns: ["lote_dia_id"]
            isOneToOne: false
            referencedRelation: "lotes_dia"
            referencedColumns: ["id"]
          },
        ]
      }
      podrido_inspecciones: {
        Row: {
          created_at: string
          fecha: string
          id: string
          kg_por_box: number | null
          lote: string
          naranjas_inspeccionadas: number
          naranjas_podridas: number
          naranjas_por_box: number | null
          notas: string | null
          pct_podrido: number
          peso_naranja_g: number | null
          podridas_por_box: Json
          user_id: string | null
        }
        Insert: {
          created_at?: string
          fecha?: string
          id?: string
          kg_por_box?: number | null
          lote: string
          naranjas_inspeccionadas: number
          naranjas_podridas: number
          naranjas_por_box?: number | null
          notas?: string | null
          pct_podrido: number
          peso_naranja_g?: number | null
          podridas_por_box?: Json
          user_id?: string | null
        }
        Update: {
          created_at?: string
          fecha?: string
          id?: string
          kg_por_box?: number | null
          lote?: string
          naranjas_inspeccionadas?: number
          naranjas_podridas?: number
          naranjas_por_box?: number | null
          notas?: string | null
          pct_podrido?: number
          peso_naranja_g?: number | null
          podridas_por_box?: Json
          user_id?: string | null
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
            referencedRelation: "palets"
            referencedColumns: ["part_id"]
          },
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
            referencedRelation: "palets"
            referencedColumns: ["part_id"]
          },
          {
            foreignKeyName: "producto_dia_part_id_fkey"
            columns: ["part_id"]
            isOneToOne: false
            referencedRelation: "partes_diarios"
            referencedColumns: ["id"]
          },
        ]
      }
      productores_alias: {
        Row: {
          alias: string
          alias_normalizado: string
          created_at: string
          id: string
          origen: string
          productor_id: string
        }
        Insert: {
          alias: string
          alias_normalizado: string
          created_at?: string
          id?: string
          origen?: string
          productor_id: string
        }
        Update: {
          alias?: string
          alias_normalizado?: string
          created_at?: string
          id?: string
          origen?: string
          productor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "productores_alias_productor_id_fkey"
            columns: ["productor_id"]
            isOneToOne: false
            referencedRelation: "calidad_productores"
            referencedColumns: ["id"]
          },
        ]
      }
      productos_alias: {
        Row: {
          alias: string
          alias_clave: string
          created_at: string
          id: string
          origen: string
          producto_id: string
        }
        Insert: {
          alias: string
          alias_clave: string
          created_at?: string
          id?: string
          origen?: string
          producto_id: string
        }
        Update: {
          alias?: string
          alias_clave?: string
          created_at?: string
          id?: string
          origen?: string
          producto_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "productos_alias_producto_id_fkey"
            columns: ["producto_id"]
            isOneToOne: false
            referencedRelation: "productos_catalogo"
            referencedColumns: ["id"]
          },
        ]
      }
      productos_catalogo: {
        Row: {
          activo: boolean
          clave: string
          coste_material_bulto: number | null
          coste_material_pieza: number | null
          created_at: string
          editado_at: string | null
          editado_por: string | null
          id: string
          indice_confeccion: number | null
          kg_por_bulto: number | null
          metodo_venta: string | null
          nombre: string
          notas: string | null
          precio_venta_eur_kg: number | null
          zona_override: string | null
        }
        Insert: {
          activo?: boolean
          clave?: string
          coste_material_bulto?: number | null
          coste_material_pieza?: number | null
          created_at?: string
          editado_at?: string | null
          editado_por?: string | null
          id?: string
          indice_confeccion?: number | null
          kg_por_bulto?: number | null
          metodo_venta?: string | null
          nombre: string
          notas?: string | null
          precio_venta_eur_kg?: number | null
          zona_override?: string | null
        }
        Update: {
          activo?: boolean
          clave?: string
          coste_material_bulto?: number | null
          coste_material_pieza?: number | null
          created_at?: string
          editado_at?: string | null
          editado_por?: string | null
          id?: string
          indice_confeccion?: number | null
          kg_por_bulto?: number | null
          metodo_venta?: string | null
          nombre?: string
          notas?: string | null
          precio_venta_eur_kg?: number | null
          zona_override?: string | null
        }
        Relationships: []
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
      rrhh_comunicaciones: {
        Row: {
          asunto: string
          created_at: string
          cuerpo: string
          destinatarios: Json
          detalle_envio: Json | null
          enviado_at: string | null
          estado: string
          id: string
          tipo: string
          user_id: string
        }
        Insert: {
          asunto: string
          created_at?: string
          cuerpo: string
          destinatarios?: Json
          detalle_envio?: Json | null
          enviado_at?: string | null
          estado?: string
          id?: string
          tipo?: string
          user_id?: string
        }
        Update: {
          asunto?: string
          created_at?: string
          cuerpo?: string
          destinatarios?: Json
          detalle_envio?: Json | null
          enviado_at?: string | null
          estado?: string
          id?: string
          tipo?: string
          user_id?: string
        }
        Relationships: []
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
      saf_camiones: {
        Row: {
          cajas: number
          created_at: string
          eur_caja: number
          fecha: string | null
          kg_neto_laadbon: number | null
          laadbon_ref: string | null
          lote: string
          notas: string | null
          porte_eur: number | null
          proveedor: string
          updated_at: string
        }
        Insert: {
          cajas: number
          created_at?: string
          eur_caja: number
          fecha?: string | null
          kg_neto_laadbon?: number | null
          laadbon_ref?: string | null
          lote: string
          notas?: string | null
          porte_eur?: number | null
          proveedor?: string
          updated_at?: string
        }
        Update: {
          cajas?: number
          created_at?: string
          eur_caja?: number
          fecha?: string | null
          kg_neto_laadbon?: number | null
          laadbon_ref?: string | null
          lote?: string
          notas?: string | null
          porte_eur?: number | null
          proveedor?: string
          updated_at?: string
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
      sistema_ejecuciones: {
        Row: {
          datos: Json
          detalle: string | null
          equipo: string | null
          estado: string
          fin: string
          id: number
          inicio: string | null
          trabajo: string
        }
        Insert: {
          datos?: Json
          detalle?: string | null
          equipo?: string | null
          estado: string
          fin?: string
          id?: never
          inicio?: string | null
          trabajo: string
        }
        Update: {
          datos?: Json
          detalle?: string | null
          equipo?: string | null
          estado?: string
          fin?: string
          id?: never
          inicio?: string | null
          trabajo?: string
        }
        Relationships: []
      }
      sistema_latidos: {
        Row: {
          detalle: string | null
          equipo: string | null
          estado: string
          trabajo: string
          visto_a: string
        }
        Insert: {
          detalle?: string | null
          equipo?: string | null
          estado?: string
          trabajo: string
          visto_a?: string
        }
        Update: {
          detalle?: string | null
          equipo?: string | null
          estado?: string
          trabajo?: string
          visto_a?: string
        }
        Relationships: []
      }
      stock_consumibles: {
        Row: {
          activo: boolean
          almacen: string
          creado_por: string | null
          created_at: string
          familia: string
          id: string
          nombre: string
          nota: string | null
          precio_unitario: number | null
          stock: number
          unidad: string
          updated_at: string
        }
        Insert: {
          activo?: boolean
          almacen?: string
          creado_por?: string | null
          created_at?: string
          familia?: string
          id?: string
          nombre: string
          nota?: string | null
          precio_unitario?: number | null
          stock?: number
          unidad?: string
          updated_at?: string
        }
        Update: {
          activo?: boolean
          almacen?: string
          creado_por?: string | null
          created_at?: string
          familia?: string
          id?: string
          nombre?: string
          nota?: string | null
          precio_unitario?: number | null
          stock?: number
          unidad?: string
          updated_at?: string
        }
        Relationships: []
      }
      stock_consumibles_historial: {
        Row: {
          cambiado_por: string | null
          consumible_id: string
          created_at: string
          id: string
          stock_anterior: number | null
          stock_nuevo: number
        }
        Insert: {
          cambiado_por?: string | null
          consumible_id: string
          created_at?: string
          id?: string
          stock_anterior?: number | null
          stock_nuevo: number
        }
        Update: {
          cambiado_por?: string | null
          consumible_id?: string
          created_at?: string
          id?: string
          stock_anterior?: number | null
          stock_nuevo?: number
        }
        Relationships: [
          {
            foreignKeyName: "stock_consumibles_historial_consumible_id_fkey"
            columns: ["consumible_id"]
            isOneToOne: false
            referencedRelation: "stock_consumibles"
            referencedColumns: ["id"]
          },
        ]
      }
      trabajadores: {
        Row: {
          activo: boolean
          categoria_profesional: string | null
          computa_kg_persona: boolean | null
          coste_hora: number | null
          created_at: string
          dni: string | null
          email: string | null
          fecha_alta: string | null
          id: string
          nombre: string
          telefono: string | null
          user_id: string
          vacaciones_dias_anuales: number
          zona: string | null
        }
        Insert: {
          activo?: boolean
          categoria_profesional?: string | null
          computa_kg_persona?: boolean | null
          coste_hora?: number | null
          created_at?: string
          dni?: string | null
          email?: string | null
          fecha_alta?: string | null
          id?: string
          nombre: string
          telefono?: string | null
          user_id: string
          vacaciones_dias_anuales?: number
          zona?: string | null
        }
        Update: {
          activo?: boolean
          categoria_profesional?: string | null
          computa_kg_persona?: boolean | null
          coste_hora?: number | null
          created_at?: string
          dni?: string | null
          email?: string | null
          fecha_alta?: string | null
          id?: string
          nombre?: string
          telefono?: string | null
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
      ventas_mercadona_envios: {
        Row: {
          anio: number
          asunto: string
          cajas: number | null
          destinatarios: string[]
          detalle: string | null
          enviado_at: string
          estado: string
          id: string
          kg: number | null
          palets: number | null
          semana: number
        }
        Insert: {
          anio: number
          asunto: string
          cajas?: number | null
          destinatarios: string[]
          detalle?: string | null
          enviado_at?: string
          estado?: string
          id?: string
          kg?: number | null
          palets?: number | null
          semana: number
        }
        Update: {
          anio?: number
          asunto?: string
          cajas?: number | null
          destinatarios?: string[]
          detalle?: string | null
          enviado_at?: string
          estado?: string
          id?: string
          kg?: number | null
          palets?: number | null
          semana?: number
        }
        Relationships: []
      }
      vigia_hallazgos: {
        Row: {
          actualizado_at: string
          clave: string
          creado_at: string
          detalle: string | null
          eur: number | null
          id: string
          kg: number | null
          regla: string
          resuelto_at: string | null
          severidad: string
          tipo: string
          titulo: string
        }
        Insert: {
          actualizado_at?: string
          clave: string
          creado_at?: string
          detalle?: string | null
          eur?: number | null
          id?: string
          kg?: number | null
          regla: string
          resuelto_at?: string | null
          severidad: string
          tipo: string
          titulo: string
        }
        Update: {
          actualizado_at?: string
          clave?: string
          creado_at?: string
          detalle?: string | null
          eur?: number | null
          id?: string
          kg?: number | null
          regla?: string
          resuelto_at?: string | null
          severidad?: string
          tipo?: string
          titulo?: string
        }
        Relationships: []
      }
    }
    Views: {
      clasificacion_lote: {
        Row: {
          archivo_id: string | null
          batch_id: number | null
          calidad: string | null
          cartons: number | null
          clase: string | null
          created_at: string | null
          duracion_min: number | null
          fecha: string | null
          fraccion_productor: number | null
          fuente: string | null
          grupo_destino: string | null
          id: string | null
          lote_codigo: string | null
          lote_codigo_base: string | null
          lote_dia_id: string | null
          part_id: string | null
          pct_cartons: number | null
          pct_peso: number | null
          pct_piezas: number | null
          peso_fruta_promedio_g: number | null
          peso_kg: number | null
          piezas: number | null
          producto: string | null
          productor: string | null
          productor_id: string | null
          tamano: string | null
          toneladas_hora: number | null
          user_id: string | null
        }
        Relationships: []
      }
      clasificacion_lote_detalle_mv: {
        Row: {
          batch_id: number | null
          clase: string | null
          destino: string | null
          fecha: string | null
          fuente: string | null
          kg: number | null
          letra: string | null
          lote_codigo: string | null
          lote8: string | null
          n_filas: number | null
          piezas: number | null
          producto: string | null
          tamano: string | null
        }
        Relationships: []
      }
      clasificacion_lote_mix_mv: {
        Row: {
          con_docx: boolean | null
          kg_clase_apta: number | null
          kg_clase_industria: number | null
          kg_clase_podrido: number | null
          kg_clasificado: number | null
          kg_exportacion: number | null
          kg_mujeres: number | null
          kg_no_comercial: number | null
          kg_no_exportacion: number | null
          lote8: string | null
          n_filas: number | null
          producto: string | null
        }
        Relationships: []
      }
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
      lote_clasificacion_podrido_agg: {
        Row: {
          kg_podrido: number | null
          kg_total: number | null
          lote8: string | null
          n_filas: number | null
        }
        Relationships: []
      }
      lote_clasificacion_productor_agg: {
        Row: {
          cartons: number | null
          clase: string | null
          fecha: string | null
          grupo_destino: string | null
          n_filas: number | null
          peso_kg: number | null
          piezas: number | null
          productor: string | null
          tamano: string | null
        }
        Relationships: []
      }
      palets: {
        Row: {
          campo: boolean | null
          cliente: string | null
          cliente_codigo: string | null
          codigo_sscc: string | null
          comercial: boolean | null
          destino: string | null
          dia_cerrado: boolean | null
          egipto: boolean | null
          fecha: string | null
          fecha_factura: string | null
          fecha_venta: string | null
          importe_venta: number | null
          kg_brutos: number | null
          kg_neto: number | null
          linea_venta: number | null
          lote_codigo: string | null
          n_cajas: number | null
          num_albaran_venta: string | null
          num_factura: string | null
          palet_id: string | null
          part_id: string | null
          precalibrado: boolean | null
          producto: string | null
          referencia: string | null
          serie_albaran_venta: string | null
          sincronizado_at: string | null
          situacion: string | null
          vendido: boolean | null
        }
        Relationships: []
      }
      palets_dia_cerrado: {
        Row: {
          cerrado: boolean | null
          dia: string | null
          kg_mayor_palet: number | null
          sin_valorar: number | null
          ultima_foto: string | null
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
      productor_lote: {
        Row: {
          fraccion: number | null
          lote: string | null
          productor: string | null
          productor_id: string | null
        }
        Relationships: []
      }
      productor_lote_dominante: {
        Row: {
          fraccion: number | null
          lote: string | null
          productor: string | null
          productor_id: string | null
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
      calibrador_aprovechamiento_productor: {
        Args: { desde?: string; hasta?: string }
        Returns: {
          kg_exportacion: number
          kg_industria: number
          kg_mujeres: number
          kg_no_exportacion: number
          kg_otros: number
          kg_provisional: number
          kg_total: number
          lotes: number
          pct_exportacion: number
          productor: string
          productor_id: string
        }[]
      }
      calibrador_capacidad_lotes: {
        Args: never
        Returns: {
          kg_atribuido_simple: number
          kg_entrada: number
          lote: string
        }[]
      }
      calibrador_desglose_sin_repartir: {
        Args: { desde?: string; hasta?: string }
        Returns: {
          kg: number
          pasadas: number
          pasadas_varios_lotes: number
        }[]
      }
      calibrador_kg_por_pasada: {
        Args: never
        Returns: {
          dia: string
          kg: number
          lote: string
          pasadas: number
          productor: string
          productor_id: string
        }[]
      }
      calibrador_pasadas_con_desglose: {
        Args: { desde?: string; hasta?: string }
        Returns: {
          batch_id: number
          batch_name: string
          fecha: string
          kg_exportacion: number
          kg_industria: number
          kg_mujeres: number
          kg_no_exportacion: number
          kg_otros: number
          kg_total: number
          lote: string
        }[]
      }
      can_access_comunicaciones_campo: { Args: never; Returns: boolean }
      can_access_ventas_categoria: { Args: never; Returns: boolean }
      clase_destino: {
        Args: { clase: string; grupo_destino: string }
        Returns: string
      }
      clase_letra: { Args: { clase: string }; Returns: string }
      clasificacion_detalle_lotes: { Args: { lotes: string[] }; Returns: Json }
      clasificacion_mix_lotes: { Args: never; Returns: Json }
      clasificacion_productor_periodo: {
        Args: { desde?: string; hasta?: string }
        Returns: Json
      }
      copia_archivos_manifiesto: {
        Args: never
        Returns: {
          actualizado: string
          bytes: number
          cubo: string
          nombre: string
        }[]
      }
      copia_manifiesto: {
        Args: never
        Returns: {
          filas: number
          pk: string[]
          tabla: string
        }[]
      }
      copia_version_esquema: { Args: never; Returns: string }
      empaques_habituales: {
        Args: { nombres: string[] }
        Returns: {
          empaque: string
          nombre: string
        }[]
      }
      es_movimiento_interno_productor: {
        Args: { nombre: string }
        Returns: boolean
      }
      has_role:
        | {
            Args: {
              _role: Database["public"]["Enums"]["app_role"]
              _user_id: string
            }
            Returns: boolean
          }
        | { Args: { _role: string; _user_id: string }; Returns: boolean }
      lote_clasificacion_detalle_por_partes: {
        Args: { p_part_ids: string[] }
        Returns: Json
      }
      lote_clasificacion_productor_agg_rango: {
        Args: { p_desde: string; p_hasta: string }
        Returns: Json
      }
      normalizar_clave_producto: { Args: { nombre: string }; Returns: string }
      normalizar_nombre_productor: { Args: { nombre: string }; Returns: string }
      palets_kg_por_dia: {
        Args: never
        Returns: {
          cerrado: boolean
          dia: string
          kg_campo: number
          kg_comercial: number
          kg_egipto: number
          kg_precalibrado: number
          kg_sin_precalibrado: number
          kg_total: number
          palets: number
        }[]
      }
      productor_por_lote: {
        Args: { lotes: string[] }
        Returns: {
          fraccion: number
          lote: string
          productor: string
          productor_id: string
        }[]
      }
      productores_sin_casar: {
        Args: never
        Returns: {
          filas: number
          kg: number
          productor: string
        }[]
      }
      refrescar_clasificacion_lote_mix: { Args: never; Returns: undefined }
      restauracion_cargar: {
        Args: { filas: Json; tabla: string }
        Returns: number
      }
      restauracion_comparar: {
        Args: { tabla_pedida: string }
        Returns: {
          filas_publico: number
          filas_restauradas: number
          huella_publico: string
          huella_restaurada: string
          tabla: string
        }[]
      }
      restauracion_limpiar: { Args: never; Returns: undefined }
      restauracion_preparar: { Args: { tablas: string[] }; Returns: undefined }
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
      data_source: "manual" | "ia" | "calibrador"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
      data_source: ["manual", "ia", "calibrador"],
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
