# Preview Fix + Report Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix Excel viewer for palet files and redesign Reporte Ejecutivo with tables instead of Markdown

**Architecture:** Two independent tasks: (1) modify `ExcelViewerDialog.tsx` to be more lenient in parsing and add 5th parse attempt, (2) rewrite `ReporteOperativo.tsx` to use shadcn Table components while keeping copy/download/search features.

**Tech Stack:** React 18, TypeScript, shadcn/ui Table, xlsx.js, Vite

---

### Task 1: Fix ExcelViewerDialog parsing for palet files

**Files:**
- Modify: `src/components/ExcelViewerDialog.tsx`

- [ ] **Step 1: Relax isValidContent to accept sheets with any valid text**

Replace the `isValidContent` function. Current logic: requires `< 50%` control chars. New logic: accept if ANY cell has readable text.

Modify `src/components/ExcelViewerDialog.tsx`:

```tsx
// Función para verificar si el contenido parseado es válido
const isValidContent = (sheets: SheetData[]): boolean => {
  if (sheets.length === 0) return false;
  
  // Verificar que al menos una hoja tenga ALGUNA celda con texto legible
  for (const sheet of sheets) {
    // Revisar headers
    for (const h of sheet.headers) {
      if (h && h.trim().length > 0) return true;
    }
    // Revisar celdas de datos
    for (const row of sheet.rows) {
      for (const cell of row) {
        if (cell && cell.trim().length > 0) return true;
      }
    }
  }
  return false;
};
```

- [ ] **Step 2: Remove cleanContent function (no longer needed with relaxed validation)**

Delete the `cleanContent` function and its usage in `parseWorkbook`. Replace `parseWorkbook` to use direct formatting without cleanup:

```tsx
// Función para parsear el workbook
const parseWorkbook = (wb: XLSX.WorkBook): SheetData[] => {
  return wb.SheetNames.map((name) => {
    const ws = wb.Sheets[name];
    const json = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, defval: "", raw: false });
    const headers = json.length > 0 ? json[0].map((h) => formatCell(h)) : [];
    const rows = json.slice(1).map((row) => row.map((c) => formatCell(c)));
    return { name, headers, rows };
  });
};
```

- [ ] **Step 3: Add 5th parse attempt with dense: true**

After the 4th attempt, add:

```tsx
// Intento 5: Último recurso con dense: true para hojas con muchas celdas vacías
if (!isValidContent(parsed)) {
  console.log("Intento 5: dense mode...");
  try {
    const wb = XLSX.read(bytes, { type: "array", dense: true, cellDates: true, raw: true });
    const denseParsed = parseWorkbook(wb);
    
    if (isValidContent(denseParsed)) {
      parsed = denseParsed;
      console.log("Intento 5 exitoso: dense mode funcionó");
    }
  } catch (e) {
    console.warn("Error en quinto intento de parseo:", e);
  }
}
```

- [ ] **Step 4: Improve error message to include file info**

Replace the error throw at the end of loadFile:

```tsx
throw new Error(
  `No se pudo parsear "${archivo.file_name || "archivo"}" ` +
  `(${formatSize(archivo.file_size || null)}). ` +
  `El archivo puede estar corrupto o en un formato no soportado. ` +
  `Si el problema persiste, descarga el archivo y verifica que sea un Excel válido.`
);
```

- [ ] **Step 5: Verify the full file compiles**

Run: `npx tsc --noEmit`
Expected: No errors

---

### Task 2: Redesign ReporteOperativo with tables

**Files:**
- Modify: `src/components/ReporteOperativo.tsx`
- No new files needed

- [ ] **Step 1: Replace Markdown renderer with structured table components**

Completely rewrite `ReporteOperativo.tsx`. Remove `mdToHtml()`. Import `Table, TableBody, TableCell, TableHead, TableHeader, TableRow` from shadcn/ui. Import `Card, CardContent, CardHeader, CardTitle`. Keep existing imports for buttons, search, badges.

New structure:

```tsx
import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import { Copy, Download, FileText, Search } from "lucide-react";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import type { AnalisisDia } from "@/lib/analisis";
import { generarReporteOperativo, buscarLoteContexto } from "@/lib/reporteOperativo";
import { formatKg as fmtKg, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
```

