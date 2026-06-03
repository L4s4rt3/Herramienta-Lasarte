export type AttendanceWorker = {
  id: string;
  nombre: string;
};

export type AttendanceImportRecord = {
  user_id: string;
  date: string;
  trabajador_id: string;
  presente: boolean;
};

export type WeeklyAttendanceDay = {
  date: string;
  names: string[];
};

const MONTHS: Record<string, number> = {
  enero: 1,
  ene: 1,
  febrero: 2,
  feb: 2,
  marzo: 3,
  mar: 3,
  abril: 4,
  abr: 4,
  mayo: 5,
  may: 5,
  junio: 6,
  jun: 6,
  julio: 7,
  jul: 7,
  agosto: 8,
  ago: 8,
  septiembre: 9,
  setiembre: 9,
  sep: 9,
  sept: 9,
  octubre: 10,
  oct: 10,
  noviembre: 11,
  nov: 11,
  diciembre: 12,
  dic: 12,
};

function pad2(value: number) {
  return String(value).padStart(2, "0");
}

function ymd(year: number, month: number, day: number) {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

export function cleanAttendanceName(value: string) {
  const corruptMap: Record<string, string> = {
    "\u01ed": "A",
    "\u01ec": "A",
    "\u01f8": "E",
    "\u01f9": "E",
    "\u01d0": "I",
    "\u01cf": "I",
  };
  let result = value;
  for (const [from, to] of Object.entries(corruptMap)) result = result.split(from).join(to);
  return result
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[,\u00ad]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

function wordSet(value: string) {
  return cleanAttendanceName(value).split(" ").filter((word) => word.length >= 2).sort();
}

function wordsMatch(a: string, b: string) {
  if (a === b || a.includes(b) || b.includes(a)) return true;
  let prefixLen = 0;
  const minLen = Math.min(a.length, b.length);
  for (let i = 0; i < minLen; i++) {
    if (a[i] === b[i]) prefixLen++;
    else break;
  }
  return prefixLen >= 4;
}

export function matchAttendanceName(excelName: string, dbName: string) {
  const excelWords = wordSet(excelName);
  const dbWords = wordSet(dbName);
  if (!excelWords.length || !dbWords.length) return false;

  let hits = 0;
  for (const dbWord of dbWords) {
    if (excelWords.some((excelWord) => wordsMatch(excelWord, dbWord))) hits++;
  }
  const score = hits / dbWords.length;
  const neededFromExcel = Math.min(excelWords.length, 2) / Math.max(excelWords.length, 1);
  return score >= Math.max(0.5, neededFromExcel);
}

export function parseAttendanceDate(value: unknown, defaultYear = new Date().getFullYear()) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return ymd(value.getFullYear(), value.getMonth() + 1, value.getDate());
  }

  if (typeof value === "number" && value > 20000 && value < 60000) {
    const date = new Date(Date.UTC(1899, 11, 30 + Math.floor(value)));
    return ymd(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
  }

  const raw = String(value ?? "").trim();
  if (!raw) return null;

  const iso = raw.match(/\b(20\d{2}|19\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/);
  if (iso) return ymd(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  const numeric = raw.match(/\b(\d{1,2})[-/.](\d{1,2})(?:[-/.](\d{2,4}))?\b/);
  if (numeric) {
    const day = Number(numeric[1]);
    const month = Number(numeric[2]);
    const yearText = numeric[3];
    const year = yearText ? Number(yearText.length === 2 ? `20${yearText}` : yearText) : defaultYear;
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) return ymd(year, month, day);
  }

  const normalized = raw
    .toLocaleLowerCase("es")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  const monthMatch = normalized.match(/\b(\d{1,2})\s*(?:de\s*)?([a-z]+)(?:\s*(?:de\s*)?(\d{2,4}))?\b/);
  if (monthMatch) {
    const day = Number(monthMatch[1]);
    const month = MONTHS[monthMatch[2]];
    const yearText = monthMatch[3];
    const year = yearText ? Number(yearText.length === 2 ? `20${yearText}` : yearText) : defaultYear;
    if (day >= 1 && day <= 31 && month) return ymd(year, month, day);
  }

  return null;
}

function findNameColumn(row: unknown[]) {
  for (let i = 0; i < row.length; i++) {
    const value = cleanAttendanceName(String(row[i] ?? ""));
    if (/\b(NOMBRE|TRABAJADOR|OPERARIO|EMPLEADO|PRODUCTOR)\b/.test(value)) return i;
  }
  return null;
}

function findDateHeaderColumn(row: unknown[]) {
  for (let i = 0; i < row.length; i++) {
    const value = cleanAttendanceName(String(row[i] ?? ""));
    if (/\b(FECHA|DIA)\b/.test(value)) return i;
  }
  return null;
}

function isProbablyName(value: unknown) {
  const text = String(value ?? "").trim();
  const clean = cleanAttendanceName(text);
  if (clean.length < 3) return false;
  if (parseAttendanceDate(value)) return false;
  if (/^(X|SI|NO|OK|PRESENTE|AUSENTE|FALTA|BAJA|TRUE|FALSE|1|0)$/.test(clean)) return false;
  if (/\b(FECHA|DIA|NOMBRE|TRABAJADOR|TOTAL|PRESENTES|AUSENTES|HORARIO|ENTRADA|SALIDA)\b/.test(clean)) return false;
  return /[A-Z]/.test(clean);
}

function isPresentMarker(value: unknown) {
  if (value === null || value === undefined || value === "") return false;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value > 0;

  const clean = cleanAttendanceName(String(value));
  if (!clean) return false;
  if (/^(NO|N|AUSENTE|FALTA|BAJA|VACACIONES|0|FALSE)$/.test(clean)) return false;
  return true;
}

function addName(dayMap: Map<string, Set<string>>, date: string, name: string) {
  const clean = String(name ?? "").trim();
  if (!clean) return;
  if (!dayMap.has(date)) dayMap.set(date, new Set());
  dayMap.get(date)?.add(clean);
}

function mapToWeeklyDays(dayMap: Map<string, Set<string>>) {
  return [...dayMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, names]) => ({ date, names: [...names] }));
}

