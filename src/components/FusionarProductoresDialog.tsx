// src/components/FusionarProductoresDialog.tsx
// "Fusionar productores duplicados" (solo admin, página Productores): el
// catálogo calidad_productores acumuló el mismo productor real varias veces
// con variantes del nombre ("EL ESPARRAGAL" / "EL ESPARRAGAL S.A." / "LASARTE
// EXPORT EL ESPARRAGAL"…) — herencia del backfill por nombre de 3 fuentes más
// los nombres oficiales del informe del ERP. Este diálogo agrupa las variantes
// por nombre base (src/lib/fusionProductores.ts), el admin confirma cada grupo
// y al aplicar:
//
//   1. Re-apunta al canónico TODAS las referencias del duplicado:
//      entradas_bascula.productor_id, lotes_dia.productor_id,
//      calidad_lotes.productor_finca_id, calidad_referencias_productor.productor_id,
//      contactos_campo.productor_id y productores_alias.productor_id.
//   2. Añade el nombre del duplicado como alias del canónico (los textos
//      futuros de báscula/calibrador con esa variante resolverán solos).
//   3. Borra el productor duplicado del catálogo.
//
// El canónico de cada grupo es el que más filas vinculadas tiene (tras la
// conciliación con el ERP, ese es el del nombre oficial del informe).
import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AlertTriangle, CheckCircle2, Loader2, Merge, Plus, X } from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/hooks/use-toast";
import { useProductoresCatalogo } from "@/hooks/useProductoresCatalogo";
import { errorMessage, toError } from "@/lib/errorMessage";
import { fetchAllRows } from "@/lib/fetchAllRows";
import { formatNumber } from "@/lib/format";
import {
  detectarDuplicadosProductores, parPorReferencias, resolverCadenaFusiones,
  type DeteccionDuplicados, type FusionPar, type ProductorFusionInput,
} from "@/lib/fusionProductores";
import { esErrorTablaOColumnaInexistente, normalizeProductorName } from "@/lib/productoresCanonicos";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

// Cast local: columnas productor_id aún no están en el Database generado
// (mismo patrón que useProductoresCatalogo.ts).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const SUPA = supabase as unknown as SupabaseClient<any>;

/** Tablas cuyo vínculo al productor se re-apunta al fusionar. Las marcadas opcionales pueden no existir aún (migración pendiente): se toleran. */
const TABLAS_REFERENCIA: Array<{ tabla: string; columna: string; opcional: boolean }> = [
  { tabla: "productores_alias", columna: "productor_id", opcional: true },
  { tabla: "entradas_bascula", columna: "productor_id", opcional: false },
  { tabla: "lotes_dia", columna: "productor_id", opcional: false },
  { tabla: "calidad_lotes", columna: "productor_finca_id", opcional: false },
  { tabla: "calidad_referencias_productor", columna: "productor_id", opcional: true },
  { tabla: "contactos_campo", columna: "productor_id", opcional: true },
];

interface FusionarProductoresDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function FusionarProductoresDialog({ open, onOpenChange }: FusionarProductoresDialogProps) {
  const queryClient = useQueryClient();
  const { productores, isLoading: cargandoCatalogo } = useProductoresCatalogo();

  const [referencias, setReferencias] = useState<Map<string, number> | null>(null);
  const [cargandoRefs, setCargandoRefs] = useState(false);
  const [seleccion, setSeleccion] = useState<Set<string>>(() => new Set());
  /** Destino elegido por el admin para cada caso ambiguo (productorId → id destino). */
  const [eleccionAmbiguos, setEleccionAmbiguos] = useState<Map<string, string>>(() => new Map());
  /** Fusiones añadidas a mano por el admin (casos que ninguna regla puede deducir). */
  const [fusionesManuales, setFusionesManuales] = useState<FusionPar[]>([]);
  const [manualDupId, setManualDupId] = useState("");
  const [manualCanonId, setManualCanonId] = useState("");
  const [aplicando, setAplicando] = useState(false);
  const [progreso, setProgreso] = useState<{ hecho: number; total: number } | null>(null);
  const [fusionados, setFusionados] = useState<number | null>(null);

