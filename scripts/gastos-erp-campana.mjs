/**
 * gastos-erp-campana.mjs — los gastos generales de la empresa, leídos del ERP.
 *
 * POR QUÉ EXISTE (16-09-2026). El beneficio neto de un lote no se puede cerrar
 * hoy: el módulo Económico → CMV tiene cinco partidas mensuales y solo una
 * cargada (suministros). Faltan PERSONAL REAL (nómina + Seguridad Social de la
 * gestoría), TRANSPORTE DE SALIDA (facturas de transporte a cliente) y
 * ESTRUCTURA (alquiler, seguros, amortizaciones, financieros, gestoría). Sin
 * ellas hay que tirar del forfait consolidado 17-18 del Departamento de Control
 * (0,1598 €/kg de almacén), que es de hace ocho años.
 *
 * Esto saca esos importes del ERP, por mes, para poder cargarlos en
 * cmv_costes_mensuales y que el neto salga del dato y no de un forfait viejo.
 *
 * HORARIO — REGLA DE VADIM (16-09-2026): de 06:00 a 15:00 el ERP es de la
 * oficina y no se le hacen consultas grandes. Este script SE NIEGA a ejecutarse
 * en esa franja salvo --forzar, porque recorre la contabilidad entera.
 *
 * SOLO LECTURA. Jamás escribe en el ERP (docs/ERP_LR_INFORMATICA.md).
 * Tampoco carga nada en Supabase: deja el Excel y la propuesta de reparto para
 * que una persona decida. Clasificar una cuenta contable no es automático.
 *
 * Uso:
 *   node scripts/gastos-erp-campana.mjs --explorar
 *       → qué bases y tablas de contabilidad hay, con sus columnas. Barato.
 *   node scripts/gastos-erp-campana.mjs --base=X --tabla=Y --fecha=col --cuenta=col --debe=col [--haber=col]
 *       → Excel outputs/Gastos_ERP_<campana>_<fecha>.xlsx con mes × cuenta y la
 *         propuesta de reparto en las cuatro partidas del CMV.
 *   Opciones: --campana=2025 (septiembre 2025 → agosto 2026), --grupos=6,7
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ExcelJS from "exceljs";
import { conectarErp } from "./lib-palets-erp.mjs";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.loadEnvFile(path.join(RAIZ, ".env"));

const arg = (nombre, defecto) => {
  const a = process.argv.find((x) => x.startsWith(`--${nombre}=`));
  return a ? a.slice(nombre.length + 3) : defecto;
};
const EXPLORAR = process.argv.includes("--explorar");
const FORZAR = process.argv.includes("--forzar");
const CAMPANA = Number(arg("campana", 2025));
const GRUPOS = arg("grupos", "6").split(",").map((s) => s.trim()).filter(Boolean);
const DESDE = `${CAMPANA}-09-01`;
const HASTA = `${CAMPANA + 1}-08-31`;

// ── Guardarraíl horario ──────────────────────────────────────────────────────
const hora = new Date().getHours();
if (hora >= 6 && hora < 15 && !FORZAR) {
  console.error(
    `\n  El ERP está en horario de oficina (son las ${String(hora).padStart(2, "0")}:xx).\n` +
    `  Regla de Vadim del 16-09-2026: de 06:00 a 15:00 no se le hacen consultas grandes.\n` +
    `  Vuelve a lanzarlo a partir de las 15:00 (o --forzar si sabes lo que haces).\n`,
  );
  process.exit(2);
}

// ── Nombres que delatan una tabla de contabilidad ────────────────────────────
const PISTAS_TABLA = ["conta", "asiento", "apunte", "diario", "mayor", "cuenta", "extracto", "saldo"];

/** Partida del CMV a la que propone llevar cada cuenta del PGC (grupo 6). */
function partidaCmv(cuenta) {
  const c = String(cuenta ?? "").trim();
  if (/^6[01]/.test(c)) return { partida: "(no cargar)", nota: "Compras: la fruta y los envases ya están en el coste del lote. Cargarlo aquí sería contarlo dos veces." };
  if (/^64/.test(c)) return { partida: "personal_real", nota: "Sueldos y Seguridad Social. Sustituye a la estimación por fichaje." };
  if (/^621/.test(c)) return { partida: "estructura", nota: "Arrendamientos y cánones." };
  if (/^622/.test(c)) return { partida: "estructura", nota: "Reparaciones y conservación." };
  if (/^623/.test(c)) return { partida: "estructura", nota: "Servicios profesionales (gestoría, auditoría)." };
  if (/^624/.test(c)) return { partida: "transporte_salida", nota: "OJO: separar transporte de VENTA del de compra (el del campo ya está en el coste del lote)." };
  if (/^625/.test(c)) return { partida: "estructura", nota: "Primas de seguros." };
  if (/^626/.test(c)) return { partida: "estructura", nota: "Servicios bancarios." };
  if (/^628/.test(c)) return { partida: "(ya cargado)", nota: "Suministros: ya están en cmv_costes_mensuales con las facturas. No duplicar." };
  if (/^62/.test(c)) return { partida: "estructura", nota: "Otros servicios exteriores." };
  if (/^63/.test(c)) return { partida: "estructura", nota: "Tributos." };
  if (/^66/.test(c)) return { partida: "estructura", nota: "Gastos financieros." };
  if (/^68/.test(c)) return { partida: "estructura", nota: "Amortizaciones." };
  if (/^65|^67|^69/.test(c)) return { partida: "otros", nota: "Revisar: puede ser extraordinario y no imputable a la campaña." };
  return { partida: "otros", nota: "Sin regla: clasificar a mano." };
}

