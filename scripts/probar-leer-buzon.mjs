/**
 * Pruebas offline del lector del buzon: el reparto de adjuntos por CONTENIDO.
 *
 * El caso que las motiva (26-08-2026): el dueño reenvio desde Outlook una
 * semana de informes del Sizer y cada adjunto llego como el CORREO ORIGINAL
 * entero (.eml sin nombre, "adjunto-1.bin"), con el .docx dentro. El lector
 * repartia por extension y los dejo todos "sin procesador". Estas pruebas
 * fijan el arreglo: detectar el correo anidado y el DOCX por su firma.
 *
 *   node scripts/probar-leer-buzon.mjs
 */
import assert from "node:assert/strict";
import { esDocx, pareceCorreo, procesarAdjuntos } from "./leer-buzon-correo.mjs";

let pasan = 0;
const comprobar = (nombre, condicion) => {
  assert.ok(condicion, nombre);
  console.log(`OK     ${nombre}`);
  pasan++;
};

// ── pareceCorreo: el reenvio de Outlook se reconoce ─────────────────────────
const emlOutlook = Buffer.from(
  "Received: from VI1PR07MB5342.eurprd07.prod.outlook.com (2603:10a6:803:ac::28)\r\n" +
  " by PA4PR07MB7165.eurprd07.prod.outlook.com with Microsoft SMTP Server\r\n" +
  "From: \"Soporte\" <soporte@lasartesat.es>\r\n" +
  "To: vadimvornic97@gmail.com\r\n" +
  "Subject: RV: Reporte de Lote\r\n\r\ncuerpo",
  "latin1");
comprobar("un .eml reenviado sin nombre se reconoce por sus cabeceras",
  pareceCorreo("application/octet-stream", "adjunto-1.bin", emlOutlook));
comprobar("el content-type message/rfc822 basta por si solo",
  pareceCorreo("message/rfc822", null, Buffer.from("x")) === true);
comprobar("la extension .eml basta por si sola",
  pareceCorreo(null, "reenvio.eml", Buffer.from("x")) === true);

// ── y lo que NO es un correo, no lo parece ──────────────────────────────────
const docxFalso = Buffer.concat([
  Buffer.from([0x50, 0x4b, 0x03, 0x04]),           // firma ZIP "PK"
  Buffer.from("xxxx word/document.xml xxxx"),      // tabla del ZIP (simplificada)
]);
comprobar("un DOCX no parece un correo", !pareceCorreo(null, "informe.docx", docxFalso));
comprobar("un CSV no parece un correo",
  !pareceCorreo("text/csv", "lotes.csv", Buffer.from("lote;kg\n26051903;100\n")));
comprobar("un 'From: ' en el CUERPO de un texto no lo convierte en correo",
  !pareceCorreo(null, "notas.txt", Buffer.from("hola\nFrom: alguien\n")));

// ── esDocx: el informe se reconoce por dentro, no por el nombre ─────────────
comprobar("un DOCX sin extension se reconoce por su firma", esDocx(docxFalso));
const zipExport = Buffer.concat([
  Buffer.from([0x50, 0x4b, 0x03, 0x04]),
  Buffer.from("xxxx lotes.csv xxxx clasificacion.csv xxxx"),
]);
comprobar("el ZIP del export SQL no pasa por DOCX", !esDocx(zipExport));
comprobar("un buffer corto no revienta", !esDocx(Buffer.from("PK")));
comprobar("algo que no es un buffer no revienta", !esDocx("no soy un buffer"));

// ── procesarAdjuntos: entra en el correo anidado y saca lo de dentro ────────
// Un .eml de verdad (construido a mano) con un adjunto "docx" dentro. El
// contenido no es un informe legible: basta ver que el lector ENTRA, lo
// intenta como informe (item.informe existe) y no lo deja "sin procesador".
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const carpetaDia = fs.mkdtempSync(path.join(os.tmpdir(), "probar-buzon-"));
const docxB64 = docxFalso.toString("base64");
const emlConDocx = Buffer.from(
  "From: \"Soporte\" <soporte@lasartesat.es>\r\n" +
  "To: vadimvornic97@gmail.com\r\n" +
  "Subject: RV: Reporte de Lote\r\n" +
  "MIME-Version: 1.0\r\n" +
  "Content-Type: multipart/mixed; boundary=\"FRONTERA\"\r\n\r\n" +
  "--FRONTERA\r\nContent-Type: text/plain\r\n\r\nreenviado\r\n" +
  "--FRONTERA\r\nContent-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document; name=\"SizeGradeQualityTotalsByProduct.docx\"\r\n" +
  "Content-Disposition: attachment; filename=\"SizeGradeQualityTotalsByProduct.docx\"\r\n" +
  "Content-Transfer-Encoding: base64\r\n\r\n" + docxB64 + "\r\n--FRONTERA--\r\n",
  "latin1");

const { adjuntos } = await procesarAdjuntos(
  [{ content: emlConDocx, filename: "adjunto-1.bin", contentType: "application/octet-stream" }],
  { aplicar: false, supabase: null, carpetaDia });
comprobar("del correo anidado sale el adjunto de dentro, no el .eml",
  adjuntos.length === 1 && /SizeGradeQualityTotalsByProduct/.test(adjuntos[0].fichero));
comprobar("y se intenta como informe (ya no queda 'sin procesador')",
  adjuntos[0].informe !== undefined);

// Un adjunto normal (sin anidar) sigue igual que siempre.
const { adjuntos: normales } = await procesarAdjuntos(
  [{ content: docxFalso, filename: "informe.docx", contentType: "application/msword" }],
  { aplicar: false, supabase: null, carpetaDia });
comprobar("un adjunto normal no cambia de comportamiento",
  normales.length === 1 && normales[0].informe !== undefined);

fs.rmSync(carpetaDia, { recursive: true, force: true });
console.log(`\nTodo correcto (${pasan} comprobaciones).`);