- [ ] **Step 2: Add helper functions for display**

```tsx
function gKg(v: number): string {
  if (v >= 1000) return (v / 1000).toFixed(1).replace(".", ",") + " t";
  return Math.round(v).toLocaleString("es-ES") + " kg";
}

function gPct(v: number): string {
  return v.toFixed(1).replace(".", ",") + "%";
}
```

- [ ] **Step 3: Create section components**

Add these components before the main export:

```tsx
function SeccionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 mb-3 mt-6 first:mt-0">
      <div className="h-px flex-1 bg-border" />
      <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground px-2">
        {children}
      </span>
      <div className="h-px flex-1 bg-border" />
    </div>
  );
}

function ResumenEjecutivo({ kpis }: { kpis: AnalisisDia["kpis"] }) {
  const items = [
    { label: "Producción", value: gKg(kpis.kg_calibrador), sub: `${kpis.n_lotes} lotes · ${kpis.n_productores} productores` },
    { label: "% Exportación", value: gPct(kpis.pct_exportacion), sub: gKg(kpis.kg_exportacion) },
    { label: "Eficiencia T/h", value: kpis.tph_promedio ? `${kpis.tph_promedio.toFixed(1)} T/h` : "—", sub: kpis.tph_min && kpis.tph_max ? `min ${kpis.tph_min} · max ${kpis.tph_max}` : undefined },
    { label: "Top calibre", value: kpis.top_calibre ?? "—", sub: kpis.top_calibre ? `${gPct(kpis.top_calibre_pct)} del total` : undefined },
    { label: "Stock cámara", value: gKg(kpis.kg_camara), sub: `${kpis.n_palets} palets` },
  ];
  return (
    <>
      <SeccionHeader>Resumen Ejecutivo</SeccionHeader>
      <div className="grid gap-3 grid-cols-2 md:grid-cols-3 xl:grid-cols-5">
        {items.map((item) => (
          <Card key={item.label} className="border-l-4 border-l-primary">
            <CardContent className="p-4">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{item.label}</p>
              <p className="mt-1 text-2xl font-bold tabular-nums truncate">{item.value}</p>
              {item.sub && <p className="text-xs text-muted-foreground mt-0.5">{item.sub}</p>}
            </CardContent>
          </Card>
        ))}
      </div>
    </>
  );
}
```

```tsx
function TablaProductores({ productores }: { productores: AnalisisDia["productores"] }) {
  if (productores.length === 0) return null;
  return (
    <>
      <SeccionHeader>Recepción y Lotes</SeccionHeader>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Productor</TableHead>
                <TableHead className="text-right">Kg Total</TableHead>
                <TableHead className="text-right">Lotes</TableHead>
                <TableHead className="text-right">T/h Medio</TableHead>
                <TableHead className="text-right">Peso Fruta</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {productores.map((p) => (
                <TableRow key={p.productor}>
                  <TableCell className="text-xs font-medium">{p.productor}</TableCell>
                  <TableCell className="text-right tabular-nums text-xs">{gKg(p.kg_total)}</TableCell>
                  <TableCell className="text-right tabular-nums text-xs text-muted-foreground">{p.n_lotes}</TableCell>
                  <TableCell className="text-right text-xs">
                    {p.tph_avg ? (
                      <span className={cn("tabular-nums font-semibold",
                        p.tph_avg >= 16 ? "text-success" : p.tph_avg >= 12 ? "text-warning" : "text-destructive"
                      )}>{p.tph_avg.toFixed(1)} T/h</span>
                    ) : "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-xs text-muted-foreground">
                    {p.peso_fruta_avg_g ? `${p.peso_fruta_avg_g.toFixed(0)} g` : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}
```