async function explorar(conn) {
  const [bases] = await conn.query("SHOW DATABASES");
  const nombres = bases.map((b) => Object.values(b)[0]).filter((n) => !/^(information_schema|performance_schema|mysql|sys)$/i.test(n));
  console.log(`Bases en el servidor: ${nombres.join(", ")}\n`);
  for (const base of nombres) {
    const [tablas] = await conn.query(`SHOW TABLES FROM \`${base}\``);
    const candidatas = tablas.map((t) => Object.values(t)[0]).filter((t) => PISTAS_TABLA.some((p) => t.toLowerCase().includes(p)));
    if (!candidatas.length) continue;
    console.log(`=== ${base} — ${candidatas.length} tabla(s) que huelen a contabilidad`);
    for (const tabla of candidatas) {
      const [cols] = await conn.query(`SHOW COLUMNS FROM \`${base}\`.\`${tabla}\``);
      const [[{ n }]] = await conn.query(`SELECT COUNT(*) n FROM \`${base}\`.\`${tabla}\``);
      console.log(`  ${tabla}  (${n} filas)`);
      console.log(`    ${cols.map((c) => `${c.Field}:${c.Type}`).join(", ")}`);
    }
    console.log("");
  }
  console.log("Siguiente paso: --base= --tabla= --fecha= --cuenta= --debe= [--haber=]");
}

