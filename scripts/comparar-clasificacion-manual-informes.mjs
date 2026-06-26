import XLSX from "xlsx";

const files = [
  ["1506", "C:/Users/luiso/Downloads/Informe 1506 producto.xlsx"],
  ["1606", "C:/Users/luiso/Downloads/Informe 1606 producto.xlsx"],
];

function normalizar(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function numero(value) {
  return Number(String(value ?? "").replace(/[$,]/g, "")) || 0;
}

function clasificar(producto, empaque) {
  const p = normalizar(producto);
  const e = normalizar(empaque);
  const text = `${p} ${e}`;
  if (
    /\b(muestra|prueba|podrido|podrida|punta|reciclado|egipto)\b/.test(text) ||
    /\bnada\b/.test(e) ||
    /\b(citrica|citricas|citrico|citricos|citrus|cit)\b/.test(text) ||
    /\b(pre|precal|precalibrado|prec|precalibrada)\b/.test(text)
  ) return "Excluir";
  if (/\b(industria|industr)\b/.test(text)) return "Industria";
  if (/\b(granel|granelera|graneleras|bulk|rpack)\b/.test(p)) return "Graneleras";
  if (/\b(malla|malladora|mdna|mercadona|girs|girsac)\b/.test(p) || /\bd[-\s]?pack\b/.test(p)) {
    return "Mallas";
  }
  return "Mesas";
}

function leerManual(rows) {
  const manual = {};
  for (const row of rows) {
    for (let col = 0; col < row.length - 1; col += 1) {
      const label = normalizar(row[col]);
      const value = numero(row[col + 1]);
      if (!value) continue;
      if (label === "granel") manual["Graneleras"] = value;
      if (label === "mallas") manual.Mallas = value;
      if (label === "envasado") manual["Mesas"] = value;
      if (label === "industria") manual.Industria = value;
    }
  }
  return manual;
}

for (const [day, file] of files) {
  const wb = XLSX.readFile(file, { cellFormula: true });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], {
    header: 1,
    defval: null,
    raw: false,
  });
  const auto = {};
  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i];
    const producto = row[0];
    const empaque = row[1];
    const kg = numero(row[2]);
    if (!producto || kg <= 0) continue;
    const zona = clasificar(producto, empaque);
    auto[zona] = (auto[zona] ?? 0) + kg;
  }
  const manual = leerManual(rows);
  console.log(`\n${day}`);
  for (const zona of ["Graneleras", "Mallas", "Mesas", "Industria"]) {
    const a = auto[zona] ?? 0;
    const m = manual[zona] ?? 0;
    console.log(`${zona}: auto=${a.toFixed(2)} manual=${m.toFixed(2)} dif=${(a - m).toFixed(2)}`);
  }
}
