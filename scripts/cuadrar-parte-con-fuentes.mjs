/**
 * Pone en el parte diario los totales que dicen las FUENTES, no los que se
 * copiaron a mano de un Word o de un Excel.
 *
 * ─── Qué estaba mal (medido el 13-08-2026 sobre la campaña entera) ──────────
 *
 * PRODUCCIÓN. `partes_diarios.kg_produccion_calibrador` está a CERO en 138 de
 * los 227 días, con 15.048.560 kg realmente procesados. Esos días no tienen DSJ
 * calculable (sale ~100%, que es "parte sin analizar", no un descuadre). De los
 * 83 días que sí tienen valor, 80 coinciden AL KILO con el Word — o sea que no
 * es una medición aparte, es el mismo número copiado, y arrastra su mismo
 * fallo: 67 días se quedan cortos, 2.068.933 kg.
 *
 * PALETS. `kg_palets_brutos` ni siquiera cuadra con las filas de palets del
 * propio parte: 6.907.510 kg guardados contra 7.602.630 sumando sus filas, y
 * solo 39 de 83 días cuadran.
 *
 * ─── Qué palets cuentan (decisión del dueño, 13-08-2026) ────────────────────
 *
 * Los terminados y el granel SÍ; el precalibrado NO. El precalibrado es fruta
 * que se aparta y vuelve a entrar por báscula como lote nuevo: contarla al
 * salir y otra vez al entrar la duplica. Comprobado sobre los 83 días con dato:
 *
 *   solo palets terminados      →  DSJ +8,60%   (617 t sin explicar)
 *   todos sin excepción         →  DSJ −3,39%   (imposible: sale más que entra)
 *   granel sí, precalibrado no  →  DSJ  343 kg sobre 7.171.999   ← esta
 *
 * OJO al leerlo: esos 343 kg son el total de la campaña. Día a día el desvío
 * medio sigue siendo del 11,71%, porque lo que se procesa un día se paletiza
 * ese día o el siguiente. El balance cierra con el tiempo, no cada jornada.
 *
 * ─── Reglas ─────────────────────────────────────────────────────────────────
 *
 *   · Solo días CERRADOS (public.palets_dia_cerrado): mientras el ERP siga
 *     metiendo palets de ese día, su total no es definitivo. Medido: el 12-08
 *     entró un palet a las 07:00 del día siguiente.
 *   · `kg_palets_brutos` INCLUYE Egipto, porque quien lo consume ya le resta
 *     `kg_palets_egipto` (src/hooks/usePartes.ts). Cambiar eso aquí lo restaría
 *     dos veces.
 *   · Antes de escribir se vuelca el valor anterior a un CSV. Esto sobrescribe
 *     números que llevan meses en la base y tiene que poder deshacerse.
 *   · Simulación por defecto.
 *
 *   node scripts/cuadrar-parte-con-fuentes.mjs             # simulación
 *   node scripts/cuadrar-parte-con-fuentes.mjs --aplicar
 *   node scripts/cuadrar-parte-con-fuentes.mjs --solo-produccion --aplicar
 *   node scripts/cuadrar-parte-con-fuentes.mjs --solo-palets --aplicar
 */
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

try { process.loadEnvFile(path.resolve(".env")); } catch { /* entorno */ }

const APLICAR = process.argv.includes("--aplicar");
const SOLO_PRODUCCION = process.argv.includes("--solo-produccion");
const SOLO_PALETS = process.argv.includes("--solo-palets");
const TOCA_PRODUCCION = !SOLO_PALETS;
const TOCA_PALETS = !SOLO_PRODUCCION;

const num = (v) => Number(v) || 0;
const miles = (n) => Math.round(n).toLocaleString("es-ES");
const redondear = (n) => Math.round(n * 10000) / 10000;

async function traerTodo(consulta) {
  const filas = [];
  for (let desde = 0; ; desde += 1000) {
    const { data, error } = await consulta(desde, desde + 999);
    if (error) throw new Error(error.message);
    filas.push(...(data ?? []));
    if (!data || data.length < 1000) return filas;
  }
}

