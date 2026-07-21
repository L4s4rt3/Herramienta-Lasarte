// src/components/ConciliarProductoresDialog.tsx
// "Conciliar productores con el informe del ERP" (solo admin, pestaña
// "Por productor" de EntradasBascula.tsx): el catálogo canónico se pobló por
// coincidencia de nombres (backfill + cola manual) y quedaron enlaces mal —
// alias apuntando al productor equivocado y entradas/pasadas vinculadas a
// productores que no son. El "LISTADO DE ENTRADAS POR PROVEEDOR" del ERP trae
// el productor CORRECTO de cada entrada junto a su código de lote (la misma
// clave AAMMDDNN de entradas_bascula.lote / lotes_dia.lote_codigo), así que
// aquí se corrige lote a lote sin adivinar por texto.
//
// DOS MODOS (decisión del dueño, 2026-07-21 — pidió textualmente "desvincular
// todo para que se vinculen como aparece en el informe"):
//   - "Desde cero" (por defecto): borra TODOS los alias, desvincula TODAS las
//     filas de entradas_bascula y lotes_dia, y re-vincula solo con lo que el
//     informe demuestra (por lote; y por alias para filas fuera del informe
//     cuyo texto el ERP resuelve sin ambigüedad). Lo que el informe no cubre
//     queda sin vincular y aparece en la cola de "nombres sin vincular".
//   - "Solo corregir": mantiene lo existente y corrige únicamente las
//     diferencias detectadas.
//
// ORDEN CRÍTICO al desvincular: los alias se borran ANTES de poner
// productor_id a NULL — los triggers de BD (asignar_productor_id_*) re-asignan
// por alias en cada UPDATE con productor_id NULL, y con alias vivos la
// desvinculación se desharía sola en el mismo instante.
//
// Idempotente: re-subir el mismo informe tras aplicar debe dejar el plan a cero.
import { useMemo, useRef, useState, type ReactNode } from "react";
import * as XLSX from "xlsx";
import { useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  AlertTriangle, CheckCircle2, ChevronDown, FileSpreadsheet, Loader2, Upload, UserPlus, Link2, Link2Off,
} from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthProvider";
import { useProductoresCatalogo } from "@/hooks/useProductoresCatalogo";
import {
  parseInformeProveedoresErp,
  planConciliacionProductores,
  planVinculacionPorAlias,
  type AliasAccion,
  type RegistroErp,
  type TargetProductor,
} from "@/lib/conciliacionProductoresErp";
import { errorMessage, toError } from "@/lib/errorMessage";
import { fetchAllRows } from "@/lib/fetchAllRows";
import { formatKgCompact as formatKg, formatNumber } from "@/lib/format";
import { normalizarLoteCodigo } from "@/lib/loteCodigo";
import { esErrorTablaOColumnaInexistente, normalizeProductorName } from "@/lib/productoresCanonicos";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

// Cast local: productores_alias y las columnas productor_id aún no están en el
// Database generado (mismo patrón que useProductoresCatalogo.ts).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const SUPA = supabase as unknown as SupabaseClient<any>;

const CHUNK = 200;

interface FilaConciliacion {
  id: string;
  lote: string;
  agricultor: string | null;
  productor_id: string | null;
}

interface DatosCargados {
  fileName: string;
  registros: RegistroErp[];
  filasNoReconocidas: number;
  totalGeneralKg: number | null;
  entradasRows: FilaConciliacion[];
  lotesDiaRows: FilaConciliacion[];
}

interface ResultadoAplicado {
  desvinculadas: number;
  entradasPorLote: number;
  pasadasPorLote: number;
  porAlias: number;
  productoresCreados: number;
  fichasActualizadas: number;
  aliasAplicados: number;
}

