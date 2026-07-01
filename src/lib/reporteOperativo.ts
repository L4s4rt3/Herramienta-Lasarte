/**
 * reporteOperativo.ts — Generador de Reporte Operativo Ejecutivo (Markdown)
 *
 * Aplica las instrucciones del Analista de Operaciones Senior:
 *   1. Resumen Ejecutivo (KPIs)
 *   2. Recepción y Lotes (por productor)
 *   3. Producción y Empaque (top formatos)
 *   4. Logística y Clientes (volumen enviado)
 *   5. Calidad (calibres por variedad + alertas)
 *
 * Reglas:
 *   - NUNCA listar filas crudas de Excel
 *   - Siempre consolidar y agrupar antes de presentar
 *   - Detectar y señalar inconsistencias como "Alerta de Inventario"
 *   - Formato ejecutivo, directo y con jerarquía visual Markdown
 */
import type { AnalisisDia } from "./analisis";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtKg(v: number): string {
  if (v >= 1000) {
    return `${(v / 1000).toFixed(1).replace(".", ",")} t`;
  }
  return `${Math.round(v).toLocaleString("es-ES")} kg`;
}

function fmtPct(v: number): string {
  return `${v.toFixed(1).replace(".", ",")}%`;
}

function fmtNum(v: number): string {
  return Math.round(v).toLocaleString("es-ES");
}

