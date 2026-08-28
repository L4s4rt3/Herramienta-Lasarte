/**
 * Estima los manuales de los partes que nadie rellenó, y mantiene las
 * estimaciones vivas: el dato real las pisa y las retira, y un parte con
 * estimaciones vigentes no se queda cerrado en "Analizado".
 *
 * La lógica y sus porqués viven en lib-estimar-manuales.mjs (pura, con
 * pruebas). Esto es el cableado: qué partes tocan, de dónde sale el histórico
 * y la deducción de las fotos, y qué se escribe.
 *
 * Corre dentro del aviso diario (07:10) y el correo cuenta lo que hizo. También
 * a mano:
 *
 *   node scripts/estimar-manuales-parte.mjs             # simulación
 *   node scripts/estimar-manuales-parte.mjs --aplicar
 */
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { inventarioSinAlta } from "./lib-cierre-alta.mjs";
import {
  CINCO_DEL_PAPEL, esCandidato, estimarCampos, inventarioQueFalta, pisados, sinManuales,
} from "./lib-estimar-manuales.mjs";

try { process.loadEnvFile(path.resolve(".env")); } catch { /* entorno */ }

const GRACIA_DIAS = 2;   // el parte de anteayer: un día entero para que una persona se adelante
const VENTANA_DIAS = 45; // histórico que se mira para las medianas

const dd = (n) => String(n).padStart(2, "0");
const comoFecha = (d) => `${d.getFullYear()}-${dd(d.getMonth() + 1)}-${dd(d.getDate())}`;
const restarDias = (iso, n) => {
  const d = new Date(`${iso}T12:00:00`);
  return comoFecha(new Date(d.getFullYear(), d.getMonth(), d.getDate() - n));
};

const COLUMNAS = ["id", "date", "estado", "campos_estimados", "kg_produccion_calibrador",
  "kg_palets_brutos",
  "kg_reciclado_malla_z1_bruto", "kg_reciclado_malla_z2_bruto", "box_reciclaje_z1", "box_reciclaje_z2",
  ...CINCO_DEL_PAPEL].join(", ");

/**
 * La deducción de las fotos del ERP para un día, o null si no se puede.
 *
 * Se deduce CONTRA LOS PALETS DEL PARTE (ver inventarioQueFalta): el GSTOCK se
 * refresca solo al total del ERP, y deducir "final − cierre" sin mirar el parte
 * contaba dos veces lo que entra de madrugada (el −27%/+33% del 19/20-08).
 */
async function inventarioDeducido(supabase, fecha, kgPaletsParte) {
  const { data, error } = await supabase.from("erp_palets_foto")
    .select("tomada_a, kg_netos, palets").eq("dia", fecha).order("tomada_a");
  if (error || !data?.length) return null;
  const r = inventarioSinAlta(fecha, data);
  if (r?.estado !== "calculado") return null;
  return inventarioQueFalta({ kgFinalErp: r.kgDespues, kgCierre: r.kgCierre, kgPaletsParte });
}

/**
 * Una pasada completa: mantenimiento de las estimaciones que ya hay (retirar
 * las pisadas por datos reales, reabrir los Analizado con estimaciones) y
 * estimación de los partes candidatos.
 */
