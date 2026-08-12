/**
 * Reconocimiento SOLO LECTURA del SQL Server del calibrador (Compac Sizer).
 *
 * Autorizado por el dueño el 11-08-2026, con la condición de que sea solo
 * lectura. Este script no ejecuta más que SELECT sobre catálogos del sistema y
 * unas pocas filas de muestra. No crea, no modifica, no borra.
 *
 * POR QUÉ. El informe que llega por correo es una vista sobre esta base de
 * datos. Leyéndola se puede pedir el de cualquier lote cuando haga falta, y
 * sobre todo recuperar el HISTÓRICO de la campaña, que por correo no va a
 * llegar nunca porque solo capturamos lo que se envíe de ahora en adelante.
 *
 * CREDENCIALES. Van en el .env (que está en .gitignore), nunca en el código ni
 * en el chat:
 *
 *   SIZER_HOST=192.168.1.209
 *   SIZER_INSTANCIA=COMPAC        (opcional, si la instancia tiene nombre)
 *   SIZER_PUERTO=1433             (opcional)
 *   SIZER_BD=nombre_de_la_base
 *   SIZER_USUARIO=...
 *   SIZER_PASSWORD=...
 *
 * Se sacan del propio visor: Configuración → pestaña "Máquinas Sizer".
 *
 *   node scripts/explorar-sizer-sql.mjs
 */
import path from "node:path";
import sql from "mssql";

try { process.loadEnvFile(path.resolve(".env")); } catch { /* variables de entorno */ }

const falta = ["SIZER_HOST", "SIZER_USUARIO", "SIZER_PASSWORD"].filter((k) => !process.env[k]);
if (falta.length) {
  console.error(`Faltan en el .env: ${falta.join(", ")}`);
  console.error("Se sacan del visor del Sizer: Configuracion -> pestaña 'Maquinas Sizer'.");
  process.exit(1);
}

const config = {
  server: process.env.SIZER_HOST,
  port: process.env.SIZER_PUERTO ? Number(process.env.SIZER_PUERTO) : 1433,
  database: process.env.SIZER_BD || undefined,
  user: process.env.SIZER_USUARIO,
  password: process.env.SIZER_PASSWORD,
  options: {
    // El SQL Server del calibrador es antiguo y sin certificado de confianza.
    encrypt: false,
    trustServerCertificate: true,
    instanceName: process.env.SIZER_INSTANCIA || undefined,
    connectTimeout: 15000,
    requestTimeout: 60000,
    readOnlyIntent: true,
  },
};

const pool = await sql.connect(config);
console.log("Conectado.\n");

const uno = async (q) => (await pool.request().query(q)).recordset;

const [v] = await uno("SELECT @@VERSION AS v");
console.log(v.v.split("\n")[0]);

console.log("\n=== BASES DE DATOS ===");
console.table(await uno(`
  SELECT name AS bd,
         CAST(SUM(size) * 8.0 / 1024 AS DECIMAL(10,0)) AS mb
    FROM sys.master_files
   WHERE database_id > 4
   GROUP BY name
   ORDER BY mb DESC`).catch(() => uno("SELECT name AS bd FROM sys.databases WHERE database_id > 4")));

const bd = process.env.SIZER_BD;
if (!bd) {
  console.log("\nSin SIZER_BD en el .env: elige una de las de arriba y vuelve a lanzarlo.");
  await pool.close();
  process.exit(0);
}

console.log(`\n=== TABLAS MAS GRANDES DE ${bd} ===`);
console.table(await uno(`
  SELECT TOP 25 t.name AS tabla, SUM(p.rows) AS filas
    FROM sys.tables t
    JOIN sys.partitions p ON p.object_id = t.object_id AND p.index_id IN (0, 1)
   GROUP BY t.name
   ORDER BY filas DESC`));

console.log("\n=== TABLAS QUE SUENAN A LOTE / CLASIFICACION ===");
console.table(await uno(`
  SELECT t.name AS tabla, SUM(p.rows) AS filas
    FROM sys.tables t
    JOIN sys.partitions p ON p.object_id = t.object_id AND p.index_id IN (0, 1)
   WHERE t.name LIKE '%atch%' OR t.name LIKE '%ot%' OR t.name LIKE '%rade%'
      OR t.name LIKE '%ize%' OR t.name LIKE '%ualit%' OR t.name LIKE '%un%'
   GROUP BY t.name
   HAVING SUM(p.rows) > 0
   ORDER BY filas DESC`));

await pool.close();
console.log("\nListo. Solo se han hecho consultas de lectura.");
