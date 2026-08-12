/**
 * Los palets confeccionados de un día, leídos del ERP (GSTOCK).
 *
 * POR QUÉ EXISTE. `kg_palets_brutos` era el único de los cuatro automáticos del
 * parte que seguía siendo manual: había que sacar un Excel del GSTOCK y subirlo
 * a mano. Sin ese número el DSJ no se puede calcular. Esto lo lee directamente
 * del ERP, que es de donde salía el Excel.
 *
 * LA FÓRMULA, y el detalle que la hacía fallar:
 *
 *     SUM(kilos_netos) de palets_cab del día, SIN filtrar num_cajas
 *
 * El sincronizador de trazabilidad (`sincronizar-trazabilidad-palet-erp.mjs`)
 * filtra `num_cajas > 0` porque quiere palets de verdad; el GSTOCK NO filtra.
 * Los palets a granel y los de campo van en box y tienen num_cajas = 0: el
 * 7-ago son 8 palets de 225 que valen 22.726 kg. Por eso `erp_palet` daba
 * 64.752 y el parte 87.478 — no eran fuentes contradictorias, era el filtro.
 *
 * POR QUÉ NO REPRODUCE EXACTAMENTE LOS PARTES VIEJOS (y por qué está bien).
 * El Excel es una FOTO del ERP a la hora en que se sacaba, a media tarde. Los
 * palets ficticios de granel se crean con 0 kg y se valoran más tarde: el
 * palet 398153 del 27-jul valía 0 kg en el Excel y hoy vale 18.890. Leído a la
 * mañana siguiente el dato ya está cerrado (comprobado 20-jul → 11-ago: los
 * días cerrados no tienen ningún palet sin valorar), así que este número es
 * MÁS completo que la foto, no menos. Por eso solo se usa para los partes
 * nuevos: el histórico se queda con lo que se validó en su día.
 *
 * TRAMPAS DEL ERP QUE SE RESPETAN (docs/ERP_LR_INFORMATICA.md):
 *   - Se filtra por `fecha_creacion`, la columna del índice `elaboracion`.
 *     Nunca por num_dcmto sin el prefijo completo del índice.
 *   - Hay fechas basura (2905-04-21 con −90 kg): el filtro por día exacto las
 *     deja fuera solas.
 *   - Solo SELECT. Jamás se escribe en el ERP.
 */
import { execFileSync } from "node:child_process";
import mysql from "mysql2/promise";

const EMPRESA = "gdata001";
const REGISTRO_ERP = "HKCU\\Software\\LRInformatica\\GSTOCKS";

function leerRegistro(valor) {
  const salida = execFileSync("reg", ["query", REGISTRO_ERP, "/v", valor], { encoding: "latin1" });
  const linea = salida.split(/\r?\n/).find((l) => l.trim().startsWith(valor));
  const m = linea?.match(/REG_[A-Z_]+\s{2,}(.*)$/);
  if (!m) throw new Error(`No se pudo leer ${valor} del registro del ERP`);
  return m[1].trim();
}

/**
 * Egipto y campo se reconocen por el nombre del producto, exactamente igual
 * que hace extractPaletsDetalle() con el Excel (`/EGIPTO/i` y
 * `/CAMPO|DEL CAMPO|DE CAMPO|CAMPI/i`): misma regla, otra fuente.
 */
export const SQL_PALETS_DIA = `
  SELECT ROUND(SUM(p.kilos_netos), 4) AS netos,
         ROUND(SUM(IF(ag.denominacion REGEXP 'EGIPTO', p.kilos_netos, 0)), 4) AS egipto,
         ROUND(SUM(IF(ag.denominacion REGEXP 'CAMPO|CAMPI', p.kilos_netos, 0)), 4) AS campo,
         COUNT(*) AS palets,
         SUM(p.kilos_netos = 0) AS sin_valorar,
         MAX(p.kilos_netos) AS mayor
    FROM ${EMPRESA}.palets_cab p
    LEFT JOIN ${EMPRESA}.articulo_general ag ON ag.codigo = p.articulo
   WHERE DATE(p.fecha_creacion) = ?`;

/** Abre la conexión al ERP con las credenciales que ya guarda el propio ERP. */
export async function conectarErp() {
  return mysql.createConnection({
    host: leerRegistro("Host"),
    port: Number(leerRegistro("Puerto")) || 3306,
    user: leerRegistro("Usuario"),
    password: leerRegistro("Password"),
    connectTimeout: 30000,
    dateStrings: true,
  });
}

/**
 * Palets de un día. Devuelve null si ese día no tiene ninguno (no un 0: "sin
 * datos" y "cero kilos" no son lo mismo, y el DSJ se calcularía mal).
 */
export async function paletsDelDia(conn, fecha) {
  const [filas] = await conn.query(SQL_PALETS_DIA, [fecha]);
  const f = filas?.[0];
  if (!f || Number(f.palets) === 0) return null;
  return {
    netos: Number(f.netos) || 0,
    egipto: Number(f.egipto) || 0,
    campo: Number(f.campo) || 0,
    palets: Number(f.palets) || 0,
    sinValorar: Number(f.sin_valorar) || 0,
    // Un palet fisico no pasa de ~1.000 kg: un valor grande delata una
    // regularizacion metida como palet, que es lo que descuadra el dia.
    mayor: Number(f.mayor) || 0,
  };
}