export async function estimarPartesPendientes(supabase, { hoy = comoFecha(new Date()), aplicar = false, graciaDias = GRACIA_DIAS } = {}) {
  const { data, error } = await supabase.from("partes_diarios")
    .select(COLUMNAS).gte("date", restarDias(hoy, VENTANA_DIAS)).order("date");
  if (error) throw new Error(`partes: ${error.message}`);
  const partes = data ?? [];

  const eventos = { estimados: [], recuperados: [], validadosConEstimacion: [] };

  // ── 1. Mantenimiento de lo ya estimado ────────────────────────────────────
  for (const p of partes) {
    const marcas = p.campos_estimados?.campos;
    if (!marcas || Object.keys(marcas).length === 0) continue;

    const fuera = pisados(p);
    if (fuera.length) {
      // El dato real ganó: la estimación de esos campos se retira.
      const quedan = Object.fromEntries(Object.entries(marcas).filter(([c]) => !fuera.includes(c)));
      const nuevo = Object.keys(quedan).length ? { ...p.campos_estimados, campos: quedan } : null;
      if (aplicar) {
        const { error: e } = await supabase.from("partes_diarios")
          .update({ campos_estimados: nuevo }).eq("id", p.id);
        if (e) throw new Error(`retirar estimaciones del ${p.date}: ${e.message}`);
      }
      p.campos_estimados = nuevo;
      eventos.recuperados.push({ fecha: p.date, campos: fuera });
    }

    const vigentes = Object.keys(p.campos_estimados?.campos ?? {});
    if (!vigentes.length) continue;
    // Un parte "Analizado" con estimaciones vigentes se queda como está: las
    // marcas ámbar de campos_estimados ya dicen que es provisional, y el botón
    // de la app lo reabre cuando llegue el papel (regla del dueño, 28-08-2026;
    // antes se devolvía a Borrador y el dueño veía "todo en borrador"). Un
    // "Validado" con estimaciones sí se avisa: alguien firmó un provisional.
    if (p.estado === "Validado") {
      eventos.validadosConEstimacion.push(p.date);
    }
  }

  // ── 2. Estimaciones nuevas ────────────────────────────────────────────────
  const limite = restarDias(hoy, graciaDias);
  for (const p of partes) {
    if (!esCandidato(p, limite)) continue;

    // El histórico son los partes ANTERIORES con papel metido de verdad; los
    // estimados no valen de base (una estimación no puede alimentar a otra).
    const historico = partes.filter((h) =>
      h.date < p.date && !sinManuales(h) && !(h.campos_estimados?.campos && Object.keys(h.campos_estimados.campos).length));

    const deducido = await inventarioDeducido(supabase, p.date, p.kg_palets_brutos);
    const { campos, detalle } = estimarCampos({ historico, inventarioDeducido: deducido });
    if (!Object.keys(campos).length) continue; // sin histórico no se inventa nada

    if (aplicar) {
      const { error: e } = await supabase.from("partes_diarios").update({
        ...campos,
        campos_estimados: {
          estimado_at: new Date().toISOString(),
          gracia_dias: graciaDias,
          campos: Object.fromEntries(detalle.filter((d) => d.valor != null)
            .map((d) => [d.campo, { valor: d.valor, metodo: d.metodo }])),
        },
      }).eq("id", p.id);
      if (e) throw new Error(`estimar el ${p.date}: ${e.message}`);
    }
    eventos.estimados.push({ fecha: p.date, id: p.id, detalle, diasSinPapel: graciaDias });
  }

  return eventos;
}

async function main() {
  const aplicar = process.argv.includes("--aplicar");
  const supabase = createClient(
    process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  const ev = await estimarPartesPendientes(supabase, { aplicar });
  for (const r of ev.recuperados) {
    console.log(`${r.fecha}: el dato real gano en ${r.campos.join(", ")} — estimacion retirada`);
  }
  for (const f of ev.validadosConEstimacion) console.log(`${f}: OJO, Validado con estimaciones vigentes`);
  for (const e of ev.estimados) {
    console.log(`${e.fecha}: estimado (${aplicar ? "aplicado" : "simulacion"})`);
    for (const d of e.detalle) {
      console.log(`   ${d.etiqueta}${d.valor != null ? `: ${d.valor.toLocaleString("es-ES")} kg` : ""} [${d.metodo}]`);
    }
  }
  if (!ev.estimados.length && !ev.recuperados.length) {
    console.log("Nada que estimar ni que mantener.");
  }
  if (!aplicar) console.log("\n(simulacion: repite con --aplicar)");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error("ERROR:", e.message); process.exit(1); });
}
