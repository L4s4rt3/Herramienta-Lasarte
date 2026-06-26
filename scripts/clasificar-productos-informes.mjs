import fs from "node:fs";
import path from "node:path";
import XLSX from "xlsx";

const files = [
  ["2306", "C:/Users/luiso/Downloads/Informe 2306 PRODUCTO.xlsx"],
  ["2406", "C:/Users/luiso/Downloads/Informe 2406 PRODUCTO.xlsx"],
  ["2506", "C:/Users/luiso/Downloads/Informe 2506 PRODUCTO.xlsx"],
];

const outputPath =
  "C:/Users/luiso/OneDrive/Escritorio/Herramienta-Lasarte-main/outputs/clasificacion_productos_2306_2406_2506.csv";

function normalizar(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function clasificar(producto, empaque) {
  const p = normalizar(producto);
  const e = normalizar(empaque);
  const text = `${p} ${e}`;

  if (!p) return "Excluir";
  if (/\b(total|totales|subtotal|suma|gran total)\b/.test(text)) return "Excluir";
  if (
    /\b(muestra|prueba|podrido|podrida|punta|reciclado|egipto)\b/.test(text) ||
    /\bnada\b/.test(e) ||
    /\b(pre|precal|precalibrado|prec|precalibrada)\b/.test(text)
  ) {
    return "Excluir";
  }
  if (/\b(industria|industr)\b/.test(text)) return "Industria";
  if (/\b(granel|granelera|graneleras|bulk|rpack)\b/.test(p)) return "Graneleras";
  if (/\b(malla|malladora|mdna|mercadona|girs|girsac)\b/.test(p) || /\bd[-\s]?pack\b/.test(p)) {
    return "Mallas";
  }
  return "Mesas";
}

function csvCell(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

const byProduct = new Map();

for (const [day, file] of files) {
  const wb = XLSX.readFile(file, { cellDates: true });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], {
    header: 1,
    defval: null,
    raw: false,
  });

  for (let i = 11; i < rows.length; i += 1) {
    const row = rows[i];
    const producto = String(row[1] ?? "").trim().replace(/\s+/g, " ");
    const empaque = String(row[4] ?? "").trim().replace(/\s+/g, " ");
    const kg = Number(String(row[7] ?? "0").replace(",", ".")) || 0;
    if (!producto || !empaque || kg <= 0 || /total/i.test(producto)) continue;

    const key = `${producto}|${empaque}`;
    const item = byProduct.get(key) ?? {
      zona: clasificar(producto, empaque),
      producto,
      empaque,
      total: 0,
      d2306: 0,
      d2406: 0,
      d2506: 0,
    };

    item.total += kg;
    item[`d${day}`] += kg;
    byProduct.set(key, item);
  }
}

const rows = [...byProduct.values()].sort(
  (a, b) =>
    a.zona.localeCompare(b.zona, "es") ||
    a.producto.localeCompare(b.producto, "es") ||
    a.empaque.localeCompare(b.empaque, "es"),
);

const csv = [
  "Zona;Producto;Empaque;Kg total;Kg 2306;Kg 2406;Kg 2506",
  ...rows.map((row) =>
    [
      row.zona,
      row.producto,
      row.empaque,
      row.total.toFixed(4),
      row.d2306.toFixed(4),
      row.d2406.toFixed(4),
      row.d2506.toFixed(4),
    ]
      .map(csvCell)
      .join(";"),
  ),
].join("\r\n");

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, csv, "utf8");

const totals = rows.reduce((acc, row) => {
  acc[row.zona] = (acc[row.zona] ?? 0) + row.total;
  return acc;
}, {});

console.log(outputPath);
console.log(JSON.stringify(totals, null, 2));
