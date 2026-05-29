/**
 * ReporteOperativo.tsx — Visualizador del Reporte Ejecutivo Operativo.
 *
 * Renderiza el Markdown generado por generarReporteOperativo() con:
 *   - Vista previa formateada (HTML)
 *   - Botón copiar al portapapeles
 *   - Botón descargar .md
 *   - Buscador inteligente de lotes
 */
import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import { Copy, Download, FileText, Search } from "lucide-react";
import type { AnalisisDia } from "@/lib/analisis";
import { generarReporteOperativo, buscarLoteContexto } from "@/lib/reporteOperativo";

// ─── Mini Markdown → HTML renderer ───────────────────────────────────────────

function mdToHtml(md: string): string {
  const lines = md.split("\n");
  const html: string[] = [];
  let inTable = false;
  let tableRows: string[] = [];

  function flushTable() {
    if (tableRows.length === 0) return;
    html.push('<div class="overflow-auto my-3 rounded-xl border border-[var(--glass-border)]"><table class="text-xs border-collapse">');

    let rowIndex = 0;
    let inTbody = false;

    for (let i = 0; i < tableRows.length; i++) {
      if (/^\|[\s\-:|]+\|$/.test(tableRows[i].trim())) continue;

      const cells = tableRows[i]
        .split("|")
        .slice(1, -1)
        .map((c) => c.trim());

      const isHeader = i === 0;
      const tag = isHeader ? "th" : "td";

      if (isHeader) {
        html.push("<thead>");
      } else if (!inTbody) {
        html.push("<tbody>");
        inTbody = true;
      }

      const rowClass = isHeader
        ? 'class="bg-[var(--glass-bg-strong)]"'
        : rowIndex % 2 === 0
          ? 'class="bg-[var(--glass-bg)]"'
          : "";

      html.push(`<tr ${rowClass}>`);
      for (const cell of cells) {
        const styled = inlineStyle(cell);
        if (isHeader) {
          html.push(`<th class="sticky top-0 z-10 px-3 py-2 border-b border-r border-[var(--glass-border)] text-left font-semibold whitespace-nowrap bg-[var(--glass-bg-strong)]">${styled}</th>`);
        } else {
          html.push(`<td class="px-3 py-1.5 border-b border-r border-[var(--glass-border)] whitespace-nowrap">${styled}</td>`);
        }
      }
      html.push("</tr>");

      if (isHeader) html.push("</thead>");
      rowIndex++;
    }

    if (inTbody) html.push("</tbody>");
    html.push("</table></div>");
    tableRows = [];
    inTable = false;
  }

  let inList = false;

  function closeList() {
    if (inList) {
      html.push("</ul>");
      inList = false;
    }
  }

  for (const line of lines) {
    const trimmed = line.trim();

    // Table detection
    if (trimmed.startsWith("|") && trimmed.endsWith("|")) {
      closeList();
      inTable = true;
      tableRows.push(trimmed);
      continue;
    } else if (inTable) {
      flushTable();
    }

    // Headers
    if (trimmed.startsWith("# ")) {
      closeList();
      html.push(`<h1 class="text-xl font-bold mt-6 mb-2 text-foreground">${inlineStyle(trimmed.slice(2))}</h1>`);
    } else if (trimmed.startsWith("## ")) {
      closeList();
      html.push(`<h2 class="text-lg font-semibold mt-5 mb-2 text-foreground border-b border-[var(--glass-border)] pb-1">${inlineStyle(trimmed.slice(3))}</h2>`);
    } else if (trimmed.startsWith("### ")) {
      closeList();
      html.push(`<h3 class="text-sm font-semibold mt-4 mb-1 text-foreground">${inlineStyle(trimmed.slice(4))}</h3>`);
    }
    // Blockquote
    else if (trimmed.startsWith(">")) {
      closeList();
      const content = trimmed.slice(1).trim();
      html.push(`<blockquote class="border-l-3 border-primary/40 pl-3 py-1 my-2 text-xs text-muted-foreground italic">${inlineStyle(content)}</blockquote>`);
    }
    // List item
    else if (trimmed.startsWith("- ") || trimmed.startsWith("  - ")) {
      if (!inList) {
        html.push('<ul class="my-2 space-y-0.5">');
        inList = true;
      }
      const isIndented = trimmed.startsWith("  - ");
      const text = isIndented ? trimmed.slice(4) : trimmed.slice(2);
      const cls = isIndented
        ? 'class="ml-8 text-xs text-muted-foreground my-0.5 list-disc"'
        : 'class="ml-4 text-xs text-foreground/90 my-0.5 list-disc"';
      html.push(`<li ${cls}>${inlineStyle(text)}</li>`);
    }
    // Horizontal rule
    else if (trimmed === "---") {
      closeList();
      html.push('<hr class="my-4 border-[var(--glass-border)]" />');
    }
    // Italic line (metadata)
    else if (trimmed.startsWith("_") && trimmed.endsWith("_")) {
      closeList();
      html.push(`<p class="text-[10px] text-muted-foreground mt-3 text-right">${trimmed.slice(1, -1)}</p>`);
    }
    // Empty line
    else if (trimmed === "") {
      closeList();
    }
    // Regular paragraph
    else {
      closeList();
      html.push(`<p class="text-xs text-foreground/90 my-1">${inlineStyle(trimmed)}</p>`);
    }
  }

  closeList();
  if (inTable) flushTable();

  return html.join("\n");
}