export function extractDailyAttendanceNames(rows: unknown[][]) {
  const header = rows[0] ?? [];
  const colIdx = findNameColumn(header);
  if (colIdx === null) return [];

  const names: string[] = [];
  for (let i = 1; i < rows.length; i++) {
    const nombre = String(rows[i]?.[colIdx] ?? "").trim();
    if (isProbablyName(nombre) && !names.includes(nombre)) names.push(nombre);
  }
  return names;
}

export function extractWeeklyAttendance(rows: unknown[][], defaultYear = new Date().getFullYear()): WeeklyAttendanceDay[] {
  const dayMap = new Map<string, Set<string>>();

  for (let r = 0; r < Math.min(rows.length, 40); r++) {
    const row = rows[r] ?? [];
    const nameCol = findNameColumn(row);
    if (nameCol === null) continue;

    const dateCols = row
      .map((cell, index) => ({ index, date: parseAttendanceDate(cell, defaultYear) }))
      .filter((item) => item.date && item.index !== nameCol) as Array<{ index: number; date: string }>;

    if (dateCols.length >= 2) {
      for (let i = r + 1; i < rows.length; i++) {
        const name = rows[i]?.[nameCol];
        if (!isProbablyName(name)) continue;
        for (const { index, date } of dateCols) {
          if (isPresentMarker(rows[i]?.[index])) addName(dayMap, date, String(name));
        }
      }
      const result = mapToWeeklyDays(dayMap);
      if (result.length > 0) return result;
    }

    const dateCol = findDateHeaderColumn(row);
    if (dateCol !== null && dateCol !== nameCol) {
      for (let i = r + 1; i < rows.length; i++) {
        const date = parseAttendanceDate(rows[i]?.[dateCol], defaultYear);
        const name = rows[i]?.[nameCol];
        if (date && isProbablyName(name)) addName(dayMap, date, String(name));
      }
      const result = mapToWeeklyDays(dayMap);
      if (result.length > 0) return result;
    }
  }

  for (let r = 0; r < rows.length; r++) {
    for (let c = 0; c < (rows[r]?.length ?? 0); c++) {
      const date = parseAttendanceDate(rows[r]?.[c], defaultYear);
      if (!date) continue;

      let blankStreak = 0;
      for (let i = r + 1; i < rows.length && blankStreak < 6; i++) {
        if (parseAttendanceDate(rows[i]?.[c], defaultYear)) break;

        const sameColumn = rows[i]?.[c];
        const nextColumn = rows[i]?.[c + 1];
        const name = isProbablyName(sameColumn) ? sameColumn : isProbablyName(nextColumn) ? nextColumn : null;
        if (name) {
          addName(dayMap, date, String(name));
          blankStreak = 0;
        } else {
          blankStreak++;
        }
      }
    }
  }

  return mapToWeeklyDays(dayMap);
}

export function buildAttendanceRecords(
  names: string[],
  workers: AttendanceWorker[],
  userId: string,
  date: string,
): AttendanceImportRecord[] {
  return workers.map((worker) => ({
    user_id: userId,
    date,
    trabajador_id: worker.id,
    presente: names.some((name) => matchAttendanceName(name, worker.nombre)),
  }));
}
