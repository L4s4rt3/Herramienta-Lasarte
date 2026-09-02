// Shim: la implementación vive en supabase/functions/_shared/semanaIso.ts
// (compartida con las edge functions). Aquí solo se re-exporta para que el
// frontend la importe como "@/lib/semanaIso".
export * from "../../supabase/functions/_shared/semanaIso.ts";