  // Nº de filas vinculadas por productor (báscula + calibrador): decide el
  // canónico de cada grupo y da contexto en la lista.
  useEffect(() => {
    if (!open || referencias || cargandoRefs) return;
    setCargandoRefs(true);
    (async () => {
      try {
        const [entradas, lotes] = await Promise.all([
          fetchAllRows<{ id: string; productor_id: string | null }>((from, to) =>
            SUPA.from("entradas_bascula").select("id, productor_id").order("id").range(from, to),
          ),
          fetchAllRows<{ id: string; productor_id: string | null }>((from, to) =>
            SUPA.from("lotes_dia").select("id, productor_id").order("id").range(from, to),
          ),
        ]);
        const conteo = new Map<string, number>();
        for (const r of [...entradas, ...lotes]) {
          if (r.productor_id) conteo.set(r.productor_id, (conteo.get(r.productor_id) ?? 0) + 1);
        }
        setReferencias(conteo);
      } catch (e) {
        toast({ title: "No se pudieron contar las referencias", description: errorMessage(e), variant: "destructive" });
      } finally {
        setCargandoRefs(false);
      }
    })();
  }, [open, referencias, cargandoRefs]);

  const deteccion: DeteccionDuplicados = useMemo(() => {
    if (!referencias) return { grupos: [], ambiguos: [] };
    return detectarDuplicadosProductores(
      productores.map((p) => ({ id: p.id, nombre: p.nombre, referencias: referencias.get(p.id) ?? 0 })),
    );
  }, [productores, referencias]);
  const grupos = deteccion.grupos;