async function main() {
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Faltan SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY en el entorno.");
    process.exit(1);
  }
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  // ── Producción según la máquina, por día ──────────────────────────────────
  const { data: pasadas, error: errPas } = await supabase.rpc("calibrador_kg_por_pasada");
  if (errPas) throw new Error(`calibrador: ${errPas.message}`);
  const produccion = new Map();
  for (const p of pasadas ?? []) produccion.set(p.dia, (produccion.get(p.dia) ?? 0) + num(p.kg));

  // ── Palets según el ERP, por día. Se pide agregado para no bajar 42.534
  //    filas solo para sumarlas aquí.
  const { data: palets, error: errPal } = await supabase.rpc("palets_kg_por_dia");
  if (errPal) throw new Error(`palets: ${errPal.message}`);
  const porDia = new Map((palets ?? []).map((p) => [p.dia, p]));

  // ── Los partes ────────────────────────────────────────────────────────────
  const partes = await traerTodo((desde, hasta) =>
    supabase.from("partes_diarios")
      .select("id, date, kg_produccion_calibrador, kg_palets_brutos, kg_palets_egipto, kg_palets_campo")
      .order("id").range(desde, hasta));

  const cambios = [];
  let sinFuente = 0, sinCerrar = 0;
  for (const pa of partes) {
    const prodMaq = produccion.get(pa.date);
    const pal = porDia.get(pa.date);
    if (prodMaq === undefined && !pal) { sinFuente++; continue; }

    const fila = { id: pa.id, date: pa.date, antes: {}, despues: {} };

    if (TOCA_PRODUCCION && prodMaq !== undefined) {
      const nuevo = redondear(prodMaq);
      if (Math.abs(num(pa.kg_produccion_calibrador) - nuevo) > 1) {
        fila.antes.kg_produccion_calibrador = pa.kg_produccion_calibrador;
        fila.despues.kg_produccion_calibrador = nuevo;
      }
    }

    if (TOCA_PALETS && pal) {
      // Un día que el ERP todavía puede mover no es definitivo: se salta.
      if (!pal.cerrado) { sinCerrar++; }
      else {
        const brutos = redondear(num(pal.kg_sin_precalibrado));
        const egipto = redondear(num(pal.kg_egipto));
        const campo = redondear(num(pal.kg_campo));
        if (Math.abs(num(pa.kg_palets_brutos) - brutos) > 1) {
          fila.antes.kg_palets_brutos = pa.kg_palets_brutos;
          fila.despues.kg_palets_brutos = brutos;
        }
        if (Math.abs(num(pa.kg_palets_egipto) - egipto) > 1) {
          fila.antes.kg_palets_egipto = pa.kg_palets_egipto;
          fila.despues.kg_palets_egipto = egipto;
        }
        if (Math.abs(num(pa.kg_palets_campo) - campo) > 1) {
          fila.antes.kg_palets_campo = pa.kg_palets_campo;
          fila.despues.kg_palets_campo = campo;
        }
      }
    }

    if (Object.keys(fila.despues).length > 0) cambios.push(fila);
  }

  // ── Informe ───────────────────────────────────────────────────────────────
  const cuenta = (campo) => cambios.filter((c) => campo in c.despues).length;
  const sumaDelta = (campo) => cambios.reduce(
    (s, c) => s + (campo in c.despues ? c.despues[campo] - num(c.antes[campo]) : 0), 0);

  console.log(`\n${APLICAR ? "APLICANDO" : "SIMULACIÓN"}\n`);
  console.log(`Partes                     : ${miles(partes.length)}`);
  console.log(`  sin fuente para ese día  : ${miles(sinFuente)}`);
  console.log(`  días aún sin cerrar      : ${miles(sinCerrar)} (palets no tocados)\n`);
  if (TOCA_PRODUCCION) {
    console.log(`Producción del calibrador  : ${miles(cuenta("kg_produccion_calibrador"))} días  →  ${miles(sumaDelta("kg_produccion_calibrador"))} kg`);
    const aCero = cambios.filter((c) => "kg_produccion_calibrador" in c.despues && num(c.antes.kg_produccion_calibrador) === 0).length;
    console.log(`  de los cuales estaban a 0: ${miles(aCero)}`);
  }
  if (TOCA_PALETS) {
    console.log(`Palets brutos              : ${miles(cuenta("kg_palets_brutos"))} días  →  ${miles(sumaDelta("kg_palets_brutos"))} kg`);
    console.log(`Palets Egipto              : ${miles(cuenta("kg_palets_egipto"))} días  →  ${miles(sumaDelta("kg_palets_egipto"))} kg`);
    console.log(`Palets campo               : ${miles(cuenta("kg_palets_campo"))} días  →  ${miles(sumaDelta("kg_palets_campo"))} kg`);
  }
  console.log();

  if (cambios.length === 0) { console.log("Nada que cambiar.\n"); return; }

  // Copia de seguridad SIEMPRE, se aplique o no: esto sobrescribe números que
  // llevan meses en la base.
  fs.mkdirSync("outputs", { recursive: true });
  const hoy = new Date().toISOString().slice(0, 10);
  const csv = path.join("outputs", `parte-antes-de-cuadrar-${hoy}.csv`);
  const campos = ["kg_produccion_calibrador", "kg_palets_brutos", "kg_palets_egipto", "kg_palets_campo"];
  fs.writeFileSync(csv, [
    ["fecha", "campo", "antes", "despues"].join(";"),
    ...cambios.flatMap((c) => campos.filter((k) => k in c.despues)
      .map((k) => [c.date, k, c.antes[k] ?? "", c.despues[k]].join(";"))),
  ].join("\n"), "utf8");
  console.log(`Copia de los valores anteriores → ${csv}\n`);

  if (!APLICAR) { console.log("Simulación: no se ha escrito nada. Repite con --aplicar.\n"); return; }

  let escritos = 0;
  for (const c of cambios) {
    const { error } = await supabase.from("partes_diarios").update(c.despues).eq("id", c.id);
    if (error) throw new Error(`${c.date}: ${error.message}`);
    escritos++;
  }
  console.log(`Partes actualizados: ${miles(escritos)}\n`);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