function inlineStyle(text: string): string {
  // Bold
  let result = text.replace(/\*\*(.+?)\*\*/g, '<strong class="font-semibold text-foreground">$1</strong>');
  // Italic
  result = result.replace(/(?<!\*)_(.+?)_(?!\*)/g, "<em>$1</em>");
  // Emojis are already valid HTML
  return result;
}

// ─── Componente principal ─────────────────────────────────────────────────────

interface Props {
  analisis: AnalisisDia;
  fechaParte?: string;
}

export function ReporteOperativo({ analisis, fechaParte }: Props) {
  const [busqueda, setBusqueda] = useState("");

  // Generar reporte
  const reporteMd = useMemo(
    () => generarReporteOperativo(analisis, fechaParte),
    [analisis, fechaParte]
  );

  const reporteHtml = useMemo(() => mdToHtml(reporteMd), [reporteMd]);

  // Busqueda inteligente de lote
  const resultadoBusqueda = useMemo(() => {
    if (!busqueda.trim()) return null;
    return buscarLoteContexto(analisis, busqueda.trim());
  }, [analisis, busqueda]);

  const resultadoBusquedaHtml = useMemo(
    () => (resultadoBusqueda ? mdToHtml(resultadoBusqueda) : null),
    [resultadoBusqueda]
  );

  // Acciones
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
      {/* Header con acciones */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <FileText className="h-5 w-5 text-primary" />
          <h3 className="text-sm font-semibold">Reporte Operativo Ejecutivo</h3>
          <Badge variant="secondary" className="text-[10px]">Markdown</Badge>
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

      {/* Buscador inteligente */}
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
              No se encontro ningun lote con "{busqueda}"
            </p>
          )}
          {resultadoBusquedaHtml && (
            <div
              className="mt-3 ml-6 rounded-xl border border-primary/20 bg-primary/5 p-3"
              dangerouslySetInnerHTML={{ __html: resultadoBusquedaHtml }}
            />
          )}
        </CardContent>
      </Card>

      {/* Reporte renderizado */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-xs text-muted-foreground font-normal">
            Vista previa del reporte
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div
            className="prose-sm max-w-none"
            dangerouslySetInnerHTML={{ __html: reporteHtml }}
          />
        </CardContent>
      </Card>
    </div>
  );
}