  // Al calcular los grupos por primera vez, todos marcados (el caso normal es fusionarlo todo).
  useEffect(() => {
    if (grupos.length > 0 && seleccion.size === 0 && fusionados === null) {
      setSeleccion(new Set(grupos.map((g) => g.base)));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grupos]);

  function toggleGrupo(base: string) {
    setSeleccion((prev) => {
      const next = new Set(prev);
      if (next.has(base)) next.delete(base);
      else next.add(base);
      return next;
    });
  }

  const gruposSeleccionados = grupos.filter((g) => seleccion.has(g.base));

  /** Catálogo con referencias, ordenado por nombre (para los selectores manuales). */
  const catalogoConRefs: ProductorFusionInput[] = useMemo(
    () =>
      productores
        .map((p) => ({ id: p.id, nombre: p.nombre, referencias: referencias?.get(p.id) ?? 0 }))
        .sort((a, b) => a.nombre.localeCompare(b.nombre)),
    [productores, referencias],
  );

  /** codigo_erp por ficha (migración 20260721120000; puede no existir aún). El código es la identidad principal: al fusionar no puede perderse. */
  const codigoPorId = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of productores) {
      const codigo = (p as { codigo_erp?: string | null }).codigo_erp;
      if (codigo) map.set(p.id, codigo);
    }
    return map;
  }, [productores]);

  // Fusiones a aplicar: duplicados de los grupos marcados + ambiguos con
  // destino elegido (se conserva SIEMPRE la ficha con más datos) + fusiones
  // manuales. resolverCadenaFusiones sanea el conjunto: resuelve destinos en
  // cadena, corta ciclos y evita fusionar dos veces la misma ficha.
  const fusiones = useMemo(() => {
    const pares: FusionPar[] = [];
    for (const g of gruposSeleccionados) {
      for (const d of g.duplicados) pares.push({ dup: d, canon: g.canonico });
    }
    for (const a of deteccion.ambiguos) {
      const targetId = eleccionAmbiguos.get(a.productor.id);
      if (!targetId) continue;
      const target = a.candidatos.find((c) => c.id === targetId);
      if (!target) continue;
      pares.push(parPorReferencias(a.productor, target));
    }
    pares.push(...fusionesManuales);
    return resolverCadenaFusiones(pares);
  }, [gruposSeleccionados, deteccion.ambiguos, eleccionAmbiguos, fusionesManuales]);

  const totalDuplicados = fusiones.length;

  function añadirFusionManual() {
    const dup = catalogoConRefs.find((p) => p.id === manualDupId);
    const canon = catalogoConRefs.find((p) => p.id === manualCanonId);
    if (!dup || !canon || dup.id === canon.id) return;
    setFusionesManuales((prev) => [...prev, { dup, canon }]);
    setManualDupId("");
    setManualCanonId("");
  }

  const aplicar = async () => {
    if (fusiones.length === 0) return;
    setAplicando(true);
    try {
      // pasos: por duplicado = re-apuntar tablas + alias nuevo + delete
      const totalPasos = totalDuplicados * (TABLAS_REFERENCIA.length + 2);
      let hecho = 0;
      const avanza = () => { hecho += 1; setProgreso({ hecho, total: totalPasos }); };
      setProgreso({ hecho: 0, total: totalPasos });

      for (const { dup, canon } of fusiones) {
        // 1. Re-apuntar todas las referencias del duplicado al canónico.
        for (const { tabla, columna, opcional } of TABLAS_REFERENCIA) {
          const { error } = await SUPA.from(tabla).update({ [columna]: canon.id }).eq(columna, dup.id);
          if (error && !(opcional && esErrorTablaOColumnaInexistente(error))) throw toError(error);
          avanza();
        }
        // 2. El nombre del duplicado pasa a ser alias del canónico (si ese
        //    texto no tiene ya un alias, p. ej. uno re-apuntado en el paso 1).
        const norm = normalizeProductorName(dup.nombre);
        if (norm) {
          const { error } = await SUPA.from("productores_alias").upsert(
            { productor_id: canon.id, alias: dup.nombre, alias_normalizado: norm, origen: "manual" },
            { onConflict: "alias_normalizado", ignoreDuplicates: true },
          );
          if (error && !esErrorTablaOColumnaInexistente(error)) throw toError(error);
        }
        avanza();
        // 3. Preservar el código ERP: si el duplicado lo tiene y el canónico
        //    no, se traspasa (liberando antes el del duplicado: índice único).
        const dupCodigo = codigoPorId.get(dup.id);
        if (dupCodigo && !codigoPorId.get(canon.id)) {
          const libera = await SUPA.from("calidad_productores").update({ codigo_erp: null }).eq("id", dup.id);
          if (!libera.error) {
            const traspasa = await SUPA.from("calidad_productores").update({ codigo_erp: dupCodigo }).eq("id", canon.id);
            if (traspasa.error && !esErrorTablaOColumnaInexistente(traspasa.error)) throw toError(traspasa.error);
          } else if (!esErrorTablaOColumnaInexistente(libera.error)) {
            throw toError(libera.error);
          }
        }
        // 4. Borrar el duplicado del catálogo.
        const { error: delError } = await SUPA.from("calidad_productores").delete().eq("id", dup.id);
        if (delError) throw toError(delError);
        avanza();
      }

      queryClient.invalidateQueries({ queryKey: ["entradas_bascula"] });
      queryClient.invalidateQueries({ queryKey: ["productores-catalogo"] });
      queryClient.invalidateQueries({ queryKey: ["productores-alias"] });
      queryClient.invalidateQueries({ queryKey: ["productores-pendientes"] });

      setFusionados(totalDuplicados);
      setReferencias(null); // fuerza recuento si se reabre
      setSeleccion(new Set());
      setEleccionAmbiguos(new Map());
      setFusionesManuales([]);
      toast({
        title: "Catálogo depurado",
        description: `${totalDuplicados} fichas duplicadas fusionadas.`,
      });
    } catch (e) {
      toast({ title: "Error al fusionar", description: errorMessage(e), variant: "destructive" });
    } finally {
      setAplicando(false);
      setProgreso(null);
    }
  };

  const cargando = cargandoCatalogo || cargandoRefs || (open && !referencias && fusionados === null);

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!aplicando) { onOpenChange(v); if (!v) { setFusionados(null); setReferencias(null); setSeleccion(new Set()); setEleccionAmbiguos(new Map()); setFusionesManuales([]); } } }}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Merge className="h-4 w-4" /> Fusionar productores duplicados
          </DialogTitle>
          <DialogDescription>
            Variantes del mismo productor ("EL ESPARRAGAL" / "EL ESPARRAGAL S.A."…) se fusionan en una sola ficha:
            todos sus lotes, entradas, calidad y contactos pasan al nombre que se conserva, y las variantes quedan
            como alias para que no vuelvan a duplicarse.
          </DialogDescription>
        </DialogHeader>

        {fusionados !== null && (
          <div className="flex items-center gap-2 rounded-lg border border-success/30 bg-success/10 p-3 text-sm font-medium text-success">
            <CheckCircle2 className="h-4 w-4" /> {fusionados} duplicados fusionados. El catálogo queda limpio.
          </div>
        )}

        {cargando && fusionados === null && (
          <div className="space-y-2">
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
          </div>
        )}

        {!cargando && fusionados === null && (
          <div className="space-y-3">
            {grupos.length === 0 && deteccion.ambiguos.length === 0 && (
              <p className="flex items-center gap-2 text-sm font-medium text-success">
                <CheckCircle2 className="h-4 w-4" /> No se han detectado duplicados automáticos. Puedes añadir fusiones a mano abajo.
              </p>
            )}
            {grupos.length > 0 && (
              <p className="text-xs text-muted-foreground">
                {grupos.length} grupo{grupos.length === 1 ? "" : "s"} detectado{grupos.length === 1 ? "" : "s"}. En cada uno
                se conserva <span className="font-medium text-foreground">el nombre con más datos</span> (normalmente el del
                informe del ERP). Desmarca los grupos que NO quieras fusionar.
              </p>
            )}

            <div className="max-h-80 space-y-1.5 overflow-y-auto pr-1">
              {grupos.map((g) => (
                <label
                  key={g.base}
                  className={cn(
                    "flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2 transition-colors",
                    seleccion.has(g.base) ? "border-primary/40 bg-primary/5" : "border-[var(--glass-border)] bg-[var(--glass-bg)] opacity-70",
                  )}
                >
                  <Checkbox
                    checked={seleccion.has(g.base)}
                    onCheckedChange={() => toggleGrupo(g.base)}
                    disabled={aplicando}
                    className="mt-0.5"
                  />
                  <div className="min-w-0 text-sm">
                    <p className="font-semibold">
                      {g.canonico.nombre}
                      <Badge variant="secondary" className="ml-1.5 px-1.5 py-0 text-[10px]">{formatNumber(g.canonico.referencias)} filas</Badge>
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      absorbe: {g.duplicados.map((d) => `${d.nombre} (${formatNumber(d.referencias)})`).join(" · ")}
                    </p>
                  </div>
                </label>
              ))}
            </div>

            {/* ─── Casos ambiguos: el nombre encaja con varios productores ── */}
            {deteccion.ambiguos.length > 0 && (
              <div className="space-y-1.5 rounded-lg border border-warning/40 bg-warning/5 p-3">
                <p className="flex items-center gap-1.5 text-sm font-semibold">
                  <AlertTriangle className="h-3.5 w-3.5 text-warning" />
                  {deteccion.ambiguos.length} nombre{deteccion.ambiguos.length === 1 ? "" : "s"} con varios destinos posibles
                </p>
                <p className="text-xs text-muted-foreground">
                  Estos nombres encajan con más de un productor y no se fusionan a ciegas: elige tú el destino
                  (o déjalo en "No fusionar" si no lo tienes claro).
                </p>
                <div className="space-y-1.5 pt-1">
                  {deteccion.ambiguos.map((a) => (
                    <div key={a.productor.id} className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="min-w-0 flex-1 truncate font-medium" title={a.productor.nombre}>
                        {a.productor.nombre}
                        <Badge variant="secondary" className="ml-1.5 px-1.5 py-0 text-[10px]">{formatNumber(a.productor.referencias)} filas</Badge>
                      </span>
                      <Select
                        value={eleccionAmbiguos.get(a.productor.id) ?? "no"}
                        onValueChange={(v) =>
                          setEleccionAmbiguos((prev) => {
                            const next = new Map(prev);
                            if (v === "no") next.delete(a.productor.id);
                            else next.set(a.productor.id, v);
                            return next;
                          })
                        }
                        disabled={aplicando}
                      >
                        <SelectTrigger className="h-7 w-64 text-xs">
                          <SelectValue placeholder="No fusionar" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="no" className="text-xs text-muted-foreground">No fusionar</SelectItem>
                          {a.candidatos.map((c) => (
                            <SelectItem key={c.id} value={c.id} className="text-xs">
                              {c.nombre} ({formatNumber(c.referencias)} filas)
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ─── Fusión manual: para lo que ninguna regla puede saber ───── */}
            {/* (p. ej. "EL CARRASCAL PACHECO" = "El Carrascal", o la finca
                "BARROS" que pertenece a Frutas Moratalla - FRUBEZAR). */}
            <div className="space-y-2 rounded-lg border border-[var(--glass-border)] bg-[var(--glass-bg)] p-3">
              <p className="text-sm font-semibold">Fusión manual</p>
              <p className="text-xs text-muted-foreground">
                Para duplicados que solo tú puedes saber que son el mismo productor. Todos los datos de la ficha que
                sobra pasan a la que se conserva, y su nombre queda como alias.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <Select value={manualDupId} onValueChange={setManualDupId} disabled={aplicando}>
                  <SelectTrigger className="h-8 w-full text-xs sm:w-56">
                    <SelectValue placeholder="Ficha que sobra..." />
                  </SelectTrigger>
                  <SelectContent>
                    {catalogoConRefs.filter((p) => p.id !== manualCanonId).map((p) => (
                      <SelectItem key={p.id} value={p.id} className="text-xs">
                        {p.nombre} ({formatNumber(p.referencias)})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <span className="text-xs text-muted-foreground">se fusiona en</span>
                <Select value={manualCanonId} onValueChange={setManualCanonId} disabled={aplicando}>
                  <SelectTrigger className="h-8 w-full text-xs sm:w-56">
                    <SelectValue placeholder="Ficha que se conserva..." />
                  </SelectTrigger>
                  <SelectContent>
                    {catalogoConRefs.filter((p) => p.id !== manualDupId).map((p) => (
                      <SelectItem key={p.id} value={p.id} className="text-xs">
                        {p.nombre} ({formatNumber(p.referencias)})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8"
                  onClick={añadirFusionManual}
                  disabled={aplicando || !manualDupId || !manualCanonId || manualDupId === manualCanonId}
                >
                  <Plus className="h-3.5 w-3.5" /> Añadir
                </Button>
              </div>
              {fusionesManuales.length > 0 && (
                <ul className="space-y-1 pt-1 text-xs">
                  {fusionesManuales.map((f, i) => (
                    <li key={`${f.dup.id}-${i}`} className="flex items-center gap-2">
                      <button
                        type="button"
                        className="text-muted-foreground transition-colors hover:text-destructive"
                        onClick={() => setFusionesManuales((prev) => prev.filter((_, j) => j !== i))}
                        disabled={aplicando}
                        title="Quitar esta fusión"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                      <span className="min-w-0 truncate">
                        "{f.dup.nombre}" → <span className="font-medium">{f.canon.nombre}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {progreso && (
              <div className="space-y-1">
                <Progress value={progreso.total > 0 ? (progreso.hecho / progreso.total) * 100 : 0} />
                <p className="text-right text-xs tabular-nums text-muted-foreground">{progreso.hecho} / {progreso.total}</p>
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-1">
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button size="sm" disabled={aplicando || totalDuplicados === 0}>
                    {aplicando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Merge className="h-3.5 w-3.5" />}
                    Fusionar {formatNumber(totalDuplicados)} duplicado{totalDuplicados === 1 ? "" : "s"}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle className="flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4 text-warning" /> ¿Fusionar los duplicados?
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                      Se fusionarán {formatNumber(totalDuplicados)} fichas duplicadas en{" "}
                      {new Set(fusiones.map((f) => f.canon.id)).size} productores.
                      Sus lotes, entradas, calidad y contactos pasan al nombre conservado y las fichas sobrantes se borran.
                      Esta operación no se puede deshacer automáticamente.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                    <AlertDialogAction onClick={aplicar}>Fusionar</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