function fechaHoy(): string {
  return new Date().toLocaleDateString("es-ES", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

// ─── Generador principal ──────────────────────────────────────────────────────

export function generarReporteOperativo(analisis: AnalisisDia, fechaParte?: string): string {
  const { kpis, alertas, productores, calibres, clientes, top_productos } = analisis;

  const fecha = fechaParte
    ? new Date(/^\d{4}-\d{2}-\d{2}$/.test(fechaParte) ? `${fechaParte}T12:00:00` : fechaParte)
        .toLocaleDateString("es-ES", { day: "2-digit", month: "long", year: "numeric" })
    : fechaHoy();

  const lines: string[] = [];

  // ══════════════════════════════════════════════════════════════════════════
  // ENCABEZADO
  // ══════════════════════════════════════════════════════════════════════════
  lines.push(`# Reporte Operativo: ${fecha}`);
  lines.push("");

  // ══════════════════════════════════════════════════════════════════════════
  // 1. RESUMEN EJECUTIVO
  // ══════════════════════════════════════════════════════════════════════════
  lines.push("## Resumen Ejecutivo");
  lines.push("");
  lines.push("| Indicador | Valor |");
  lines.push("|-----------|-------|");
  lines.push(`| **Total Produccion** | ${fmtKg(kpis.kg_calibrador)} |`);
  lines.push(`| **Variedad Principal** | ${kpis.top_calibre ?? "N/D"} (${fmtPct(kpis.top_calibre_pct)} del total) |`);

  if (kpis.peso_fruta_avg_g) {
    lines.push(`| **Peso Medio Fruta** | ${kpis.peso_fruta_avg_g} g |`);
  }

  lines.push(`| **Lotes procesados** | ${kpis.n_lotes} lotes de ${kpis.n_productores} productores |`);
  lines.push(`| **Exportacion** | ${fmtPct(kpis.pct_exportacion)} (${fmtKg(kpis.kg_exportacion)}) |`);
  lines.push(`| **Mercado** | ${fmtPct(kpis.pct_mercado)} (${fmtKg(kpis.kg_mercado)}) |`);
  lines.push(`| **Industria** | ${fmtPct(kpis.pct_industria)} (${fmtKg(kpis.kg_industria)}) |`);

  if (kpis.tph_promedio) {
    lines.push(`| **Eficiencia Media** | ${kpis.tph_promedio.toFixed(1)} T/h |`);
  }

  lines.push(`| **Palets generados** | ${kpis.n_palets} |`);
  lines.push("");

  // Alertas del dia
  if (alertas.length > 0) {
    lines.push("### Alertas del Dia");
    lines.push("");
    for (const a of alertas) {
      const icon = a.severidad === "danger" ? "🔴" : a.severidad === "warning" ? "🟡" : "🔵";
      lines.push(`- ${icon} **${a.titulo}** — ${a.detalle}`);
    }
    lines.push("");
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 2. RECEPCION Y LOTES
  // ══════════════════════════════════════════════════════════════════════════
  lines.push("## Recepcion y Lotes");
  lines.push("");

  if (productores.length > 0) {
    lines.push("| Productor | Kg Total | Lotes | T/h Medio | Peso Fruta |");
    lines.push("|-----------|----------|-------|-----------|------------|");

    for (const p of productores) {
      const tph = p.tph_avg ? `${p.tph_avg.toFixed(1)} T/h` : "—";
      const peso = p.peso_fruta_avg_g ? `${p.peso_fruta_avg_g.toFixed(0)} g` : "—";
      lines.push(`| ${p.productor} | ${fmtKg(p.kg_total)} | ${p.n_lotes} | ${tph} | ${peso} |`);
    }
    lines.push("");

    // Concentracion de productores
    const totalKg = productores.reduce((s, p) => s + p.kg_total, 0);
    const topProd = productores[0];
    if (topProd && totalKg > 0) {
      const pctTop = (topProd.kg_total / totalKg) * 100;
      lines.push(`> **Productor dominante:** ${topProd.productor} aporta el ${fmtPct(pctTop)} de la produccion total.`);
      lines.push("");
    }
  } else {
    lines.push("_Sin datos de lotes/productores para esta jornada._");
    lines.push("");
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 3. PRODUCCION Y EMPAQUE
  // ══════════════════════════════════════════════════════════════════════════
  lines.push("## Produccion y Empaque");
  lines.push("");

  if (top_productos.length > 0) {
    lines.push("**Top productos confeccionados por volumen:**");
    lines.push("");
    lines.push("| # | Producto | Kg | Empaques | Destino |");
    lines.push("|---|----------|------|----------|---------|");

    const topN = top_productos.slice(0, 6);
    topN.forEach((p, i) => {
      const destino = p.grupo_destino ?? "—";
      lines.push(`| ${i + 1} | ${p.producto} | ${fmtKg(p.kg)} | ${fmtNum(p.n_empaques)} | ${destino} |`);
    });
    lines.push("");

    // Ratio empaque vs entrada
    const kgEmpacados = top_productos.reduce((s, p) => s + p.kg, 0);
    if (kpis.kg_calibrador > 0 && kgEmpacados > 0) {
      const ratio = (kgEmpacados / kpis.kg_calibrador) * 100;
      lines.push(`> **Rendimiento de empaque:** ${fmtPct(ratio)} de la fruta calibrada fue empacada.`);

      // Alerta de inventario si sale mas de lo que entro
      if (ratio > 105) {
        lines.push("");
        lines.push(`> ⚠️ **Alerta de Inventario:** El peso empacado (${fmtKg(kgEmpacados)}) supera al calibrado (${fmtKg(kpis.kg_calibrador)}). Posible mezcla con stock previo o error de registro.`);
      }
      lines.push("");
    }
  } else {
    lines.push("_Sin datos de producto empacado para esta jornada._");
    lines.push("");
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 4. LOGISTICA Y CLIENTES
  // ══════════════════════════════════════════════════════════════════════════
  lines.push("## Logistica y Clientes");
  lines.push("");

  if (clientes.length > 0) {
    lines.push("| Cliente | Palets | Kg Total | Productos |");
    lines.push("|---------|--------|----------|-----------|");

    for (const c of clientes.slice(0, 10)) {
      const prods = c.productos.length > 3
        ? c.productos.slice(0, 3).join(", ") + ` (+${c.productos.length - 3})`
        : c.productos.join(", ");
      lines.push(`| ${c.cliente} | ${c.n_palets} | ${fmtKg(c.kg_total)} | ${prods || "—"} |`);
    }
    lines.push("");

    // Concentracion de clientes
    const totalKgClientes = clientes.reduce((s, c) => s + c.kg_total, 0);
    const top3 = clientes.slice(0, 3);
    const kgTop3 = top3.reduce((s, c) => s + c.kg_total, 0);
    if (totalKgClientes > 0) {
      lines.push(`> Los **${Math.min(3, clientes.length)} principales clientes** concentran el ${fmtPct((kgTop3 / totalKgClientes) * 100)} del volumen expedido.`);
      lines.push("");
    }
  } else {
    lines.push("_Sin datos de expediciones/palets para esta jornada._");
    lines.push("");
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 5. CALIDAD
  // ══════════════════════════════════════════════════════════════════════════
  lines.push("## Calidad");
  lines.push("");

  if (calibres.length > 0) {
    // Analisis narrativo en lugar de tabla cruda
    const topCalibres = calibres.slice(0, 5);
    const kgTotalCalibre = calibres.reduce((s, c) => s + c.kg, 0);

    lines.push("**Distribucion de calibres/variedades (Top 5):**");
    lines.push("");
    lines.push("| Calibre/Variedad | Kg | % Total | % Exportacion |");
    lines.push("|------------------|----|---------|---------------|");

    for (const c of topCalibres) {
      lines.push(`| ${c.calibre} | ${fmtKg(c.kg)} | ${fmtPct(c.pct_total)} | ${fmtPct(c.pct_export)} |`);
    }
    lines.push("");

    // Deteccion de desviaciones
    if (calibres.length >= 3) {
      const pesoMedio = kgTotalCalibre / calibres.length;
      const desviaciones = calibres.filter(
        (c) => c.kg > pesoMedio * 2.5 || (c.kg > 0 && c.kg < pesoMedio * 0.2)
      );

      if (desviaciones.length > 0) {
        lines.push("### Desviaciones detectadas");
        lines.push("");
        for (const d of desviaciones) {
          if (d.kg > pesoMedio * 2.5) {
            lines.push(`- **${d.calibre}** tiene un volumen anormalmente alto (${fmtKg(d.kg)}) — ${fmtPct((d.kg / kgTotalCalibre) * 100)} del total. Alta dependencia de demanda para este calibre.`);
          } else {
            lines.push(`- **${d.calibre}** tiene un volumen muy bajo (${fmtKg(d.kg)}) — posible rechazo o clasificacion residual.`);
          }
        }
        lines.push("");
      }
    }

    // Resumen de destinos de calidad
    const exportPct = kpis.pct_exportacion;
    if (exportPct >= 70) {
      lines.push(`> ✅ **Calidad excelente:** El ${fmtPct(exportPct)} de la fruta alcanza calidad de exportacion.`);
    } else if (exportPct >= 50) {
      lines.push(`> 🟡 **Calidad aceptable:** El ${fmtPct(exportPct)} va a exportacion. Margen de mejora en clasificacion.`);
    } else if (exportPct > 0) {
      lines.push(`> 🔴 **Calidad por debajo de objetivo:** Solo el ${fmtPct(exportPct)} alcanza exportacion. Revisar materia prima y configuracion de calibrador.`);
    }
    lines.push("");
  } else {
    lines.push("_Sin datos de calibres/calidad para esta jornada._");
    lines.push("");
  }

  // ══════════════════════════════════════════════════════════════════════════
  // PIE
  // ══════════════════════════════════════════════════════════════════════════
  lines.push("---");
  lines.push(`_Reporte generado automaticamente · ${new Date(analisis.fecha_analisis).toLocaleString("es-ES")}_`);

  return lines.join("\n");
}

// ─── Busqueda inteligente por lote ────────────────────────────────────────────

export function buscarLoteContexto(
  analisis: AnalisisDia,
  busqueda: string,
): string | null {
  const raw = analisis._raw_produccion;
  if (!raw || !raw.lotes) return null;

  const termino = busqueda.toLowerCase().trim();

  const lote = raw.lotes.find(
    (l) =>
      l.id_lote?.toLowerCase().includes(termino) ||
      l.lote_codigo?.toLowerCase().includes(termino) ||
      l.nombre_lote?.toLowerCase().includes(termino)
  );

  if (!lote) return null;

  const lines: string[] = [];
  lines.push(`### Contexto del Lote: ${lote.id_lote ?? lote.lote_codigo ?? busqueda}`);
  lines.push("");
  lines.push(`- **Productor:** ${lote.nombre_productor ?? lote.productor ?? "Desconocido"}`);
  lines.push(`- **Variedad:** ${lote.variedad ?? "N/D"}`);
  lines.push(`- **Peso total:** ${fmtKg(lote.kg_peso_total)}`);

  if (lote.toneladas_hora) {
    lines.push(`- **Eficiencia:** ${lote.toneladas_hora.toFixed(2)} T/h`);
  }
  if (lote.peso_fruta_promedio_g) {
    lines.push(`- **Peso medio fruta:** ${lote.peso_fruta_promedio_g.toFixed(0)} g`);
  }
  if (lote.tiempo_inicio) {
    lines.push(`- **Hora de inicio:** ${lote.tiempo_inicio}`);
  }
  if (lote.duracion_min) {
    lines.push(`- **Duracion:** ${lote.duracion_min} min`);
  }

  // Intentar vincular con productos si hay datos
  const rawProducto = analisis._raw_producto;
  if (rawProducto && rawProducto.lineas && lote.variedad) {
    const productosRelacionados = rawProducto.lineas.filter(
      (p) => p.fruta?.toLowerCase().includes(lote.variedad!.toLowerCase())
    );
    if (productosRelacionados.length > 0) {
      lines.push("");
      lines.push("**Productos en los que se convirtio:**");
      for (const p of productosRelacionados.slice(0, 5)) {
        lines.push(`  - ${p.producto ?? "?"} (${fmtKg(p.kg)}, empaque: ${p.empaque ?? "—"})`);
      }
    }
  }

  // Contexto relativo
  if (analisis.productores.length > 0) {
    const productor = analisis.productores.find(
      (p) => p.productor === (lote.nombre_productor ?? lote.productor)
    );
    if (productor) {
      const totalKg = analisis.productores.reduce((s, p) => s + p.kg_total, 0);
      const pctProd = totalKg > 0 ? (productor.kg_total / totalKg) * 100 : 0;
      lines.push("");
      lines.push(`> Este lote pertenece a **${productor.productor}**, que aporto ${fmtKg(productor.kg_total)} en total (${fmtPct(pctProd)} de la jornada, ${productor.n_lotes} lotes).`);
    }
  }

  return lines.join("\n");
}
