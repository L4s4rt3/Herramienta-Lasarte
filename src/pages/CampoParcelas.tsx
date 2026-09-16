// Campo → Parcelas (16-09-2026).
//
// LA PREGUNTA DE ESTA PÁGINA: ¿qué ha dado cada parcela? Es el eje que faltaba.
// La herramienta miraba por día, por lote, por productor y por cliente, pero
// nunca por el trozo de campo del que sale la fruta.
//
// NO DUPLICA "Análisis → Por productor". Aquella pregunta es del productor
// (cuánto aprovecha su fruta, con todo el detalle de clases, calibres y
// Mercadona); esta es del campo: el catálogo de parcelas, quién las lleva, qué
// variedad tienen y cuándo entregaron. Al abrir una parcela se enseña el
// resumen de aprovechamiento —los MISMOS números, del mismo hook, sin recalcular
// nada— y el enlace al análisis completo para quien pueda entrar.
//
// DE DÓNDE SALE CADA COSA
// - Finca, parcela, agricultor, variedad, kg y fechas: entradas de báscula
//   (useEntradasBascula → solo entradas externas, sin precalibrado ni CAMPO/CIT).
// - Kg pesados por el calibrador, cobertura y destinos: useAprovechamientoReal,
//   el mismo hook que la pestaña "Aprovechamiento real por parcela".
// - Hectáreas, variedad plantada y contorno: campo_parcelas, cargada con los
//   shapefiles que Aerobotics deja descargar (16-09-2026). Su API es de pago y
//   está descartada.
// - Árboles, marras, vigor y previsión de calibre: NO HAY. Eso sigue solo en la
//   web de Aeroview.
//
// LOS KILOS POR HECTÁREA son la razón de ser de esta página: la báscula sabe
// los kilos y Aerobotics las hectáreas, y hasta ahora nadie los había dividido
// porque no estaban en el mismo sitio. Solo se calculan sobre emparejamientos
// de confianza, y la cifra imposible se marca en vez de esconderse: cuando sale
// un disparate no es que la parcela sea rara, es que el emparejamiento está mal
// o Aerobotics solo tiene dibujado un trozo.
//
// SIN EUROS A PROPÓSITO. Las entradas de báscula traen precio de compra,
// recolección y comisión. Esta página es de campo, no de compras: no se pintan.
import { lazy, Suspense, useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowLeft, ExternalLink, Search, Sprout, Trees } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAuth } from "@/contexts/AuthProvider";
import { useCampoParcelas } from "@/hooks/useCampoParcelas";
import { useEntradasBascula } from "@/hooks/useEntradasBascula";
import {
  buscarParcelas, catalogoParcelas, totalesCampo, totalesParcelas, unirFichasDeCampo,
  type TotalesCampo,
} from "@/lib/campoParcelas";
import { formatDate, formatKg, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

const FichaParcela = lazy(() => import("@/components/campo/FichaParcela"));

const diaTxt = (v: string | null) => (v ? formatDate(v) : "—");
const haTxt = (v: number | null | undefined) => (v == null ? "—" : `${formatNumber(v, 2)} ha`);

/**
 * Qué se sabe hoy del campo y qué falta. Va arriba, una vez, y no se repite por
 * fila: la media de kg/ha con cuántas parcelas la sostienen, cuántas están sin
 * confirmar y qué dato sigue sin entrar.
 */
function EstadoDelDatoDeCampo({ totales, sinFicha }: { totales: TotalesCampo; sinFicha: number }) {
  return (
    <Card className="border-dashed">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Trees className="h-4 w-4" /> Lo que se sabe del campo
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm text-muted-foreground">
        {totales.conHectareas === 0 ? (
          <p>
            Todavía no hay hectáreas cargadas de ninguna parcela, así que no se pueden calcular kilos por
            hectárea. Se cargan con los ficheros que Aerobotics deja descargar por finca.
          </p>
        ) : totales.parcelasCreibles === 0 || totales.kgPorHaMedio == null ? (
          <p>
            Hay hectáreas de {formatNumber(totales.conHectareas)} parcelas, pero ninguna da un rendimiento
            posible: los emparejamientos con Aerobotics hay que revisarlos antes de dar una media.
          </p>
        ) : (
          <p>
            <span className="font-medium text-foreground">
              {formatNumber(totales.parcelasCreibles)} parcelas dan una cifra creíble: {formatKg(totales.kgCreibles)} en{" "}
              {formatNumber(totales.hectareasCreibles, 2)} ha, {formatNumber(totales.kgPorHaMedio)} kg/ha de media.
            </span>{" "}
            Las hectáreas y el contorno vienen de Aerobotics; los kilos, de la báscula.
            {totales.aRevisar > 0 && (
              <>
                {" "}Otras {formatNumber(totales.aRevisar)} dan una cifra imposible y van marcadas en rojo: no es que
                la parcela sea rara, es que el emparejamiento está mal o Aerobotics solo tiene dibujado un trozo de
                lo que la báscula llama esa parcela.
              </>
            )}
          </p>
        )}
        {sinFicha > 0 && (
          <p>
            {formatNumber(sinFicha)} parcelas siguen sin ficha de campo: o no están dibujadas en Aerobotics, o su
            emparejamiento todavía no es de fiar y no se le pueden echar los kilos encima.
          </p>
        )}
        <p>
          Lo que sigue sin entrar: árboles, marras, vigor de la hoja y previsión de calibre. Eso solo está en la
          web de Aeroview.
        </p>
      </CardContent>
    </Card>
  );
}

export default function CampoParcelas() {
  const { role } = useAuth();
  const { entradas, isLoading } = useEntradasBascula();
  const { fichas } = useCampoParcelas();
  const [params, setParams] = useSearchParams();

  const busqueda = params.get("q") ?? "";
  const claveElegida = params.get("parcela");

  const filas = useMemo(() => unirFichasDeCampo(catalogoParcelas(entradas), fichas), [entradas, fichas]);
  const visibles = useMemo(() => buscarParcelas(filas, busqueda), [filas, busqueda]);
  const totales = useMemo(() => totalesParcelas(visibles), [visibles]);
  const campo = useMemo(() => totalesCampo(visibles), [visibles]);
  const sinFicha = useMemo(() => visibles.filter((f) => f.campo.hectareas == null).length, [visibles]);
  const elegida = useMemo(() => filas.find((f) => f.clave === claveElegida) ?? null, [filas, claveElegida]);

  const set = (cambios: Record<string, string | null>) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      for (const [k, v] of Object.entries(cambios)) {
        if (v == null || v === "") next.delete(k);
        else next.set(k, v);
      }
      return next;
    }, { replace: true });
  };

  if (elegida) {
    return (
      <div className="mx-auto w-full max-w-6xl space-y-4 p-3 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <Button variant="ghost" size="sm" className="mb-1 -ml-2" onClick={() => set({ parcela: null })}>
              <ArrowLeft className="mr-1 h-4 w-4" /> Todas las parcelas
            </Button>
            <h1 className="text-2xl font-semibold">{elegida.etiqueta}</h1>
            <p className="text-sm text-muted-foreground">
              {elegida.finca}
              {elegida.agricultor ? ` · ${elegida.agricultor}` : ""}
            </p>
          </div>
          {/* El análisis completo (clases, calibres, Mercadona, lote a lote) vive
              en Análisis → Por productor, que es de admin: el enlace solo se
              pinta a quien puede entrar, para no mandar a nadie a un muro. */}
          {role === "admin" && (
            <Button asChild variant="outline" size="sm">
              <Link to={`/productores?vista=aprovechamiento-real&finca=${encodeURIComponent(elegida.finca)}&parcelas=${encodeURIComponent(elegida.parcela || "~")}`}>
                Análisis completo <ExternalLink className="ml-1 h-3.5 w-3.5" />
              </Link>
            </Button>
          )}
        </div>

        <Suspense fallback={<Skeleton className="h-64 w-full" />}>
          <FichaParcela fila={elegida} />
        </Suspense>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-4 p-3 sm:p-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold"><Sprout className="h-6 w-6" /> Parcelas</h1>
        <p className="text-sm text-muted-foreground">
          Una fila por parcela, con lo que ha entrado de ella esta campaña. Sale de las entradas de báscula:
          una parcela aparece aquí porque ha entregado fruta. Pulsa una para ver qué dio en el calibrador.
        </p>
      </div>

      <EstadoDelDatoDeCampo totales={campo} sinFicha={sinFicha} />

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={busqueda}
          onChange={(e) => set({ q: e.target.value })}
          placeholder="Buscar por finca, parcela, agricultor o variedad…"
          className="pl-9"
        />
      </div>

      {isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">
              {formatNumber(totales.parcelas)} parcelas de {formatNumber(totales.fincas)} fincas ·{" "}
              {formatNumber(totales.entradas)} entradas · {formatKg(totales.kgEntrada)}
            </CardTitle>
            {totales.sinParcela > 0 && (
              <p className="text-xs text-muted-foreground">
                {totales.sinParcela === 1
                  ? "1 fila es de entradas que llegaron sin nombre de parcela."
                  : `${formatNumber(totales.sinParcela)} filas son de entradas que llegaron sin nombre de parcela.`}{" "}
                No es un fallo del cálculo: la báscula no lo apuntó.
              </p>
            )}
          </CardHeader>
          <CardContent className="px-0 sm:px-6">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Finca</TableHead>
                    <TableHead>Parcela</TableHead>
                    <TableHead>Agricultor</TableHead>
                    <TableHead>Variedad</TableHead>
                    <TableHead className="text-right">Entradas</TableHead>
                    <TableHead className="text-right">Kg entrados</TableHead>
                    <TableHead className="text-right whitespace-nowrap">Hectáreas</TableHead>
                    <TableHead className="text-right whitespace-nowrap">Kg por ha</TableHead>
                    <TableHead className="whitespace-nowrap">Primera</TableHead>
                    <TableHead className="whitespace-nowrap">Última</TableHead>
                    <TableHead>GGN</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibles.map((f) => (
                    <TableRow
                      key={f.clave}
                      className="cursor-pointer"
                      onClick={() => set({ parcela: f.clave })}
                    >
                      <TableCell className="whitespace-nowrap">{f.finca}</TableCell>
                      <TableCell className={cn("font-medium", !f.parcela && "italic text-muted-foreground")}>
                        {f.etiqueta}
                      </TableCell>
                      <TableCell className="max-w-[16rem] truncate text-muted-foreground">{f.agricultor || "—"}</TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {f.variedades[0] ?? "—"}
                        {f.variedades.length > 1 && <span className="text-xs"> +{f.variedades.length - 1}</span>}
                      </TableCell>
                      <TableCell className="text-right">{formatNumber(f.entradas)}</TableCell>
                      <TableCell className="text-right font-medium">{formatKg(f.kgEntrada)}</TableCell>
                      <TableCell className="whitespace-nowrap text-right">
                        {haTxt(f.campo.hectareas)}
                        {f.campo.trozos > 1 && (
                          <span className="text-xs text-muted-foreground"> ({f.campo.trozos} trozos)</span>
                        )}
                      </TableCell>
                      {/* En rojo lo imposible: es una señal de que el emparejamiento
                          hay que mirarlo, no una parcela mala. */}
                      <TableCell
                        className={cn(
                          "whitespace-nowrap text-right",
                          f.campo.rendimientoIncreible && "font-medium text-red-600 dark:text-red-400",
                        )}
                        title={f.campo.rendimientoIncreible ? "Esta cifra no es posible: revisar el emparejamiento con Aerobotics" : undefined}
                      >
                        {f.campo.kgPorHa == null ? "—" : formatNumber(f.campo.kgPorHa)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">{diaTxt(f.primera)}</TableCell>
                      <TableCell className="whitespace-nowrap">{diaTxt(f.ultima)}</TableCell>
                      <TableCell>
                        {f.entradasCertificadas > 0 ? (
                          <Badge variant="outline" className="whitespace-nowrap">
                            {f.entradasCertificadas === f.entradas ? "Sí" : `${f.entradasCertificadas}/${f.entradas}`}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                  {visibles.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={11} className="py-8 text-center text-sm text-muted-foreground">
                        Ninguna parcela cuadra con «{busqueda}».
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
