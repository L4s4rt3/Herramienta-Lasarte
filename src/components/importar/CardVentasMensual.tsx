// src/components/importar/CardVentasMensual.tsx
// Tarjeta combinada "Ventas mensuales" de la Bandeja (zona B, con
// confirmación): agrupa ventas-lineas + ventas-metodos-catalogo +
// ventas-metodo en UNA sola tarjeta, replicando el flujo de
// src/pages/VentasMensualImport.tsx / src/lib/ventasMensualImport.ts.
import { useMemo, useState } from "react";
import { AlertTriangle, Database, HelpCircle, ShoppingCart } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "@/hooks/use-toast";
import { useVentasCategoria } from "@/hooks/useVentasCategoria";
import {
  classifyVentasMensual,
  METODOS_SEGUNDA_POR_DEFECTO,
  type VentasMensualClassifyResult,
  type VentasMensualMetodoArchivo,
} from "@/lib/ventasMensualImport";
import {
  normalizeVentasCategoriaLinea,
  validateVentasCategoriaImport,
  type ParseVentasCategoriaWorkbookResult,
} from "@/lib/ventasCategoria";
import type { ArchivoClasificado } from "@/lib/importBandeja";
import { errorMessage } from "@/lib/errorMessage";
import { formatKg, formatNumber } from "@/lib/format";

// Misma clave de localStorage que SEGUNDA_CODIGOS_STORAGE_KEY en
// src/pages/VentasMensualImport.tsx (no exportada desde allí, se duplica el
// literal a propósito): así ambas pantallas comparten la MISMA lista
// persistida de códigos de categoría segunda, se edite desde donde se edite.
const SEGUNDA_CODIGOS_STORAGE_KEY = "ventasMensualImport.segundaCodigos";

function readStoredSegundaCodigos(): string {
  try {
    return window.localStorage.getItem(SEGUNDA_CODIGOS_STORAGE_KEY) || METODOS_SEGUNDA_POR_DEFECTO;
  } catch {
    return METODOS_SEGUNDA_POR_DEFECTO;
  }
}

interface Props {
  lineasArchivos: ArchivoClasificado[];
  catalogoArchivos: ArchivoClasificado[];
  metodoArchivosClasificados: ArchivoClasificado[];
}

function buildParseResult(
  lineasInput: VentasMensualClassifyResult["primera"],
  catalogo: VentasMensualClassifyResult["catalogoPrimera"],
): ParseVentasCategoriaWorkbookResult {
  const lineas = lineasInput.map(normalizeVentasCategoriaLinea);
  return { lineas, catalogo, validation: validateVentasCategoriaImport({ lineas, catalogo }) };
}

export function CardVentasMensual({ lineasArchivos, catalogoArchivos, metodoArchivosClasificados }: Props) {
  const ventasPrimera = useVentasCategoria("Categoria primera");
  const ventasSegunda = useVentasCategoria("Categoria segunda");
  const [importando, setImportando] = useState(false);
  const [resumenTexto, setResumenTexto] = useState<string | null>(null);

  const tieneLineas = lineasArchivos.length > 0;
  const tieneCatalogo = catalogoArchivos.length > 0;

  const metodoArchivos: VentasMensualMetodoArchivo[] = useMemo(
    () => metodoArchivosClasificados
      .filter((a) => a.codigoMetodo)
      .map((a) => ({ codigo: a.codigoMetodo as string, rows: a.payload as unknown[][] })),
    [metodoArchivosClasificados],
  );

  const resultado: VentasMensualClassifyResult | null = useMemo(() => {
    if (!tieneLineas || !tieneCatalogo) return null;
    return classifyVentasMensual({
      lineasRows: lineasArchivos[0].payload as unknown[][],
      metodosCatalogoRows: catalogoArchivos[0].payload as unknown[][],
      metodoArchivos,
      segundaCodigos: readStoredSegundaCodigos(),
    });
  }, [lineasArchivos, catalogoArchivos, metodoArchivos, tieneLineas, tieneCatalogo]);

  const hasAccess = ventasPrimera.hasAccess && ventasSegunda.hasAccess;

  if (!tieneLineas && !tieneCatalogo && metodoArchivosClasificados.length === 0) return null;

  const handleImportar = async () => {
    if (!resultado) return;
    setImportando(true);
    try {
      const primeraParsed = buildParseResult(resultado.primera, resultado.catalogoPrimera);
      const segundaParsed = buildParseResult(resultado.segunda, resultado.catalogoSegunda);
      await Promise.all([
        ventasPrimera.importWorkbook.mutateAsync(primeraParsed),
        ventasSegunda.importWorkbook.mutateAsync(segundaParsed),
      ]);
      setResumenTexto(
        `Categoría primera: ${formatKg(resultado.totales.primera.kilos)} (${formatNumber(resultado.totales.primera.lineas)} línea(s)) · Categoría segunda: ${formatKg(resultado.totales.segunda.kilos)} (${formatNumber(resultado.totales.segunda.lineas)} línea(s)) importadas.`,
      );
      toast({ title: "Ventas del mes importadas" });
    } catch (e) {
      toast({ title: "Error al importar", description: errorMessage(e), variant: "destructive" });
    } finally {
      setImportando(false);
    }
  };

  return (
    <Card className="glass-accented overflow-hidden">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base"><ShoppingCart className="h-4 w-4" /> Ventas mensuales (Comercial)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {!tieneLineas || !tieneCatalogo ? (
          <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Falta el fichero de {!tieneLineas && !tieneCatalogo ? "líneas detallado y de métodos de confección" : !tieneLineas ? "líneas detallado" : "métodos de confección"}
            {" "}(ambos son obligatorios para analizar el mes); se detectaron {formatNumber(metodoArchivosClasificados.length)} archivo(s) de método sueltos en esta tanda.
          </div>
        ) : resultado ? (
          <>
            <p className="text-sm font-medium">
              Categoría primera: <span className="tabular-nums">{formatKg(resultado.totales.primera.kilos)}</span> · Categoría
              {" "}segunda: <span className="tabular-nums">{formatKg(resultado.totales.segunda.kilos)}</span> · Mercadona:{" "}
              <span className="tabular-nums">{formatKg(resultado.totales.mercadona.kilos)}</span> (se importa con su hoja semanal,
              no aquí) · Referencias ambiguas: <span className="tabular-nums">{formatNumber(resultado.ambiguas.length)}</span>
            </p>
            <p className="text-xs text-muted-foreground">
              {formatNumber(resultado.totales.excluidos.lineas)} línea(s) excluida(s) (no producto) · {formatNumber(metodoArchivos.length)} archivo(s) de método detectado(s).
            </p>
            {resultado.ambiguas.length > 0 ? (
              <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                <HelpCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
                Las referencias ambiguas se clasifican por la categoría dominante (revisable después en Categoría segunda/primera).
              </p>
            ) : null}
            {!hasAccess ? (
              <p className="text-xs text-destructive">Tu usuario no tiene acceso de importación a Categoría primera y/o Categoría segunda.</p>
            ) : null}
            {resumenTexto ? <p className="text-xs text-success">{resumenTexto}</p> : null}
            <Button
              size="sm"
              className="gap-2"
              disabled={!hasAccess || importando || ventasPrimera.importWorkbook.isPending || ventasSegunda.importWorkbook.isPending}
              onClick={handleImportar}
            >
              <Database className="h-4 w-4" /> {importando ? "Importando..." : "Importar Categoría primera + segunda"}
            </Button>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
