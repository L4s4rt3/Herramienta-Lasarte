# parsear_lotes_extra.py — lee informes del calibrador EXPORTADOS A EXCEL
# (el mismo "Totales de Calidad Clase Tamaño Por Producto" que llega en DOCX,
# pero guardado como .xlsx desde el visor del Sizer) y los deja en
# salida/pasadas-extra.json para que el motor los sume como una pasada más.
# Sirve para el lote que se olvidó enviar: se exporta, se deja en lotes-extra/ y listo.
import glob
import json
import os
import re
import openpyxl

CARPETA = "lotes-extra"
SALIDA = os.path.join("salida", "pasadas-extra.json")

def numero(v):
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).strip()
    m = re.match(r"^-?[\d.,]+", s)
    if not m:
        return None
    t = m.group(0)
    if "," in t:
        t = t.replace(".", "").replace(",", ".")
    try:
        return float(t)
    except ValueError:
        return None

def hhmmss_a_horas(t):
    m = re.match(r"^(\d+):(\d{2}):(\d{2})$", str(t or "").strip())
    if not m:
        return None
    return int(m.group(1)) + int(m.group(2)) / 60 + int(m.group(3)) / 3600

def parsear(ruta):
    wb = openpyxl.load_workbook(ruta, data_only=True)
    ws = wb.worksheets[0]
    filas = []
    for row in ws.iter_rows(values_only=True):
        filas.append([c for c in row if c is not None and str(c).strip() != ""])

    # cabecera: pares etiqueta→valor recorriendo las celdas no vacías en orden
    plano = []
    for f in filas[:30]:
        plano.extend(str(c).strip() if not hasattr(c, "isoformat") else c for c in f)
    cab = {}
    CLAVES = {"Nombre del Lote": "lote", "Fecha y Hora de Comienzo": "comienzo",
              "Tiempo Lote": "tiempoLote", "Toneladas / Hora": "toneladasHora"}
    for i, c in enumerate(plano[:-1]):
        clave = CLAVES.get(str(c).strip())
        if clave and clave not in cab:
            cab[clave] = plano[i + 1]

    fecha = None
    com = cab.get("comienzo")
    if hasattr(com, "isoformat"):
        fecha = com.date().isoformat()
    else:
        m = re.search(r"(\d{4})-(\d{2})-(\d{2})", str(com or ""))
        if m:
            fecha = m.group(0)

    # detalle: misma máquina de estados que el parser DOCX del receptor
    lineas = []
    producto = calidad = clase = None
    en_tabla = False
    for f in filas:
        vals = [str(c).strip() if not isinstance(c, (int, float)) else c for c in f]
        if not vals:
            continue
        def etiqueta(nombre):
            for i, c in enumerate(vals):
                if str(c) == nombre:
                    for c2 in vals[i + 1:]:
                        if str(c2).strip():
                            return str(c2).strip()
            return None
        e = etiqueta("Producto:")
        if e is not None:
            producto = e; en_tabla = False; continue
        e = etiqueta("Calidad:")
        if e is not None:
            calidad = e; en_tabla = False; continue
        e = etiqueta("Clase:")
        if e is not None:
            clase = e; en_tabla = False; continue
        if any(str(c) == "Tamaño" for c in vals) and any("Peso" in str(c) for c in vals):
            en_tabla = True; continue
        if not en_tabla:
            continue
        primero = str(vals[0])
        if re.match(r"^\(\d+\)", primero) and len(vals) >= 4:
            lineas.append({
                "producto": producto, "calidad": calidad, "clase": clase,
                "tamano": primero,
                "piezas": numero(vals[1]),
                "kg": numero(vals[3]),
            })
        elif numero(vals[0]) is not None:
            en_tabla = False  # fila de totales del bloque

    kg_total = sum(l["kg"] or 0 for l in lineas)
    return {
        "fichero": os.path.basename(ruta),
        "fecha": fecha,
        "lote": str(cab.get("lote") or "(sin lote)").strip(),
        "horas": hhmmss_a_horas(cab.get("tiempoLote")),
        "th": numero(cab.get("toneladasHora")),
        "kg": kg_total,
        "lineas": lineas,
    }

pasadas = []
for ruta in sorted(glob.glob(os.path.join(CARPETA, "*.xlsx"))):
    try:
        p = parsear(ruta)
        pasadas.append(p)
        print(f"  {p['fichero']}: lote «{p['lote']}» · {p['fecha']} · {len(p['lineas'])} líneas · {round(p['kg'])} kg · {p['th']} t/h")
    except Exception as e:
        print(f"  NO SE PUDO LEER {ruta}: {e}")

os.makedirs("salida", exist_ok=True)
with open(SALIDA, "w", encoding="utf-8") as f:
    json.dump(pasadas, f, ensure_ascii=False, indent=1)
print(f"{len(pasadas)} pasada(s) extra -> {SALIDA}")
