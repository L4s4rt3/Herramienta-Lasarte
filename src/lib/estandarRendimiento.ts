// Re-export del módulo compartido (frontend, edge y scripts leen la misma
// implementación). La lógica vive en supabase/functions/_shared/estandarRendimiento.ts.
export * from "../../supabase/functions/_shared/estandarRendimiento.ts";
