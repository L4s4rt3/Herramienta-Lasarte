/**
 * TrazabilidadErpCard — de dónde viene la fruta y a dónde fue, según el ERP.
 *
 * Es la AUTORIDAD para el origen de un palet. Antes la ficha lo resolvía
 * volteando el código impreso, y eso no identifica la fruta: sobre 1.277 pares
 * reales el volteo no acierta ni una vez, y en el 64,8% de los casos apunta a
 * una entrada que existe pero NO es la de esa fruta (ver la cabecera de
 * src/lib/trazabilidadErp.ts y docs/ERP_LR_INFORMATICA.md).
 *
 * Dos reglas de presentación que no se negocian:
 *  - DOS CIFRAS: los kilos con origen conocido van siempre junto al total
 *    paletizado. El ERP solo tiene el enlace en el 57% de los kilos.
 *  - Lo prorrateado se dice: el ERP sabe qué entradas alimentaron un lote de
 *    confección, no de qué entrada salió cada palet. La lista de productores es
 *    un hecho; los kilos y euros repartidos son estimación y van etiquetados.
 */
import { ArrowRight, Boxes, Factory, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Link } from "react-router-dom";
import { formatEuro, formatKg, formatPct } from "@/lib/format";
import type { FichaConfeccion, FichaDestinoEntrada } from "@/lib/trazabilidadErp";

function Estimado() {
  return (
    <Badge variant="outline" className="ml-1.5 align-middle text-[10px] font-normal">
      estimado
    </Badge>
  );
}

/** El código consultado es un lote de CONFECCIÓN: de qué entradas salió. */
export function OrigenConfeccionErp({ ficha }: { ficha: FichaConfeccion }) {
  const cobertura = ficha.kgPalets > 0 ? (ficha.kgConOrigen / ficha.kgPalets) * 100 : null;
  return (
    <Card className="glass-accented">
      <CardContent className="space-y-4 py-5">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <Factory className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="font-semibold">Lote de confección {ficha.loteConfeccion}</span>
          <Badge variant="secondary" className="text-[10px] font-normal">según el ERP</Badge>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <p className="text-xs text-muted-foreground">Palets</p>
            <p className="text-lg font-semibold tabular-nums">{ficha.palets}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Kg paletizados</p>
            <p className="text-lg font-semibold tabular-nums">{formatKg(ficha.kgPalets)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Facturado</p>
            <p className="text-lg font-semibold tabular-nums">
              {ficha.euros != null ? formatEuro(ficha.euros) : "sin facturar"}
            </p>
          </div>
        </div>

        <div>
          <p className="mb-2 flex items-center gap-1.5 text-sm font-medium">
            <Users className="h-3.5 w-3.5 text-muted-foreground" /> Viene de
          </p>
          {ficha.origenes.length === 0 ? (
            <p className="text-sm text-muted-foreground">El ERP no tiene el origen de este lote.</p>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {ficha.origenes.map((o) => (
                <li key={o.loteEntrada} className="flex flex-wrap items-baseline gap-x-2">
                  <Link
                    to={`/trazabilidad?lote=${encodeURIComponent(o.loteEntrada)}`}
                    className="font-medium underline-offset-2 hover:underline"
                  >
                    {o.loteEntrada}
                  </Link>
                  <span className={o.desconocido ? "text-muted-foreground" : "font-medium"}>
                    {o.agricultor ?? "productor no registrado en la app"}
                  </span>
                  {o.finca && <span className="text-muted-foreground">· {o.finca}</span>}
                  <span className="ml-auto tabular-nums text-muted-foreground">{formatKg(o.kgAtribuidos)}</span>
                </li>
              ))}
            </ul>
          )}
          {cobertura != null && (
            <p className="mt-2 text-xs text-muted-foreground">
              El ERP atribuye origen a {formatKg(ficha.kgConOrigen)} de los {formatKg(ficha.kgPalets)} paletizados
              {" "}({formatPct(cobertura)}). El resto no tiene elaboración registrada: no es que no exista, es que
              el ERP no lo enlazó.
            </p>
          )}
        </div>

        {ficha.clientes.length > 0 && (
          <div>
            <p className="mb-2 flex items-center gap-1.5 text-sm font-medium">
              <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" /> Se vendió a
            </p>
            <ul className="space-y-1 text-sm">
              {ficha.clientes.map((c) => (
                <li key={c.cliente} className="flex flex-wrap items-baseline gap-x-2">
                  <span className={c.cliente === "(sin vender)" ? "text-muted-foreground" : "font-medium"}>
                    {c.cliente}
                  </span>
                  <span className="ml-auto tabular-nums text-muted-foreground">
                    {formatKg(c.kgEstimados)}
                    {c.eurosEstimados != null && ` · ${formatEuro(c.eurosEstimados)}`}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** El código consultado es un lote de ENTRADA: a dónde fue su fruta. */
export function DestinoEntradaErp({ ficha }: { ficha: FichaDestinoEntrada }) {
  if (ficha.confecciones.length === 0) return null;
  return (
    <Card className="glass-accented">
      <CardContent className="space-y-4 py-5">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <Boxes className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="font-semibold">A dónde fue esta fruta</span>
          <Badge variant="secondary" className="text-[10px] font-normal">según el ERP</Badge>
        </div>

        <div>
          <p className="mb-2 text-sm font-medium">Se confeccionó en</p>
          <ul className="space-y-1.5 text-sm">
            {ficha.confecciones.map((c) => (
              <li key={c.loteConfeccion} className="flex flex-wrap items-baseline gap-x-2">
                <Link
                  to={`/trazabilidad?lote=${encodeURIComponent(c.loteConfeccion)}`}
                  className="font-medium underline-offset-2 hover:underline"
                >
                  {c.loteConfeccion}
                </Link>
                <span className="text-muted-foreground">{c.palets} palets</span>
                <span className="ml-auto tabular-nums text-muted-foreground">
                  {formatKg(c.kgAtribuidos)} de {formatKg(c.kgLoteConfeccion)} del lote
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <p className="mb-2 text-sm font-medium">
            Clientes<Estimado />
          </p>
          <ul className="space-y-1 text-sm">
            {ficha.clientes.map((c) => (
              <li key={c.cliente} className="flex flex-wrap items-baseline gap-x-2">
                <span className={c.cliente === "(sin vender)" ? "text-muted-foreground" : "font-medium"}>
                  {c.cliente}
                </span>
                <span className="ml-auto tabular-nums text-muted-foreground">
                  {formatKg(c.kgEstimados)}
                  {c.eurosEstimados != null && ` · ${formatEuro(c.eurosEstimados)}`}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted-foreground">
            El ERP dice qué entradas alimentaron cada lote de confección, pero no de qué entrada salió cada palet:
            estos kilos y euros están repartidos a peso. Lo seguro es la lista de clientes, no la cifra.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
