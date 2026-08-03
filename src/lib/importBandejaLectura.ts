/**
 * importBandejaLectura.ts — lectura en cliente de los archivos soltados en la
 * Bandeja de importación (/importar). Separado de la página para poder
 * testear la lectura sin montar componentes: cada Excel se lee UNA sola vez
 * con la receta canónica que espera clasificarArchivoBandeja (ver el jsdoc de
 * `EntradaBandeja` en src/lib/importBandeja.ts) y el resultado (grids por
 * hoja) se reutiliza para clasificar Y para el payload de cada parser — nunca
 * se reparsea el mismo archivo dos veces.
 */
import * as XLSX from "xlsx";
import type { EntradaBandeja } from "@/lib/importBandeja";

/**
 * Lee un lote de archivos con la receta canónica de la bandeja: workbook con
 * `cellDates:true`, TODAS las hojas a grids con `sheet_to_json(header:1,
 * raw:true, defval:null)`. Si un archivo no se puede leer como Excel (formato
 * ajeno, .doc/.docx/.txt, corrupto...) su entrada queda con `sheets: null` —
 * clasificarArchivoBandeja ya sabe reportarlo como "no-soportado" en vez de
 * tumbar el resto del lote.
 */
export async function leerArchivosBandeja(
  files: File[],
  anio: number,
  onProgress?: (leidos: number, total: number) => void,
): Promise<EntradaBandeja[]> {
  const entradas: EntradaBandeja[] = [];
  for (let i = 0; i < files.length; i += 1) {
    onProgress?.(i, files.length);
    const file = files[i];
    entradas.push({ fileName: file.name, sheets: await leerUnArchivo(file), anio });
  }
  onProgress?.(files.length, files.length);
  return entradas;
}

async function leerUnArchivo(file: File): Promise<Record<string, unknown[][]> | null> {
  try {
    const data = await file.arrayBuffer();
    const workbook = XLSX.read(data, { type: "array", cellDates: true });
    const sheets: Record<string, unknown[][]> = {};
    for (const sheetName of workbook.SheetNames) {
      sheets[sheetName] = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
        header: 1,
        raw: true,
        defval: null,
      }) as unknown[][];
    }
    return sheets;
  } catch {
    return null;
  }
}
