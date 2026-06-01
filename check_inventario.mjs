import { createClient } from "@supabase/supabase-js";
import "dotenv/config";

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_ANON_KEY
);

const USER_ID = "TU_USER_ID_AQUI"; // Reemplazar con tu user_id

async function check() {
  console.log("=== Verificando inventario días 26-27 mayo ===\n");

  // Buscar parte del 26 de mayo
  const { data: parte26, error: err26 } = await supabase
    .from("partes_diarios")
    .select("id, date, kg_inventario_sin_alta, kg_inventario_anterior_sin_alta, estado")
    .eq("user_id", USER_ID)
    .eq("date", "2026-05-26")
    .maybeSingle();

  if (err26) {
    console.error("Error buscando parte 26 mayo:", err26);
    return;
  }

  console.log("Parte 26 mayo:", parte26);
  console.log("  kg_inventario_sin_alta:", parte26?.kg_inventario_sin_alta);
  console.log("  kg_inventario_anterior_sin_alta:", parte26?.kg_inventario_anterior_sin_alta);

  // Buscar parte del 27 de mayo
  const { data: parte27, error: err27 } = await supabase
    .from("partes_diarios")
    .select("id, date, kg_inventario_sin_alta, kg_inventario_anterior_sin_alta, estado")
    .eq("user_id", USER_ID)
    .eq("date", "2026-05-27")
    .maybeSingle();

  if (err27) {
    console.error("Error buscando parte 27 mayo:", err27);
    return;
  }

  console.log("\nParte 27 mayo:", parte27);
  console.log("  kg_inventario_sin_alta:", parte27?.kg_inventario_sin_alta);
  console.log("  kg_inventario_anterior_sin_alta:", parte27?.kg_inventario_anterior_sin_alta);

  // Verificar lógica
  console.log("\n=== Diagnóstico ===");
  if (!parte26) {
    console.log("❌ No existe parte del 26 de mayo");
  } else if (Number(parte26.kg_inventario_sin_alta) === 0) {
    console.log("⚠️  Parte del 26 tiene kg_inventario_sin_alta = 0");
    console.log("   Por eso el parte del 27 no copia el inventario anterior");
  } else if (parte27 && Number(parte27.kg_inventario_anterior_sin_alta) === 0) {
    console.log("❌ Parte del 27 tiene kg_inventario_anterior_sin_alta = 0");
    console.log("   Debería haber copiado:", parte26.kg_inventario_sin_alta);
  } else if (parte27 && Number(parte27.kg_inventario_anterior_sin_alta) === Number(parte26.kg_inventario_sin_alta)) {
    console.log("✅ Inventario copiado correctamente");
  }

  // Buscar el último parte antes del 27
  const { data: prevParte } = await supabase
    .from("partes_diarios")
    .select("id, date, kg_inventario_sin_alta")
    .eq("user_id", USER_ID)
    .lt("date", "2026-05-27")
    .order("date", { ascending: false })
    .limit(1)
    .maybeSingle();

  console.log("\nÚltimo parte antes del 27:", prevParte);
}

check().catch(console.error);