interface ConciliarProductoresDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ConciliarProductoresDialog({ open, onOpenChange }: ConciliarProductoresDialogProps) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { productores, aliasPorNombreNormalizado } = useProductoresCatalogo();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [cargando, setCargando] = useState(false);
  const [datos, setDatos] = useState<DatosCargados | null>(null);
  const [desdeCero, setDesdeCero] = useState(true);
  const [aplicando, setAplicando] = useState(false);
  const [progreso, setProgreso] = useState<{ hecho: number; total: number } | null>(null);
  const [resultado, setResultado] = useState<ResultadoAplicado | null>(null);

  function reset() {
    setDatos(null);
    setResultado(null);
    setProgreso(null);
  }

  const handleFile = async (file: File | null) => {
    if (!file) return;
    setCargando(true);
    setResultado(null);
    try {
      const wb = XLSX.read(await file.arrayBuffer(), { cellDates: false });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null }) as unknown[][];
      const parseado = parseInformeProveedoresErp(rows);
      if (parseado.registros.length === 0) {
        toast({
          title: "El archivo no parece el informe del ERP",
          description: "No se ha reconocido ninguna entrada. Exporta el \"Listado de entradas por proveedor\" a Excel y súbelo tal cual.",
          variant: "destructive",
        });
        return;
      }

      // Se leen TODAS las filas directamente de BD (el dataset de
      // useEntradasBascula excluye precalibrado/CAMPO-CIT y esos lotes también
      // deben quedar bien vinculados). lotes_dia también se concilia: las
      // pasadas del calibrador alimentan el ranking de Productores.
      const [entradasRows, lotesDiaRaw] = await Promise.all([
        fetchAllRows<FilaConciliacion>((from, to) =>
          SUPA.from("entradas_bascula").select("id, lote, agricultor, productor_id").order("id").range(from, to),
        ),
        fetchAllRows<{ id: string; lote_codigo: string | null; productor: string | null; productor_id: string | null }>((from, to) =>
          SUPA.from("lotes_dia").select("id, lote_codigo, productor, productor_id").order("id").range(from, to),
        ),
      ]);

      setDatos({
        fileName: file.name,
        registros: parseado.registros,
        filasNoReconocidas: parseado.filasNoReconocidas,
        totalGeneralKg: parseado.totalGeneralKg,
        entradasRows,
        lotesDiaRows: lotesDiaRaw.map((l) => ({ id: l.id, lote: l.lote_codigo ?? "", agricultor: l.productor, productor_id: l.productor_id })),
      });
    } catch (err) {
      toast({ title: "No se pudo leer el informe", description: errorMessage(err), variant: "destructive" });
    } finally {
      setCargando(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  // ─── Plan (recalculado al cambiar el modo, sin re-leer el archivo) ────────
  const plan = useMemo(() => {
    if (!datos) return null;
    // "Desde cero": el plan se calcula como si HOY no existiera ningún vínculo
    // (alias vacíos, productor_id null) — el paso de desvinculación previo lo
    // hace verdad antes de aplicar las asignaciones.
    const aliasBase = desdeCero ? new Map<string, string>() : aliasPorNombreNormalizado;
    const entradas = desdeCero ? datos.entradasRows.map((e) => ({ ...e, productor_id: null })) : datos.entradasRows;
    const lotesDia = desdeCero ? datos.lotesDiaRows.map((l) => ({ ...l, productor_id: null })) : datos.lotesDiaRows;
    // codigo_erp: migración 20260721120000 — puede no estar en los tipos
    // generados ni (aún) en BD; el plan y el apply degradan con gracia.
    const catalogo = productores.map((p) => ({
      id: p.id,
      nombre: p.nombre,
      codigo_erp: (p as { codigo_erp?: string | null }).codigo_erp ?? null,
    }));

    const planEntradas = planConciliacionProductores(datos.registros, entradas, catalogo, aliasBase);
    const planLotesDia = planConciliacionProductores(datos.registros, lotesDia, catalogo, aliasBase);

    // Alias de ambos planes, dedup por normalizado (los nombres de báscula y
    // calibrador se solapan; la acción calculada para el mismo texto es la misma).
    const vistos = new Set<string>();
    const aliasAcciones = [...planEntradas.aliasAcciones, ...planLotesDia.aliasAcciones].filter((a) => {
      if (vistos.has(a.aliasNormalizado)) return false;
      vistos.add(a.aliasNormalizado);
      return true;
    });

    // Filas fuera del informe cuyo texto el ERP resuelve sin ambigüedad.
    const porAliasEntradas = planVinculacionPorAlias(entradas, planEntradas.asignaciones, aliasAcciones);
    const porAliasLotesDia = planVinculacionPorAlias(lotesDia, planLotesDia.asignaciones, aliasAcciones);

    const desvinculables = desdeCero
      ? datos.entradasRows.filter((e) => e.productor_id !== null).length
        + datos.lotesDiaRows.filter((l) => l.productor_id !== null).length
      : 0;

    // "Quedarán sin vincular": filas que ni el informe cubre por lote, ni un
    // alias inequívoco resuelve, ni (en modo "solo corregir") conservan un
    // vínculo previo. Irán a la cola de "nombres sin vincular".
    const lotesErp = new Set(datos.registros.map((r) => r.lote));
    const idsPorAlias = new Set([...porAliasEntradas, ...porAliasLotesDia].map((a) => a.entradaId));
    const cuentaSinVincular = (rows: FilaConciliacion[]) =>
      rows.filter((r) => {
        const lote = normalizarLoteCodigo(r.lote);
        if (lote && lotesErp.has(lote)) return false;
        if (idsPorAlias.has(r.id)) return false;
        if (!desdeCero && r.productor_id !== null) return false;
        return true;
      }).length;
    const sinVincular = cuentaSinVincular(datos.entradasRows) + cuentaSinVincular(datos.lotesDiaRows);

    return { planEntradas, planLotesDia, aliasAcciones, porAliasEntradas, porAliasLotesDia, desvinculables, sinVincular };
  }, [datos, desdeCero, productores, aliasPorNombreNormalizado]);

  const totalCambios = plan
    ? plan.desvinculables + plan.planEntradas.productoresNuevos.length + plan.aliasAcciones.length
      + plan.planEntradas.fichasActualizar.length
      + plan.planEntradas.asignaciones.length + plan.planLotesDia.asignaciones.length
      + plan.porAliasEntradas.length + plan.porAliasLotesDia.length
    : 0;

  const aplicar = async () => {
    if (!plan || !datos || !user) return;
    setAplicando(true);
    try {
      const nuevos = plan.planEntradas.productoresNuevos;
      const aliasUpserts = plan.aliasAcciones.filter(
        (a): a is Extract<AliasAccion, { tipo: "crear" | "reapuntar" }> => a.tipo === "crear" || a.tipo === "reapuntar",
      );
      const aliasEliminar = plan.aliasAcciones.filter((a) => a.tipo === "eliminar_ambiguo");
      const totalPasos =
        (desdeCero ? 3 : 0)
        + (nuevos.length > 0 ? 1 : 0)
        + plan.planEntradas.fichasActualizar.length
        + aliasUpserts.length + aliasEliminar.length
        + plan.planEntradas.asignaciones.length + plan.planLotesDia.asignaciones.length
        + plan.porAliasEntradas.length + plan.porAliasLotesDia.length;
      let migracionCodigoPendiente = false;
      let hecho = 0;
      const avanza = (n: number) => { hecho += n; setProgreso({ hecho, total: totalPasos }); };
      setProgreso({ hecho: 0, total: totalPasos });

      // ─── 0. Desde cero: borrar alias y desvincular TODO ──────────────────
      // Los alias van PRIMERO: los triggers de BD re-asignan productor_id por
      // alias en cualquier UPDATE que lo deje a NULL (ver cabecera).
      if (desdeCero) {
        {
          const { error } = await SUPA.from("productores_alias").delete().not("id", "is", null);
          if (error && !String(errorMessage(error)).includes("does not exist")) throw toError(error);
          avanza(1);
        }
        for (const tabla of ["entradas_bascula", "lotes_dia"] as const) {
          const { error } = await SUPA.from(tabla).update({ productor_id: null }).not("productor_id", "is", null);
          if (error) throw toError(error);
          avanza(1);
        }
      }

      // ─── 1. Crear productores nuevos (con su código ERP) y resolver ids ──
      const idPorCodigo = new Map<string, string>();
      if (nuevos.length > 0) {
        let res = await SUPA
          .from("calidad_productores")
          .insert(nuevos.map((n) => ({ user_id: user.id, nombre: n.nombre, codigo_erp: n.codigo })))
          .select("id, nombre");
        if (res.error && esErrorTablaOColumnaInexistente(res.error)) {
          // Migración 20260721120000 sin aplicar: crear sin código y avisar al final.
          migracionCodigoPendiente = true;
          res = await SUPA
            .from("calidad_productores")
            .insert(nuevos.map((n) => ({ user_id: user.id, nombre: n.nombre })))
            .select("id, nombre");
        }
        if (res.error) throw toError(res.error);
        const idPorNombre = new Map((res.data as Array<{ id: string; nombre: string }>).map((p) => [p.nombre, p.id]));
        for (const n of nuevos) {
          const id = idPorNombre.get(n.nombre);
          if (!id) throw new Error(`No se pudo crear el productor "${n.nombre}".`);
          idPorCodigo.set(n.codigo, id);
        }
        avanza(1);
      }

      // ─── 1b. Anclar fichas existentes: grabar código ERP y nombre oficial ─
      for (const f of plan.planEntradas.fichasActualizar) {
        const patch: Record<string, unknown> = migracionCodigoPendiente ? {} : { codigo_erp: f.codigo };
        if (f.nombreNuevo) patch.nombre = f.nombreNuevo;
        if (Object.keys(patch).length > 0) {
          let { error } = await SUPA.from("calidad_productores").update(patch).eq("id", f.productorId);
          if (error && esErrorTablaOColumnaInexistente(error)) {
            migracionCodigoPendiente = true;
            if (f.nombreNuevo) {
              const retry = await SUPA.from("calidad_productores").update({ nombre: f.nombreNuevo }).eq("id", f.productorId);
              error = retry.error;
            } else {
              error = null;
            }
          }
          if (error) throw toError(error);
        }
        // Al renombrar, el nombre anterior queda como alias de la misma ficha.
        if (f.nombreNuevo) {
          const norm = normalizeProductorName(f.nombreAnterior);
          if (norm) {
            const { error } = await SUPA.from("productores_alias").upsert(
              { productor_id: f.productorId, alias: f.nombreAnterior, alias_normalizado: norm, origen: "manual" },
              { onConflict: "alias_normalizado", ignoreDuplicates: true },
            );
            if (error && !esErrorTablaOColumnaInexistente(error)) throw toError(error);
          }
        }
        avanza(1);
      }

      const resolverId = (t: TargetProductor): string => {
        if (t.tipo === "existente") return t.productorId;
        const id = idPorCodigo.get(t.codigo);
        if (!id) throw new Error(`Productor nuevo sin id resuelto: ${t.nombre}`);
        return id;
      };

      // ─── 2. Alias: crear / re-apuntar (upsert) y eliminar los ambiguos ───
      const upserts = aliasUpserts.map((a) => ({
        productor_id: resolverId(a.target),
        alias: a.alias,
        alias_normalizado: a.aliasNormalizado,
        origen: "manual",
      }));
      for (let i = 0; i < upserts.length; i += CHUNK) {
        const chunk = upserts.slice(i, i + CHUNK);
        const { error } = await SUPA.from("productores_alias").upsert(chunk, { onConflict: "alias_normalizado" });
        if (error) throw toError(error);
        avanza(chunk.length);
      }
      const aEliminar = aliasEliminar.map((a) => a.aliasNormalizado);
      for (let i = 0; i < aEliminar.length; i += CHUNK) {
        const chunk = aEliminar.slice(i, i + CHUNK);
        const { error } = await SUPA.from("productores_alias").delete().in("alias_normalizado", chunk);
        if (error) throw toError(error);
        avanza(chunk.length);
      }

      // ─── 3. Vincular fila a fila (agrupado por destino) ──────────────────
      const corrige = async (
        tabla: "entradas_bascula" | "lotes_dia",
        items: Array<{ entradaId: string; target: TargetProductor }>,
      ) => {
        const idsPorTarget = new Map<string, string[]>();
        for (const a of items) {
          const targetId = resolverId(a.target);
          const arr = idsPorTarget.get(targetId) ?? [];
          arr.push(a.entradaId);
          idsPorTarget.set(targetId, arr);
        }
        for (const [targetId, ids] of idsPorTarget) {
          for (let i = 0; i < ids.length; i += CHUNK) {
            const chunk = ids.slice(i, i + CHUNK);
            const { error } = await SUPA.from(tabla).update({ productor_id: targetId }).in("id", chunk);
            if (error) throw toError(error);
            avanza(chunk.length);
          }
        }
      };
      await corrige("entradas_bascula", plan.planEntradas.asignaciones);
      await corrige("lotes_dia", plan.planLotesDia.asignaciones);
      await corrige("entradas_bascula", plan.porAliasEntradas);
      await corrige("lotes_dia", plan.porAliasLotesDia);

      // ─── 4. Refrescar todo lo que agrupa por productor ────────────────────
      queryClient.invalidateQueries({ queryKey: ["entradas_bascula"] });
      queryClient.invalidateQueries({ queryKey: ["productores-catalogo"] });
      queryClient.invalidateQueries({ queryKey: ["productores-alias"] });
      queryClient.invalidateQueries({ queryKey: ["productores-pendientes"] });

      const res: ResultadoAplicado = {
        desvinculadas: plan.desvinculables,
        entradasPorLote: plan.planEntradas.asignaciones.length,
        pasadasPorLote: plan.planLotesDia.asignaciones.length,
        porAlias: plan.porAliasEntradas.length + plan.porAliasLotesDia.length,
        productoresCreados: nuevos.length,
        fichasActualizadas: plan.planEntradas.fichasActualizar.length,
        aliasAplicados: plan.aliasAcciones.length,
      };
      setResultado(res);
      setDatos(null);
      toast({
        title: "Productores conciliados",
        description: `${formatNumber(res.entradasPorLote + res.pasadasPorLote)} filas vinculadas por lote · ${formatNumber(res.porAlias)} por alias · ${res.productoresCreados} productores creados.`,
      });
      if (migracionCodigoPendiente) {
        toast({
          title: "Códigos del ERP sin grabar",
          description: "La columna codigo_erp no existe todavía: aplica la migración 20260721120000_productores_codigo_erp.sql en Supabase y vuelve a conciliar para anclar las fichas por código.",
          variant: "destructive",
        });
      }
    } catch (err) {
      toast({ title: "Error al aplicar la conciliación", description: errorMessage(err), variant: "destructive" });
    } finally {
      setAplicando(false);
      setProgreso(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!aplicando) { onOpenChange(v); if (!v) reset(); } }}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Link2 className="h-4 w-4" /> Conciliar productores con el informe del ERP
          </DialogTitle>
          <DialogDescription>
            Sube el <span className="font-medium">"Listado de entradas por proveedor"</span> (Excel del ERP). Cada entrada
            se vincula a su productor por código de lote, tal como aparece en el informe.
          </DialogDescription>
        </DialogHeader>

        {/* ─── Resultado tras aplicar ─────────────────────────────────────── */}
        {resultado && (
          <div className="space-y-2 rounded-lg border border-success/30 bg-success/10 p-4 text-sm">
            <p className="flex items-center gap-2 font-semibold text-success">
              <CheckCircle2 className="h-4 w-4" /> Conciliación aplicada
            </p>
            <ul className="ml-6 list-disc space-y-0.5 text-muted-foreground">
              {resultado.desvinculadas > 0 && <li>{formatNumber(resultado.desvinculadas)} vínculos anteriores borrados (empezado de cero)</li>}
              <li>{formatNumber(resultado.entradasPorLote)} entradas de báscula vinculadas por lote</li>
              <li>{formatNumber(resultado.pasadasPorLote)} pasadas de calibrador vinculadas por lote</li>
              <li>{formatNumber(resultado.porAlias)} filas fuera del informe vinculadas por alias</li>
              <li>{resultado.productoresCreados} productores creados en el catálogo</li>
              <li>{resultado.fichasActualizadas} fichas ancladas al código del ERP (código y/o nombre oficial)</li>
              <li>{resultado.aliasAplicados} alias creados/corregidos</li>
            </ul>
            <p className="text-xs text-muted-foreground">
              Puedes volver a subir el mismo informe para comprobar que ya no queda nada por corregir. Lo que el informe
              no cubre aparece en la cola de "nombres sin vincular" de la página Productores.
            </p>
          </div>
        )}

        {/* ─── Zona de subida ─────────────────────────────────────────────── */}
        {!datos && (
          <div className="space-y-3">
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={cargando}
              className={cn(
                "flex w-full flex-col items-center gap-2 rounded-xl border-2 border-dashed border-[var(--glass-border)] bg-[var(--glass-bg)] px-4 py-8 text-sm transition-colors hover:bg-[var(--glass-bg-strong)]",
                cargando && "opacity-60",
              )}
            >
              {cargando ? <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /> : <Upload className="h-6 w-6 text-muted-foreground" />}
              <span className="font-medium">{cargando ? "Analizando informe..." : "Subir informe del ERP (.xlsx)"}</span>
              <span className="text-xs text-muted-foreground">
                ERP → Listados → Entradas por proveedor → exportar a Excel. Marca TODOS los proveedores y el rango de
                fechas más amplio posible: lo que no esté en el informe quedará sin vincular.
              </span>
            </button>
          </div>
        )}

        {/* ─── Plan calculado ─────────────────────────────────────────────── */}
        {datos && plan && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <FileSpreadsheet className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="font-medium">{datos.fileName}</span>
              <Badge variant="secondary" className="px-1.5 text-[11px]">
                {formatNumber(datos.registros.length)} entradas · {formatKg(plan.planEntradas.totales.kgErp)} · {plan.planEntradas.totales.productoresErp} productores
              </Badge>
              {datos.filasNoReconocidas > 0 && (
                <Badge variant="outline" className="border-warning/40 px-1.5 text-[11px] text-warning">
                  {datos.filasNoReconocidas} filas sin reconocer
                </Badge>
              )}
            </div>

            {/* Modo */}
            <div className="flex items-start gap-3 rounded-lg border border-[var(--glass-border)] bg-[var(--glass-bg)] px-3 py-2.5">
              <Switch id="conciliar-desde-cero" checked={desdeCero} onCheckedChange={setDesdeCero} disabled={aplicando} />
              <div className="space-y-0.5">
                <Label htmlFor="conciliar-desde-cero" className="cursor-pointer text-sm font-medium">
                  Desvincular todo y empezar de cero
                </Label>
                <p className="text-xs text-muted-foreground">
                  {desdeCero
                    ? `Se borran los ${formatNumber(plan.desvinculables)} vínculos y todos los alias actuales; después se vincula todo tal como aparece en el informe.`
                    : "Se mantienen los vínculos actuales y solo se corrigen las diferencias con el informe."}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <ResumenChip valor={plan.planEntradas.productoresNuevos.length} etiqueta="productores nuevos" icono={UserPlus} />
              <ResumenChip valor={plan.planEntradas.asignaciones.length + plan.planLotesDia.asignaciones.length} etiqueta="filas por lote (informe)" icono={Link2} />
              <ResumenChip valor={plan.porAliasEntradas.length + plan.porAliasLotesDia.length} etiqueta="filas por alias" icono={Link2} />
              <ResumenChip valor={plan.sinVincular} etiqueta="quedarán sin vincular" icono={Link2Off} neutralSiCero />
            </div>

            <p className="text-xs text-muted-foreground">
              {formatNumber(plan.planEntradas.asignaciones.length)} entradas de báscula y {formatNumber(plan.planLotesDia.asignaciones.length)} pasadas
              de calibrador se vinculan por código de lote; {formatNumber(plan.porAliasEntradas.length + plan.porAliasLotesDia.length)} filas fuera del
              informe, por nombre (solo cuando el informe lo resuelve sin ambigüedad). Las {formatNumber(Math.max(0, plan.sinVincular))} restantes irán
              a la cola de "nombres sin vincular".
              {plan.planEntradas.lotesErpSinEntrada.length > 0 && (
                <> {plan.planEntradas.lotesErpSinEntrada.length} lotes del informe no existen en la báscula.</>
              )}
            </p>

            {plan.planEntradas.productoresNuevos.length > 0 && (
              <ListaColapsable titulo={`Productores que se crearán (${plan.planEntradas.productoresNuevos.length})`}>
                {plan.planEntradas.productoresNuevos.map((p) => (
                  <li key={p.codigo}><span className="tabular-nums text-muted-foreground">{p.codigo}</span> · {p.nombre}</li>
                ))}
              </ListaColapsable>
            )}

            {plan.planEntradas.fichasActualizar.length > 0 && (
              <ListaColapsable titulo={`Fichas que se anclan al código del ERP (${plan.planEntradas.fichasActualizar.length})`}>
                {plan.planEntradas.fichasActualizar.map((f) => (
                  <li key={f.productorId}>
                    <span className="tabular-nums text-muted-foreground">{f.codigo}</span> · {f.nombreAnterior}
                    {f.nombreNuevo && <span className="text-muted-foreground"> → pasa a llamarse "{f.nombreNuevo}"</span>}
                  </li>
                ))}
              </ListaColapsable>
            )}

            {plan.planEntradas.conflictosCodigo.length > 0 && (
              <ListaColapsable titulo={`⚠ Conflictos de código (${plan.planEntradas.conflictosCodigo.length}) — se crean fichas nuevas para no mezclar`}>
                {plan.planEntradas.conflictosCodigo.map((c) => (
                  <li key={c} className="text-warning">{c}</li>
                ))}
              </ListaColapsable>
            )}

            {plan.aliasAcciones.length > 0 && (
              <ListaColapsable titulo={`Alias que se ${desdeCero ? "crearán" : "corregirán"} (${plan.aliasAcciones.length})`}>
                {plan.aliasAcciones.map((a) => (
                  <li key={a.aliasNormalizado}>
                    "{a.alias}"{" "}
                    {a.tipo === "eliminar_ambiguo" ? (
                      <span className="text-warning">
                        se elimina: el ERP lo reparte entre {a.nombresDestino.join(", ")} (se resuelve lote a lote)
                      </span>
                    ) : (
                      <span className="text-muted-foreground">→ {a.target.nombre}{a.tipo === "reapuntar" ? " (antes apuntaba a otro)" : ""}</span>
                    )}
                  </li>
                ))}
              </ListaColapsable>
            )}

            {plan.planEntradas.lotesErpSinEntrada.length > 0 && (
              <ListaColapsable titulo={`Lotes del ERP sin entrada en la báscula (${plan.planEntradas.lotesErpSinEntrada.length})`}>
                {plan.planEntradas.lotesErpSinEntrada.slice(0, 40).map((l) => <li key={l} className="tabular-nums">{l}</li>)}
                {plan.planEntradas.lotesErpSinEntrada.length > 40 && (
                  <li className="text-muted-foreground">… y {plan.planEntradas.lotesErpSinEntrada.length - 40} más</li>
                )}
              </ListaColapsable>
            )}

            {progreso && (
              <div className="space-y-1">
                <Progress value={progreso.total > 0 ? (progreso.hecho / progreso.total) * 100 : 0} />
                <p className="text-right text-xs tabular-nums text-muted-foreground">{progreso.hecho} / {progreso.total}</p>
              </div>
            )}

            <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
              <Button variant="ghost" size="sm" onClick={reset} disabled={aplicando}>
                Elegir otro archivo
              </Button>
              {totalCambios === 0 ? (
                <p className="flex items-center gap-1.5 text-sm font-medium text-success">
                  <CheckCircle2 className="h-4 w-4" /> Todo cuadra: no hay nada que corregir
                </p>
              ) : (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button size="sm" disabled={aplicando || !user}>
                      {aplicando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Link2 className="h-3.5 w-3.5" />}
                      {desdeCero ? "Desvincular todo y aplicar" : `Aplicar ${formatNumber(totalCambios)} correcciones`}
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle className="flex items-center gap-2">
                        <AlertTriangle className="h-4 w-4 text-warning" /> {desdeCero ? "¿Desvincular todo y re-vincular según el informe?" : "¿Aplicar la conciliación?"}
                      </AlertDialogTitle>
                      <AlertDialogDescription>
                        {desdeCero && <>Se borrarán los {formatNumber(plan.desvinculables)} vínculos actuales y TODOS los alias. </>}
                        Se vincularán {formatNumber(plan.planEntradas.asignaciones.length + plan.planLotesDia.asignaciones.length)} filas por código
                        de lote y {formatNumber(plan.porAliasEntradas.length + plan.porAliasLotesDia.length)} por alias
                        {plan.planEntradas.productoresNuevos.length > 0 && <>, y se crearán {plan.planEntradas.productoresNuevos.length} productores</>}.
                        El informe del ERP pasa a ser la única fuente de verdad.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancelar</AlertDialogCancel>
                      <AlertDialogAction onClick={aplicar}>Aplicar</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ResumenChip({ valor, etiqueta, icono: Icono, neutralSiCero }: { valor: number; etiqueta: string; icono: typeof Link2; neutralSiCero?: boolean }) {
  const destacar = neutralSiCero ? valor > 0 : valor > 0;
  return (
    <div className={cn(
      "rounded-lg border px-2.5 py-2",
      destacar ? "border-warning/40 bg-warning/10" : "border-[var(--glass-border)] bg-[var(--glass-bg)]",
    )}>
      <p className="flex items-center gap-1.5 text-lg font-bold tabular-nums leading-tight">
        <Icono className={cn("h-3.5 w-3.5", destacar ? "text-warning" : "text-muted-foreground")} />
        {formatNumber(valor)}
      </p>
      <p className="text-[11px] text-muted-foreground">{etiqueta}</p>
    </div>
  );
}

function ListaColapsable({ titulo, children }: { titulo: string; children: ReactNode }) {
  const [abierto, setAbierto] = useState(false);
  return (
    <Collapsible open={abierto} onOpenChange={setAbierto}>
      <CollapsibleTrigger className="flex w-full items-center gap-1.5 rounded-lg border border-[var(--glass-border)] bg-[var(--glass-bg)] px-3 py-2 text-left text-sm font-medium transition-colors hover:bg-[var(--glass-bg-strong)]">
        <ChevronDown className={cn("h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform", abierto && "rotate-180")} />
        {titulo}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ul className="max-h-56 space-y-1 overflow-y-auto px-3 py-2 text-xs">{children}</ul>
      </CollapsibleContent>
    </Collapsible>
  );
}
