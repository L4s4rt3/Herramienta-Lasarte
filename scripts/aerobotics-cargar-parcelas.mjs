/**
 * Carga las parcelas de Aerobotics en campo_parcelas.
 *
 * QUÉ HACE. Lee los shapefiles descargados de Aeroview (farm_<id>_polygons.zip,
 * descomprimidos), los empareja con las parcelas de la báscula usando EL MISMO
 * criterio que scripts/aerobotics-emparejar-parcelas.mjs, y los guarda con su
 * contorno, sus hectáreas y con qué confianza se ha emparejado cada uno.
 *
 * LO QUE NUNCA HACE. Pisar un emparejamiento que ha confirmado o descartado una
 * persona. Si alguien ha dicho a mano que "COVIDESA 2" es "Los Corrales - GG /
 * Los Corrales CHI Navel Powell", volver a pasar el cargador NO lo cambia: se
 * respeta la decisión humana y solo se refrescan hectáreas, variedad y contorno.
 *
 * REPETIBLE. La clave es origen + finca del origen + nombre + hectáreas, así
 * que se puede lanzar tantas veces como se quiera: actualiza, no duplica.
 *
 * USO:
 *   node scripts/aerobotics-cargar-parcelas.mjs <carpeta-con-los-farm_*> [informes.xlsx...] [--dry]
 *
 * Los yield_measurement_report.xlsx son opcionales pero convienen: traen el
 * NOMBRE de cada finca, que a los planos les falta, y con él se emparejan
 * bastantes más parcelas. Con --dry enseña lo que haría y no escribe nada.
 */
import { createClient } from "@supabase/supabase-js";
import path from "node:path";
import { pathToFileURL } from "node:url";
import xlsx from "xlsx";
import {
  agruparCombos,
  candidatosPara,
  leerInformesCalibre,
  leerParcelasAerobotics,
  nombresDeFincaAerobotics,
  veredictoDe,
} from "./aerobotics-emparejar-parcelas.mjs";

try { process.loadEnvFile(path.resolve(".env")); } catch { /* entorno */ }

/** El veredicto del emparejador, en los estados que guarda la tabla. */
const ESTADO_POR_VEREDICTO = { clara: "clara", probable: "probable", "a mano": "pendiente" };

