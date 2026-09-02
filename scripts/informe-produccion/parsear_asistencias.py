# parsear_asistencias.py — convierte el export del reloj (asistencias.xlsx) a JSON.
# Uso: python parsear_asistencias.py [ruta_xlsx]   (por defecto ./asistencias.xlsx)
import openpyxl, json, re, sys, os
from collections import defaultdict

import glob
RUTAS = sys.argv[1:] if len(sys.argv) > 1 else sorted(glob.glob("asistencias*.xlsx"), key=os.path.getmtime)
SALIDA = os.path.join("salida", "asistencias.json")

def hhmm_a_horas(v):
    if v is None: return None
    m = re.match(r"^(\d+):(\d{2})(?::(\d{2}))?$", str(v).strip())
    if not m: return None
    return round(int(m.group(1)) + int(m.group(2)) / 60, 3)

def filas_de(ruta):
    wb = openpyxl.load_workbook(ruta, data_only=True)
    ws = wb.worksheets[0]
    yield from ws.iter_rows(min_row=2, values_only=True)

# el orden es por fecha de fichero: los más nuevos pisan a los viejos en (nombre, fecha)
por_clave = {}
registros = []
for RUTA in RUTAS:
  for row in filas_de(RUTA):
    num, nombre, fecha = row[0], row[1], row[2]
    if nombre is None or fecha is None: continue
    m = re.match(r"^(\d{2})/(\d{2})/(\d{4})", str(fecha).strip())
    fecha_iso = f"{m.group(3)}-{m.group(2)}-{m.group(1)}" if m else str(fecha).strip()[:10]
    sal_ult = None
    for i in (14, 12, 10, 8, 6, 4):
        if row[i] is not None and str(row[i]).strip():
            sal_ult = str(row[i]).strip(); break
    por_clave[(str(nombre).strip(), fecha_iso)] = {
        "num": num, "nombre": str(nombre).strip(), "fecha": fecha_iso,
        "horas": hhmm_a_horas(row[15]), "entrada": str(row[3]).strip() if row[3] else None, "salida": sal_ult,
    }
registros = list(por_clave.values())

os.makedirs("salida", exist_ok=True)
with open(SALIDA, "w", encoding="utf-8") as f:
    json.dump(registros, f, ensure_ascii=False, indent=1)

por_dia = defaultdict(int)
for r in registros:
    if r["horas"] and r["horas"] >= 1.0:
        por_dia[r["fecha"]] += 1
print(f"{len(registros)} registros de {len(set(r['nombre'] for r in registros))} personas -> {SALIDA}")
for d in sorted(por_dia):
    print(f"  {d}: {por_dia[d]} personas (>=1h)")