async function extraer(conn) {
  const base = arg("base"), tabla = arg("tabla");
  const colFecha = arg("fecha"), colCuenta = arg("cuenta"), colDebe = arg("debe"), colHaber = arg("haber");
  if (!base || !tabla || !colFecha || !colCuenta || !colDebe) {
    console.error("Faltan parámetros. Lanza primero --explorar y pasa --base --tabla --fecha --cuenta --debe [--haber].");
    process.exit(1);
  }
  const importe = colHaber ? `SUM(COALESCE(\`${colDebe}\`,0) - COALESCE(\`${colHaber}\`,0))` : `SUM(COALESCE(\`${colDebe}\`,0))`;
  const filtroGrupo = GRUPOS.map(() => `\`${colCuenta}\` LIKE ?`).join(" OR ");
  const sql = `
    SELECT DATE_FORMAT(\`${colFecha}\`, '%Y-%m') mes, \`${colCuenta}\` cuenta, ${importe} importe, COUNT(*) apuntes
      FROM \`${base}\`.\`${tabla}\`
     WHERE \`${colFecha}\` >= ? AND \`${colFecha}\` <= ? AND (${filtroGrupo})
     GROUP BY mes, cuenta
     ORDER BY mes, cuenta`;
  const [filas] = await conn.query(sql, [DESDE, HASTA, ...GRUPOS.map((g) => `${g}%`)]);
  console.log(`${filas.length} filas (mes × cuenta) entre ${DESDE} y ${HASTA}.`);

  const wb = new ExcelJS.Workbook();
  const det = wb.addWorksheet("Detalle mes x cuenta");
  det.columns = [
    { header: "Mes", key: "mes", width: 10 },
    { header: "Cuenta", key: "cuenta", width: 16 },
    { header: "Importe €", key: "importe", width: 14, style: { numFmt: "#,##0.00" } },
    { header: "Nº de apuntes", key: "apuntes", width: 12 },
    { header: "Partida del CMV propuesta", key: "partida", width: 22 },
    { header: "Por qué", key: "nota", width: 70 },
  ];
  const resumen = new Map();
  for (const f of filas) {
    const { partida, nota } = partidaCmv(f.cuenta);
    det.addRow({ mes: f.mes, cuenta: f.cuenta, importe: Number(f.importe) || 0, apuntes: f.apuntes, partida, nota });
    if (partida === "(no cargar)" || partida === "(ya cargado)") continue;
    const clave = `${f.mes}|${partida}`;
    resumen.set(clave, (resumen.get(clave) ?? 0) + (Number(f.importe) || 0));
  }
  det.autoFilter = { from: "A1", to: "F1" };
  det.getRow(1).font = { bold: true };

  const res = wb.addWorksheet("Propuesta para el CMV");
  res.columns = [
    { header: "Mes", key: "mes", width: 10 },
    { header: "Partida (cmv_costes_mensuales.tipo)", key: "partida", width: 30 },
    { header: "Importe €", key: "importe", width: 14, style: { numFmt: "#,##0.00" } },
  ];
  for (const [clave, imp] of [...resumen.entries()].sort()) {
    const [mes, partida] = clave.split("|");
    res.addRow({ mes, partida, importe: imp });
  }
  res.getRow(1).font = { bold: true };

  const leer = wb.addWorksheet("Cómo leer");
  leer.columns = [{ header: "Qué", key: "q", width: 34 }, { header: "Explicación", key: "e", width: 110 }];
  leer.getRow(1).font = { bold: true };
  [
    ["De dónde sale", `Base ${base}, tabla ${tabla} del ERP (solo lectura), apuntes con fecha entre ${DESDE} y ${HASTA}.`],
    ["Qué cuentas", `Las que empiezan por ${GRUPOS.join(", ")} (grupo 6 del plan contable = gastos).`],
    ["Importe", colHaber ? "Debe − Haber, para que una rectificación reste." : "Suma del debe."],
    ["(no cargar)", "Compras de los grupos 60 y 61: la fruta y los envases ya están dentro del coste del lote. Cargarlas otra vez sería contar el mismo euro dos veces."],
    ["(ya cargado)", "Cuenta 628 suministros: ya están en la herramienta factura a factura."],
    ["transporte_salida", "La 624 mezcla el transporte de compra (campo → almacén, ya está en el coste del lote) con el de venta. Hay que separarlos antes de cargar."],
    ["Esto NO se carga solo", "El Excel es una propuesta. Quien decida a qué partida va cada cuenta es una persona."],
  ].forEach(([q, e]) => leer.addRow({ q, e }));

  const salida = path.join(RAIZ, "outputs", `Gastos_ERP_${CAMPANA}-${String(CAMPANA + 1).slice(2)}_${new Date().toISOString().slice(0, 10)}.xlsx`);
  fs.mkdirSync(path.dirname(salida), { recursive: true });
  await wb.xlsx.writeFile(salida);
  console.log(`\nExcel: ${salida}`);

  const porPartida = new Map();
  for (const [clave, imp] of resumen) {
    const partida = clave.split("|")[1];
    porPartida.set(partida, (porPartida.get(partida) ?? 0) + imp);
  }
  console.log("\nTotal de la campaña por partida:");
  for (const [p, imp] of [...porPartida.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${p.padEnd(20)} ${imp.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`);
  }
}

let conexion;
try {
  conexion = await conectarErp({ maxSegundos: 120 });
  if (EXPLORAR) await explorar(conexion);
  else await extraer(conexion);
} catch (e) {
  console.error(`Error: ${e.message}`);
  process.exitCode = 1;
} finally {
  await conexion?.end();
}
