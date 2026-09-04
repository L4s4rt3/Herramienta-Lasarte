// Shim: la implementación vive en supabase/functions/_shared/mercadonaFacturacionErp.ts
// (la usa scripts/mercadona-facturacion-erp.mjs desde Node). Aquí solo se
// re-exporta para que los tests y el frontend la importen como "@/lib/...".
export * from "../../supabase/functions/_shared/mercadonaFacturacionErp.ts";
