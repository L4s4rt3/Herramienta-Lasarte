// src/pages/VentasMensualImport.tsx
// Importador mensual de ventas (Comercial): el usuario sube de una vez todos
// los ficheros que exporta el ERP cada mes y la app los reparte
// automaticamente entre Categoria primera, Categoria segunda y Mercadona,
// descartando lo que no es producto. Ver src/lib/ventasMensualImport.ts para
// la logica pura de clasificacion (con tests).
import { useMemo, useState, type ChangeEvent } from "react";
import * as XLSX from "xlsx";
import {
  AlertTriangle, Ban, CheckCircle2, Database, FileSpreadsheet, HelpCircle, Layers,
  Package, RotateCcw, ShoppingCart, Upload,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { InfoTooltip } from "@/components/InfoTooltip";
import { toast } from "@/hooks/use-toast";
import { useVentasCategoria } from "@/hooks/useVentasCategoria";
import {
  normalizeVentasCategoriaLinea,
  validateVentasCategoriaImport,
  type ParseVentasCategoriaWorkbookResult,
  type VentasCategoriaCatalogoProducto,
  type VentasCategoriaLineaInput,
} from "@/lib/ventasCategoria";
import {
  classifyVentasMensual,
  detectVentasMensualFileKind,
  METODOS_SEGUNDA_POR_DEFECTO,
  type VentasMensualClassifyResult,
  type VentasMensualMetodoArchivo,
} from "@/lib/ventasMensualImport";
import { errorMessage } from "@/lib/errorMessage";
import { formatKg, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

const SEGUNDA_CODIGOS_STORAGE_KEY = "ventasMensualImport.segundaCodigos";

interface FicherosDetectados {
  lineasRows: unknown[][];
  lineasFileName: string | null;
  metodosCatalogoRows: unknown[][];
  metodosFileName: string | null;
  metodoArchivos: VentasMensualMetodoArchivo[];
  ignorados: string[];
}

const FICHEROS_VACIOS: FicherosDetectados = {
  lineasRows: [],
  lineasFileName: null,
  metodosCatalogoRows: [],
  metodosFileName: null,
  metodoArchivos: [],
  ignorados: [],
};

export default function VentasMensualImport() {
  const ventasPrimera = useVentasCategoria("Categoria primera");
  const ventasSegunda = useVentasCategoria("Categoria segunda");

  const [ficheros, setFicheros] = useState<FicherosDetectados>(FICHEROS_VACIOS);
  const [leyendoFicheros, setLeyendoFicheros] = useState(false);
  const [segundaCodigos, setSegundaCodigosState] = useState<string>(() => readStoredSegundaCodigos());
  const [resultado, setResultado] = useState<VentasMensualClassifyResult | null>(null);
  const [excluidosLimit, setExcluidosLimit] = useState(15);
  const [importando, setImportando] = useState(false);

  const tieneLineas = ficheros.lineasRows.length > 0;
  const tieneMetodosCatalogo = ficheros.metodosCatalogoRows.length > 0;
  const puedeAnalizar = tieneLineas && tieneMetodosCatalogo;
  const hasAccess = ventasPrimera.hasAccess && ventasSegunda.hasAccess;

  const setSegundaCodigos = (value: string) => {
    setSegundaCodigosState(value);
    try {
      window.localStorage.setItem(SEGUNDA_CODIGOS_STORAGE_KEY, value);
    } catch {
      // localStorage puede no estar disponible (modo privado); no es critico.
    }
  };

  const resetSegundaCodigos = () => setSegundaCodigos(METODOS_SEGUNDA_POR_DEFECTO);

  const handleFilesSelected = async (event: ChangeEvent<HTMLInputElement>) => {
    const fileList = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = "";
    if (fileList.length === 0) return;

    setLeyendoFicheros(true);
    try {
      const next: FicherosDetectados = {
        lineasRows: [], lineasFileName: null, metodosCatalogoRows: [], metodosFileName: null,
        metodoArchivos: [], ignorados: [],
      };

      for (const file of fileList) {
        const kind = detectVentasMensualFileKind(file.name);
        const rows = await readWorkbookRows(file);

        if (kind.kind === "lineas") {
          next.lineasRows = rows;
          next.lineasFileName = file.name;
        } else if (kind.kind === "metodos-catalogo") {
          next.metodosCatalogoRows = rows;
          next.metodosFileName = file.name;
        } else if (kind.kind === "metodo") {
          next.metodoArchivos.push({ codigo: kind.codigo, rows });
        } else {
          next.ignorados.push(file.name);
        }
      }

      setFicheros(next);
      setResultado(null);
      toast({
        title: "Ficheros cargados",
        description: `${formatNumber(fileList.length)} ficheros leidos: ${formatNumber(next.metodoArchivos.length)} de metodo${next.lineasFileName ? ", lineas detallado" : ""}${next.metodosFileName ? ", metodos de confeccion" : ""}.`,
      });
    } catch (error) {
      toast({ title: "No se pudieron leer los ficheros", description: errorMessage(error), variant: "destructive" });
    } finally {
      setLeyendoFicheros(false);
    }
  };

  const handleAnalizar = () => {
    if (!puedeAnalizar) {
      toast({
        title: "Faltan ficheros obligatorios",
        description: "Se necesita el fichero de lineas detallado y el de metodos de confeccion para analizar el mes.",
        variant: "destructive",
      });
      return;
    }

    const classified = classifyVentasMensual({
      lineasRows: ficheros.lineasRows,
      metodosCatalogoRows: ficheros.metodosCatalogoRows,
      metodoArchivos: ficheros.metodoArchivos,
      segundaCodigos,
    });
    setResultado(classified);
    setExcluidosLimit(15);
  };

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
      toast({
        title: "Ventas del mes importadas",
        description: `Categoria primera: ${formatNumber(primeraParsed.lineas.length)} lineas · Categoria segunda: ${formatNumber(segundaParsed.lineas.length)} lineas.`,
      });
    } catch (error) {
      toast({ title: "Error al importar", description: errorMessage(error), variant: "destructive" });
    } finally {
      setImportando(false);
    }
  };

  const excluidosVisibles = useMemo(
    () => (resultado ? resultado.excluidos.slice(0, excluidosLimit) : []),
    [resultado, excluidosLimit],
  );

  return (
    <div className="page-shell">
      <header className="page-header">
        <div>
          <p className="panel-kicker">Comercial</p>
          <h1 className="page-title">Ventas del mes</h1>
          <p className="page-subtitle">
            Sube de una vez los ficheros del mes y repártelos entre Categoría primera, Categoría segunda y Mercadona.
          </p>
        </div>
      </header>

      {/* ─── Ficheros ────────────────────────────────────────────────── */}
      <Card className="glass-accented overflow-hidden">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">1. Ficheros del mes</CardTitle>
          <p className="text-xs text-muted-foreground">
            Selecciona de golpe: el fichero de lineas detallado, el de metodos de confeccion y todos los ficheros por
            codigo de metodo (LN211.xlsx, L1020.xlsx, MA5KGC.xlsx...). Los de articulos/clientes son opcionales y se
            ignoran.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button asChild variant="outline" size="sm" className="h-9 cursor-pointer gap-1.5 rounded-md px-3 text-xs">
            <label>
              <Input className="hidden" type="file" accept=".xlsx,.xls" multiple onChange={handleFilesSelected} />
              <Upload className="h-3.5 w-3.5" />
              {leyendoFicheros ? "Leyendo ficheros..." : "Seleccionar ficheros del mes"}
            </label>
          </Button>

          <div className="grid gap-2 text-sm sm:grid-cols-2">
            <FicheroEstado
              ok={tieneLineas}
              label="Líneas detallado"
              detail={ficheros.lineasFileName ?? "No detectado"}
            />
            <FicheroEstado
              ok={tieneMetodosCatalogo}
              label="Métodos de confección"
              detail={ficheros.metodosFileName ?? "No detectado"}
            />
          </div>

          {ficheros.metodoArchivos.length > 0 ? (
            <div>
              <p className="mb-1.5 text-xs font-semibold text-muted-foreground">
                Ficheros de método detectados ({formatNumber(ficheros.metodoArchivos.length)})
              </p>
              <div className="flex flex-wrap gap-1.5">
                {ficheros.metodoArchivos.map((archivo) => (
                  <Badge key={archivo.codigo} variant="outline" className="font-mono text-[11px]">{archivo.codigo}</Badge>
                ))}
              </div>
            </div>
          ) : null}

          {ficheros.ignorados.length > 0 ? (
            <div>
              <p className="mb-1.5 text-xs font-semibold text-muted-foreground">
                Ignorados ({formatNumber(ficheros.ignorados.length)})
              </p>
              <div className="flex flex-wrap gap-1.5">
                {ficheros.ignorados.map((nombre) => (
                  <Badge key={nombre} variant="secondary" className="text-[11px] text-muted-foreground">{nombre}</Badge>
                ))}
              </div>
            </div>
          ) : null}

          {!puedeAnalizar && (ficheros.lineasFileName || ficheros.metodosFileName || ficheros.metodoArchivos.length > 0) ? (
            <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              Falta el fichero de {!tieneLineas && !tieneMetodosCatalogo ? "líneas detallado y de métodos de confección" : !tieneLineas ? "líneas detallado" : "métodos de confección"} para poder analizar.
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* ─── Codigos de categoria segunda ───────────────────────────────── */}
      <Card className="glass-accented overflow-hidden">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <CardTitle className="text-base">2. Códigos de categoría segunda</CardTitle>
            <InfoTooltip iconClassName="h-3.5 w-3.5">
              Métodos de confección fijos de categoría segunda. Se recuerdan de un mes al siguiente; edita la lista
              solo si el dueño del proceso decide cambiarla. Los métodos que empiezan por "MA" son siempre Mercadona,
              y el resto va a Categoría primera.
            </InfoTooltip>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          <Textarea
            value={segundaCodigos}
            onChange={(e) => setSegundaCodigos(e.target.value)}
            placeholder={METODOS_SEGUNDA_POR_DEFECTO}
            className="min-h-[60px] font-mono text-sm"
          />
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">Separados por comas. Se guardan para el próximo mes.</p>
            <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs" onClick={resetSegundaCodigos}>
              <RotateCcw className="h-3 w-3" /> Restablecer por defecto
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button className="gap-2" disabled={!puedeAnalizar} onClick={handleAnalizar}>
          <FileSpreadsheet className="h-4 w-4" /> Analizar
        </Button>
      </div>

      {/* ─── Preview ─────────────────────────────────────────────────── */}
      {resultado ? (
        <div className="space-y-4">
          <section className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            <BucketCard
              icon={Layers}
              label="Categoría primera"
              lineas={resultado.totales.primera.lineas}
              kilos={resultado.totales.primera.kilos}
              accent="primary"
            />
            <BucketCard
              icon={Layers}
              label="Categoría segunda"
              lineas={resultado.totales.segunda.lineas}
              kilos={resultado.totales.segunda.kilos}
              accent="success"
            />
            <BucketCard
              icon={ShoppingCart}
              label="Mercadona"
              lineas={resultado.totales.mercadona.lineas}
              kilos={resultado.totales.mercadona.kilos}
              accent="warning"
              hint="Se gestiona en su propia seccion; no se importa aqui."
            />
            <BucketCard
              icon={Ban}
              label="Excluidos (no producto)"
              lineas={resultado.totales.excluidos.lineas}
              kilos={resultado.totales.excluidos.kilos}
              accent="destructive"
            />
          </section>

          {resultado.ambiguas.length > 0 ? (
            <Card className="glass-accented overflow-hidden">
              <CardHeader className="pb-3">
                <div className="flex items-center gap-2">
                  <HelpCircle className="h-4 w-4 text-warning" />
                  <CardTitle className="text-base">Referencias ambiguas ({formatNumber(resultado.ambiguas.length)})</CardTitle>
                </div>
                <p className="text-xs text-muted-foreground">
                  Aparecen en ficheros de metodo de mas de una categoria. Se han clasificado por la categoria que suma
                  mas kilos (dominante); revisa si el reparto es correcto.
                </p>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-[13px]">
                    <thead className="border-b border-[var(--glass-border)] text-[10px] font-semibold uppercase tracking-wider text-muted-foreground [&>th]:px-3 [&>th]:py-1.5">
                      <tr>
                        <th>Referencia</th>
                        <th>Categorias (kg)</th>
                        <th>Dominante</th>
                      </tr>
                    </thead>
                    <tbody>
                      {resultado.ambiguas.map((ambigua, i) => (
                        <tr key={ambigua.referencia} className={cn("border-b border-[var(--glass-border)] last:border-b-0", i % 2 === 1 && "bg-[var(--glass-bg)]/40")}>
                          <td className="px-3 py-1.5 font-mono font-medium">{ambigua.referencia}</td>
                          <td className="px-3 py-1.5 text-muted-foreground">
                            {ambigua.categorias.map((c) => `${CATEGORIA_LABEL[c.categoria]} ${formatKg(c.kilos)}`).join(" · ")}
                          </td>
                          <td className="px-3 py-1.5">
                            <Badge variant="outline">{CATEGORIA_LABEL[ambigua.dominante]}</Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          ) : null}

          {resultado.excluidos.length > 0 ? (
            <Card className="glass-accented overflow-hidden">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Ejemplos de lineas excluidas</CardTitle>
                <p className="text-xs text-muted-foreground">
                  No se importan en ninguna categoria: kilos no positivos o articulo/referencia identificado como
                  embalaje, transporte o comision.
                </p>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-[13px]">
                    <thead className="border-b border-[var(--glass-border)] text-[10px] font-semibold uppercase tracking-wider text-muted-foreground [&>th]:px-3 [&>th]:py-1.5">
                      <tr>
                        <th>Artículo</th>
                        <th>Referencia</th>
                        <th className="text-right">Kilos</th>
                        <th>Motivo</th>
                      </tr>
                    </thead>
                    <tbody>
                      {excluidosVisibles.map((excluida, i) => (
                        <tr key={`${excluida.linea.referencia ?? ""}-${i}`} className={cn("border-b border-[var(--glass-border)] last:border-b-0", i % 2 === 1 && "bg-[var(--glass-bg)]/40")}>
                          <td className="px-3 py-1.5">{excluida.linea.articulo}</td>
                          <td className="px-3 py-1.5 font-mono text-muted-foreground">{excluida.linea.referencia ?? "—"}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums">{formatKg(Number(excluida.linea.kilos ?? 0))}</td>
                          <td className="px-3 py-1.5 text-muted-foreground">{excluida.motivo}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {resultado.excluidos.length > excluidosLimit ? (
                  <div className="p-3 text-center">
                    <Button variant="outline" size="sm" onClick={() => setExcluidosLimit((current) => current + 30)}>
                      Mostrar mas ({formatNumber(resultado.excluidos.length - excluidosLimit)} restantes)
                    </Button>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          ) : null}

          {/* ─── Importar ──────────────────────────────────────────────── */}
          <Card className="glass-accented">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">3. Importar</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                Importar reemplaza solo los meses incluidos en los ficheros; el resto de meses ya importados y los
                ajustes por cliente se conservan. Mercadona y los excluidos no se tocan desde aquí.
              </div>
              {!hasAccess ? (
                <p className="text-xs text-destructive">
                  Tu usuario no tiene acceso de importación a Categoría primera y/o Categoría segunda.
                </p>
              ) : null}
              <Button
                className="gap-2"
                disabled={!hasAccess || importando || ventasPrimera.importWorkbook.isPending || ventasSegunda.importWorkbook.isPending}
                onClick={handleImportar}
              >
                <Database className="h-4 w-4" />
                {importando ? "Importando..." : "Importar Categoría primera + Categoría segunda"}
              </Button>
            </CardContent>
          </Card>
        </div>
      ) : null}
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────

const CATEGORIA_LABEL: Record<"primera" | "segunda" | "mercadona", string> = {
  primera: "Primera",
  segunda: "Segunda",
  mercadona: "Mercadona",
};

function readStoredSegundaCodigos(): string {
  try {
    return window.localStorage.getItem(SEGUNDA_CODIGOS_STORAGE_KEY) || METODOS_SEGUNDA_POR_DEFECTO;
  } catch {
    return METODOS_SEGUNDA_POR_DEFECTO;
  }
}

async function readWorkbookRows(file: File): Promise<unknown[][]> {
  const data = await file.arrayBuffer();
  const workbook = XLSX.read(data, { type: "array", cellDates: false });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return [];
  return XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], { header: 1, raw: false, defval: "" });
}

function buildParseResult(
  lineasInput: VentasCategoriaLineaInput[],
  catalogo: VentasCategoriaCatalogoProducto[],
): ParseVentasCategoriaWorkbookResult {
  const lineas = lineasInput.map(normalizeVentasCategoriaLinea);
  return { lineas, catalogo, validation: validateVentasCategoriaImport({ lineas, catalogo }) };
}

function FicheroEstado({ ok, label, detail }: { ok: boolean; label: string; detail: string }) {
  return (
    <div className={cn(
      "flex items-start gap-2 rounded-lg border px-3 py-2",
      ok ? "border-success/30 bg-success/10" : "border-[var(--glass-border)] bg-[var(--glass-bg)]",
    )}>
      {ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />}
      <div className="min-w-0">
        <p className="text-xs font-semibold">{label}</p>
        <p className="truncate text-xs text-muted-foreground">{detail}</p>
      </div>
    </div>
  );
}

function BucketCard({ icon: Icon, label, lineas, kilos, accent, hint }: {
  icon: typeof Package;
  label: string;
  lineas: number;
  kilos: number;
  accent: "primary" | "success" | "warning" | "destructive";
  hint?: string;
}) {
  const accentText: Record<typeof accent, string> = {
    primary: "text-primary",
    success: "text-success",
    warning: "text-warning",
    destructive: "text-destructive",
  };
  return (
    <Card className="glass-accented overflow-hidden">
      <CardContent className="p-4">
        <div className="flex items-center gap-2">
          <Icon className={cn("h-4 w-4", accentText[accent])} />
          <p className="panel-kicker">{label}</p>
        </div>
        <p className="mt-2 text-xl font-bold tabular-nums leading-tight">{formatKg(kilos)}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{formatNumber(lineas)} lineas</p>
        {hint ? <p className="mt-1.5 text-[11px] text-muted-foreground">{hint}</p> : null}
      </CardContent>
    </Card>
  );
}