async function main() {
  const argumentos = process.argv.slice(2).filter((a) => a !== "--dry");
  const raiz = argumentos.find((a) => !a.endsWith(".xlsx"));
  const informes = argumentos.filter((a) => a.endsWith(".xlsx"));
  const soloEnsayo = process.argv.includes("--dry");
  if (!raiz) {
    console.error("Uso: node scripts/aerobotics-cargar-parcelas.mjs <carpeta-con-los-farm_*> [informes.xlsx...] [--dry]");
    process.exit(1);
  }

  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Faltan SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY en el entorno.");
    process.exit(1);
  }
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  const aero = leerParcelasAerobotics(raiz);
  console.log(`Aerobotics: ${aero.length} parcelas de ${new Set(aero.map((p) => p.farmId)).size} fincas · ${aero.reduce((s, p) => s + (p.hectareas ?? 0), 0).toFixed(2)} ha`);
  if (aero.length === 0) {
    console.error("No se ha encontrado ningún polygons.shp en esa carpeta.");
    process.exit(1);
  }

  // Aviso, no parada: si el contorno no cuadra con las hectáreas declaradas, se
  // guarda igual (la que manda es la declarada) pero hay que mirarlo.
  const descuadres = aero.filter((p) => p.hectareas && p.hectareasCalculadas && Math.abs(p.hectareas - p.hectareasCalculadas) / p.hectareas > 0.02);
  for (const p of descuadres) {
    console.log(`  AVISO  ${p.nombre}: declara ${p.hectareas} ha y el contorno da ${p.hectareasCalculadas}.`);
  }

  const { data: entradas, error: errorEntradas } = await supabase
    .from("entradas_bascula")
    .select("finca, parcela, agricultor, articulo, kg_entrada")
    .limit(10000);
  if (errorEntradas) throw new Error(errorEntradas.message);
  const combos = agruparCombos(entradas);
  console.log(`Báscula: ${combos.length} combinaciones finca+parcela.`);

  let nombresFinca = new Map();
  if (informes.length > 0) {
    const bloques = leerInformesCalibre(informes, xlsx);
    nombresFinca = nombresDeFincaAerobotics(aero, bloques);
    console.log(`Informes de calibre: ${bloques.length} bloques · ${nombresFinca.size} de ${new Set(aero.map((p) => p.farmId)).size} fincas se quedan con nombre.`);
  }

  const { data: existentes, error: errorExistentes } = await supabase
    .from("campo_parcelas")
    .select("id, origen, origen_finca_id, nombre, hectareas, emparejado_estado, finca, parcela");
  if (errorExistentes) throw new Error(errorExistentes.message);

  const clave = (r) => `${r.origen ?? "aerobotics"}|${r.origen_finca_id}|${r.nombre}|${r.hectareas ?? ""}`;
  const yaEstan = new Map((existentes ?? []).map((r) => [clave(r), r]));

  const filas = [];
  const cuenta = { nuevas: 0, actualizadas: 0, respetadas: 0, clara: 0, probable: 0, pendiente: 0 };

  for (const p of aero) {
    const top = candidatosPara(p, combos, 3, nombresFinca.get(p.farmId) ?? null);
    const estado = ESTADO_POR_VEREDICTO[veredictoDe(top)] ?? "pendiente";
    const propuesta = estado === "clara" || estado === "probable" ? top[0] : null;

    const fila = {
      origen: "aerobotics",
      origen_finca_id: p.farmId,
      nombre: p.nombre,
      hectareas: p.hectareas,
      cultivo: p.cultivo || null,
      variedad: p.variedad || null,
      plantacion: p.plantacion,
      patron: p.patron,
      contorno: p.anillos,
      centro_lon: p.centro?.[0] ?? null,
      centro_lat: p.centro?.[1] ?? null,
    };

    const previa = yaEstan.get(clave(fila));
    const decidida = previa && (previa.emparejado_estado === "confirmada" || previa.emparejado_estado === "descartada");

    if (decidida) {
      // Lo que dijo una persona se queda como está: solo se refresca la ficha.
      cuenta.respetadas += 1;
      filas.push({ ...fila, id: previa.id });
    } else {
      cuenta[estado] += 1;
      if (previa) cuenta.actualizadas += 1; else cuenta.nuevas += 1;
      filas.push({
        ...fila,
        ...(previa ? { id: previa.id } : {}),
        finca: propuesta?.finca ?? null,
        parcela: propuesta?.parcela ?? null,
        emparejado_estado: estado,
        emparejado_puntuacion: propuesta?.puntuacion ?? null,
        emparejado_nota: top.length > 1
          ? `Otras candidatas: ${top.slice(1).map((c) => `${c.finca} / ${c.parcela} (${c.puntuacion})`).join(" · ")}`
          : null,
      });
    }
  }

  console.log(`\nA guardar: ${cuenta.nuevas} nuevas, ${cuenta.actualizadas} actualizadas, ${cuenta.respetadas} con decisión humana intacta.`);
  console.log(`Emparejamiento propuesto: ${cuenta.clara} claras, ${cuenta.probable} probables, ${cuenta.pendiente} pendientes.`);

  // Qué cambia de verdad respecto a lo que ya estaba guardado. Importa sobre
  // todo lo que EMPEORA: una parcela que deja de ser "clara" deja de aportar
  // sus hectáreas, y la media de kilos por hectárea se mueve sin que nadie lo
  // haya pedido.
  const cambios = [];
  for (const f of filas) {
    const previa = yaEstan.get(clave(f));
    if (!previa || f.emparejado_estado === undefined) continue;
    const cambiaEstado = previa.emparejado_estado !== f.emparejado_estado;
    const cambiaPareja = (previa.finca ?? null) !== (f.finca ?? null) || (previa.parcela ?? null) !== (f.parcela ?? null);
    if (cambiaEstado || cambiaPareja) {
      cambios.push({ nombre: f.nombre, antes: previa, ahora: f, pierdeClara: previa.emparejado_estado === "clara" && f.emparejado_estado !== "clara" });
    }
  }
  if (cambios.length > 0) {
    console.log(`\nCambian ${cambios.length}:`);
    for (const c of cambios) {
      const aviso = c.pierdeClara ? "  ← DEJA DE CONTAR" : "";
      console.log(`  ${c.nombre.padEnd(26)} ${c.antes.emparejado_estado} → ${c.ahora.emparejado_estado}${aviso}`);
      console.log(`     antes: ${c.antes.finca ?? "—"} / ${c.antes.parcela ?? "—"}`);
      console.log(`     ahora: ${c.ahora.finca ?? "—"} / ${c.ahora.parcela ?? "—"}`);
    }
  }

  if (soloEnsayo) {
    console.log("\n--dry: no se ha escrito nada.");
    return;
  }

  // En tandas: onConflict sobre la clave natural, para poder repetir.
  const TANDA = 50;
  for (let i = 0; i < filas.length; i += TANDA) {
    const { error } = await supabase
      .from("campo_parcelas")
      .upsert(filas.slice(i, i + TANDA), { onConflict: "origen,origen_finca_id,nombre,hectareas" });
    if (error) throw new Error(error.message);
  }
  console.log(`\nGuardadas ${filas.length} parcelas en campo_parcelas.`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