```tsx
function TablaProductos({ productos }: { productos: AnalisisDia["top_productos"] }) {
  if (productos.length === 0) return null;
  return (
    <>
      <SeccionHeader>Producción y Empaque</SeccionHeader>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>#</TableHead>
                <TableHead>Producto</TableHead>
                <TableHead className="text-right">Kg</TableHead>
                <TableHead className="text-right">Empaques</TableHead>
                <TableHead>Destino</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {productos.map((p, i) => (
                <TableRow key={p.producto}>
                  <TableCell className="text-xs text-muted-foreground">{i + 1}</TableCell>
                  <TableCell className="text-xs font-medium">{p.producto}</TableCell>
                  <TableCell className="text-right tabular-nums text-xs">{gKg(p.kg)}</TableCell>
                  <TableCell className="text-right tabular-nums text-xs">{formatNumber(p.n_empaques)}</TableCell>
                  <TableCell className="text-xs">{p.grupo_destino ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}
```

```tsx
function TablaClientes({ clientes }: { clientes: AnalisisDia["clientes"] }) {
  if (clientes.length === 0) return null;
  return (
    <>
      <SeccionHeader>Logística y Clientes</SeccionHeader>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Cliente</TableHead>
                <TableHead className="text-right">Palets</TableHead>
                <TableHead className="text-right">Kg Total</TableHead>
                <TableHead>Productos</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {clientes.slice(0, 10).map((c) => (
                <TableRow key={c.cliente}>
                  <TableCell className="text-xs font-medium">{c.cliente}</TableCell>
                  <TableCell className="text-right tabular-nums text-xs">{c.n_palets}</TableCell>
                  <TableCell className="text-right tabular-nums text-xs">{gKg(c.kg_total)}</TableCell>
                  <TableCell className="text-xs text-muted-foreground max-w-[200px] truncate" title={c.productos.join(", ")}>
                    {c.productos.length > 3 ? c.productos.slice(0, 3).join(", ") + ` (+${c.productos.length - 3})` : c.productos.join(", ") || "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}
```

```tsx
function TablaCalibres({ calibres }: { calibres: AnalisisDia["calibres"] }) {
  if (calibres.length === 0) return null;
  const top5 = calibres.slice(0, 5);
  return (
    <>
      <SeccionHeader>Calidad — Calibres</SeccionHeader>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Calibre</TableHead>
                <TableHead className="text-right">Kg</TableHead>
                <TableHead className="text-right">% Total</TableHead>
                <TableHead className="text-right">% Export</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {top5.map((c) => (
                <TableRow key={c.calibre}>
                  <TableCell className="text-xs font-medium">{c.calibre}</TableCell>
                  <TableCell className="text-right tabular-nums text-xs">{gKg(c.kg)}</TableCell>
                  <TableCell className="text-right tabular-nums text-xs">{gPct(c.pct_total)}</TableCell>
                  <TableCell className="text-right tabular-nums text-xs">{gPct(c.pct_export)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}
```

```tsx
function AlertasList({ alertas }: { alertas: AnalisisDia["alertas"] }) {
  if (alertas.length === 0) return null;
  return (
    <>
      <SeccionHeader>Alertas del Día</SeccionHeader>
      <div className="space-y-1.5">
        {alertas.map((a) => {
          const styles = {
            danger: "bg-destructive/10 border-destructive/30 text-destructive",
            warning: "bg-warning/10 border-warning/30 text-warning",
            info: "bg-[var(--glass-bg)] border-[var(--glass-border)] text-muted-foreground",
          }[a.severidad];
          return (
            <div key={a.id} className={cn("flex items-start gap-2 rounded-xl border px-3 py-2.5 text-xs backdrop-blur-sm", styles)}>
              <div><span className="font-semibold">{a.titulo}</span>{" — "}<span className="opacity-80">{a.detalle}</span></div>
            </div>
          );
        })}
      </div>
    </>
  );
}
```

Wait, `productores` is used instead of `productos` in TablaProductos — that's a bug. The variable reference should be `productos` not `productores`. Let me fix that in the actual implementation.

Also I need to import `formatNumber` from `@/lib/format`.

Let me also check what `formatKg` looks like in `@/lib/format`:

I already know it's available. Good.

Now let me write the actual plan code for the ReporteOperativo component. Let me be very careful.

- [ ] **Step 4: Rebuild the main ReporteOperativo component**

Replace the return of `ReporteOperativo` to use the new sections instead of `dangerouslySetInnerHTML`:

```tsx
export function ReporteOperativo({ analisis, fechaParte }: Props) {
  const [busqueda, setBusqueda] = useState("");

  const reporteMd = useMemo(
    () => generarReporteOperativo(analisis, fechaParte),
    [analisis, fechaParte]
  );

  const resultadoBusqueda = useMemo(() => {
    if (!busqueda.trim()) return null;
    return buscarLoteContexto(analisis, busqueda.trim());
  }, [analisis, busqueda]);

  function copiarAlPortapapeles() {
    navigator.clipboard.writeText(reporteMd).then(() => {
      toast({ title: "Copiado", description: "Reporte copiado al portapapeles" });
    }).catch(() => {
      toast({ title: "Error", description: "No se pudo copiar", variant: "destructive" });
    });
  }

  function descargarMd() {
    const blob = new Blob([reporteMd], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const fecha = fechaParte ?? new Date().toISOString().slice(0, 10);
    a.download = `reporte-operativo-${fecha}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast({ title: "Descargado", description: `reporte-operativo-${fecha}.md` });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <FileText className="h-5 w-5 text-primary" />
          <h3 className="text-sm font-semibold">Reporte Operativo Ejecutivo</h3>
          <Badge variant="secondary" className="text-[10px]">Estructurado</Badge>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={copiarAlPortapapeles} className="glass glass-hover">
            <Copy className="h-3.5 w-3.5 mr-1.5" />
            Copiar
          </Button>
          <Button variant="outline" size="sm" onClick={descargarMd} className="glass glass-hover">
            <Download className="h-3.5 w-3.5 mr-1.5" />
            Descargar .md
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-3">
          <div className="flex items-center gap-2">
            <Search className="h-4 w-4 text-muted-foreground shrink-0" />
            <Input
              placeholder="Buscar lote (ej: 7700, nombre de lote...)"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              className="h-8 text-xs"
            />
          </div>
          {busqueda.trim() && !resultadoBusqueda && (
            <p className="text-[10px] text-muted-foreground mt-2 ml-6">
              No se encontró ningún lote con "{busqueda}"
            </p>
          )}
          {resultadoBusqueda && (
            <div className="mt-3 ml-6 rounded-xl border border-primary/20 bg-primary/5 p-3 text-xs">
              <pre className="whitespace-pre-wrap font-sans">{resultadoBusqueda}</pre>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="space-y-2">
        <ResumenEjecutivo kpis={analisis.kpis} />
        <AlertasList alertas={analisis.alertas} />
        <TablaProductores productores={analisis.productores} />
        <TablaProductos productos={analisis.top_productos} />
        <TablaClientes clientes={analisis.clientes} />
        <TablaCalibres calibres={analisis.calibres} />
      </div>

      <p className="text-[10px] text-muted-foreground text-right">
        Reporte generado automáticamente · {new Date(analisis.fecha_analisis).toLocaleString("es-ES")}
      </p>
    </div>
  );
}
```

Wait, the `resultadoBusqueda` is text/Markdown, not HTML. Since we removed the mdToHtml, I should just display it as text. Let me use a `<pre>` or just render it as text.

Actually, let me keep `mdToHtml` for the search results only, since those are short snippets. Or better yet, just render the search result as plain text since it's short Markdown.

Let me think about what `buscarLoteContexto` returns - it returns a Markdown string. So I should display it as-is with `<pre className="whitespace-pre-wrap font-sans">`.

OK, let me make sure the plan is complete. Let me check the spec:

Spec requirements:
1. ✅ Al hacer clic en un archivo Excel de palets, se abre el diálogo con los datos visibles → Task 1
2. ✅ El Reporte Ejecutivo muestra los datos en tablas ordenadas → Task 2
3. ✅ Los botones Copiar/Descargar .md/Buscador siguen funcionando → Task 2
4. ✅ No hay errores de TypeScript al compilar → Step to verify

The plan looks good. Let me save it and transition to execution.<｜end▁of▁thinking｜>

<｜｜DSML｜｜tool_calls>
<｜｜DSML｜｜invoke name="bash">
<｜｜DSML｜｜parameter name="description" string="true">Check format.ts exports