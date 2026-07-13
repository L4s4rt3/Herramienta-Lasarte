# Costes de Envasado (Packaging) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Añadir tabla, hook y UI para gestionar precios de materiales de packaging (etiqueta, caja, palet, malla roja, banda, fleje, asa) para mallas de 3kg y 5kg.

**Architecture:** Nueva tabla Supabase `empaque_precios` (admin-only RLS, igual que `economico_precios`). Hook `useEmpaquePrecios` con CRUD. Sección en página `EconomicoPrecios` (mismo patrón que `MallasRotasSection`). Lógica pura en `costeEmpaque.ts`.

**Tech Stack:** Supabase (PostgreSQL RLS), React, TanStack Query, shadcn/ui

---

### Task 1: Migración SQL — tabla `empaque_precios`

**Files:**
- Create: `supabase/migrations/20260713120000_empaque_precios.sql`

- [ ] **Step 1: Escribir migración**

```sql
-- =============================================================================
-- MIGRACION: Precios de materiales de envasado (packaging)
-- =============================================================================

CREATE TABLE public.empaque_precios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tipo_malla TEXT NOT NULL CHECK (tipo_malla IN ('3kg', '5kg')),
  componente TEXT NOT NULL CHECK (componente IN (
    'etiqueta', 'caja_logifruit', 'palet_doble', 'malla_roja', 'banda', 'fleje', 'asa'
  )),
  precio_malla NUMERIC NOT NULL DEFAULT 0 CHECK (precio_malla >= 0),
  vigente_desde DATE NOT NULL,
  notas TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_empaque_precios_tipo_malla ON public.empaque_precios(tipo_malla, vigente_desde DESC);

ALTER TABLE public.empaque_precios ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.empaque_precios TO authenticated;

CREATE POLICY "empaque_precios_select_admin"
  ON public.empaque_precios FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "empaque_precios_insert_admin"
  ON public.empaque_precios FOR INSERT
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "empaque_precios_update_admin"
  ON public.empaque_precios FOR UPDATE
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "empaque_precios_delete_admin"
  ON public.empaque_precios FOR DELETE
  USING (public.has_role(auth.uid(), 'admin'));

-- Seed: campaña 2025/2026 (vigente desde inicio de campaña)
INSERT INTO public.empaque_precios (user_id, tipo_malla, componente, precio_malla, vigente_desde, notas) VALUES
  -- Malla 3kg
  ('00000000-0000-0000-0000-000000000000', '3kg', 'etiqueta',      0.0021,  '2025-09-01', 'Precio unitario etiqueta'),
  ('00000000-0000-0000-0000-000000000000', '3kg', 'caja_logifruit', 0.0013,  '2025-09-01', 'Caja Logifruit 0,25€/ud ÷ 4 mallas por caja'),
  ('00000000-0000-0000-0000-000000000000', '3kg', 'palet_doble',    0.0151,  '2025-09-01', 'Palet doble 2,90€ ÷ 192 mallas por palet'),
  ('00000000-0000-0000-0000-000000000000', '3kg', 'malla_roja',     0.0170,  '2025-09-01', 'Malla roja 0,02985€/metro'),
  ('00000000-0000-0000-0000-000000000000', '3kg', 'banda',          0.00342, '2025-09-01', 'Banda 3kg 0,003€/metro'),
  ('00000000-0000-0000-0000-000000000000', '3kg', 'fleje',          0.0033,  '2025-09-01', 'Fleje 0,0079€/metro'),
  ('00000000-0000-0000-0000-000000000000', '3kg', 'asa',            0.01,    '2025-09-01', 'Asa 0,01€/malla'),
  -- Malla 5kg
  ('00000000-0000-0000-0000-000000000000', '5kg', 'etiqueta',      0.0021,  '2025-09-01', 'Precio unitario etiqueta'),
  ('00000000-0000-0000-0000-000000000000', '5kg', 'caja_logifruit', 0.125,   '2025-09-01', 'Caja Logifruit 0,25€/ud ÷ 2 mallas por caja'),
  ('00000000-0000-0000-0000-000000000000', '5kg', 'palet_doble',    0.0302,  '2025-09-01', 'Palet doble 2,90€ ÷ 96 mallas por palet'),
  ('00000000-0000-0000-0000-000000000000', '5kg', 'malla_roja',     0.0194,  '2025-09-01', 'Malla roja 0,02985€/metro'),
  ('00000000-0000-0000-0000-000000000000', '5kg', 'banda',          0.0524,  '2025-09-01', 'Banda 5kg 0,04€/metro'),
  ('00000000-0000-0000-0000-000000000000', '5kg', 'fleje',          0.0033,  '2025-09-01', 'Fleje 0,0079€/metro'),
  ('00000000-0000-0000-0000-000000000000', '5kg', 'asa',            0.01,    '2025-09-01', 'Asa 0,01€/malla');
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/20260713120000_empaque_precios.sql
git commit -m "feat(empaque): migracion tabla empaque_precios con seed 2025/2026"
```

---

### Task 2: Lógica pura — `src/lib/costeEmpaque.ts`

**Files:**
- Create: `src/lib/costeEmpaque.ts`

- [ ] **Step 1: Escribir tipos y funciones**

```typescript
export type TipoMalla = "3kg" | "5kg";

export type EmpaqueComponente =
  | "etiqueta"
  | "caja_logifruit"
  | "palet_doble"
  | "malla_roja"
  | "banda"
  | "fleje"
  | "asa";

export const COMPONENTES_EMPAQUE: EmpaqueComponente[] = [
  "etiqueta", "caja_logifruit", "palet_doble", "malla_roja",
  "banda", "fleje", "asa",
];

export const COMPONENTE_LABEL: Record<EmpaqueComponente, string> = {
  etiqueta: "Etiqueta",
  caja_logifruit: "Caja Logifruit",
  palet_doble: "Doble Palet Logifruit",
  malla_roja: "Malla Roja",
  banda: "Banda",
  fleje: "Fleje",
  asa: "Asa",
};

export const TIPO_MALLA_LABEL: Record<TipoMalla, string> = {
  "3kg": "Malla 3 kg",
  "5kg": "Malla 5 kg",
};

export interface EmpaquePrecioInput {
  tipo_malla: TipoMalla;
  componente: EmpaqueComponente;
  precio_malla: number;
  vigente_desde: string;
}

export function precioVigenteEmpaque<T extends EmpaquePrecioInput>(
  precios: T[],
  tipoMalla: TipoMalla,
  componente: EmpaqueComponente,
  fecha: string,
): T | null {
  let mejor: T | null = null;
  for (const p of precios) {
    if (p.tipo_malla !== tipoMalla) continue;
    if (p.componente !== componente) continue;
    if (p.vigente_desde > fecha) continue;
    if (!mejor || p.vigente_desde > mejor.vigente_desde) {
      mejor = p;
    }
  }
  return mejor;
}

export interface CosteEmpaqueTipoMalla {
  tipoMalla: TipoMalla;
  /** Precio por componente (vigente a la fecha de referencia). */
  desglose: { componente: EmpaqueComponente; precioMalla: number }[];
  /** Suma de todos los componentes. */
  totalPorMalla: number;
  /** true si algún componente tiene precio 0. */
  incompleto: boolean;
}

export function agregarCosteEmpaque<T extends EmpaquePrecioInput>(
  precios: T[],
  fecha: string,
): CosteEmpaqueTipoMalla[] {
  const tipos: TipoMalla[] = ["3kg", "5kg"];
  return tipos.map((tipoMalla) => {
    const desglose = COMPONENTES_EMPAQUE.map((componente) => {
      const vigente = precioVigenteEmpaque(precios, tipoMalla, componente, fecha);
      return {
        componente,
        precioMalla: vigente?.precio_malla ?? 0,
      };
    });
    const total = desglose.reduce((sum, c) => sum + c.precioMalla, 0);
    return {
      tipoMalla,
      desglose,
      totalPorMalla: total,
      incompleto: desglose.some((c) => c.precioMalla === 0),
    };
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/costeEmpaque.ts
git commit -m "feat(empaque): logica pura de costes de envasado"
```

---

### Task 3: Hook — `src/hooks/useEmpaquePrecios.ts`

**Files:**
- Create: `src/hooks/useEmpaquePrecios.ts`

- [ ] **Step 1: Escribir hook**

```typescript
import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useAuth } from "@/contexts/AuthProvider";
import { supabase } from "@/integrations/supabase/client";
import { toError } from "@/lib/errorMessage";
import { today } from "@/lib/format";
import {
  agregarCosteEmpaque,
  precioVigenteEmpaque,
  type CosteEmpaqueTipoMalla,
  type EmpaqueComponente,
  type EmpaquePrecioInput,
  type TipoMalla,
} from "@/lib/costeEmpaque";

const SUPA = supabase as unknown as SupabaseClient<any>;

const PERMISSION_ERROR_CODES = new Set(["42501", "PGRST301", "PGRST302"]);

function isPermissionError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const record = error as { code?: string; message?: string; status?: number };
  if (record.code && PERMISSION_ERROR_CODES.has(record.code)) return true;
  if (record.status === 401 || record.status === 403) return true;
  const message = (record.message ?? "").toLowerCase();
  return (
    message.includes("permission denied") ||
    message.includes("row-level security") ||
    message.includes("row level security")
  );
}

export interface EmpaquePrecioRow extends EmpaquePrecioInput {
  id: string;
  user_id: string;
  notas: string | null;
}

export interface NuevoEmpaquePrecioInput {
  tipo_malla: TipoMalla;
  componente: EmpaqueComponente;
  precio_malla: number;
  vigente_desde: string;
  notas: string | null;
}

export function useEmpaquePrecios() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const baseKey = ["empaque-precios"] as const;

  const query = useQuery({
    queryKey: baseKey,
    queryFn: async (): Promise<EmpaquePrecioRow[]> => {
      const { data, error } = await SUPA
        .from("empaque_precios")
        .select("*")
        .order("tipo_malla", { ascending: true })
        .order("componente", { ascending: true })
        .order("vigente_desde", { ascending: false });
      if (error) throw error;
      return (data ?? []) as EmpaquePrecioRow[];
    },
    enabled: Boolean(user),
    retry: (failureCount, error) => (isPermissionError(error) ? false : failureCount < 2),
  });

  const sinPermiso = isPermissionError(query.error);
  const precios = useMemo(() => query.data ?? [], [query.data]);

  const tiposMalla: TipoMalla[] = ["3kg", "5kg"];

  const vigentePorTipo = useMemo(() => {
    const map = new Map<TipoMalla, Map<EmpaqueComponente, EmpaquePrecioRow>>();
    const hoy = today();
    for (const tipo of tiposMalla) {
      const compMap = new Map<EmpaqueComponente, EmpaquePrecioRow>();
      for (const comp of ["etiqueta", "caja_logifruit", "palet_doble", "malla_roja", "banda", "fleje", "asa"] as EmpaqueComponente[]) {
        const vigente = precioVigenteEmpaque(precios, tipo, comp, hoy);
        if (vigente) compMap.set(comp, vigente as EmpaquePrecioRow);
      }
      map.set(tipo, compMap);
    }
    return map;
  }, [precios]);

  const historicoPorTipo = useMemo(() => {
    const map = new Map<string, EmpaquePrecioRow[]>();
    for (const p of precios) {
      const key = `${p.tipo_malla}-${p.componente}`;
      const list = map.get(key) ?? [];
      list.push(p);
      map.set(key, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => b.vigente_desde.localeCompare(a.vigente_desde));
    }
    return map;
  }, [precios]);

  const hayPrecioCero = useMemo(
    () => tiposMalla.some((tipo) =>
      COMPONENTES_EMPAQUE.some((comp) => (vigentePorTipo.get(tipo)?.get(comp)?.precio_malla ?? 0) === 0)
    ),
    [tiposMalla, vigentePorTipo],
  );

  const costesVigentes = useMemo<CosteEmpaqueTipoMalla[]>(
    () => agregarCosteEmpaque(precios, today()),
    [precios],
  );

  const crear = useMutation({
    mutationFn: async (input: NuevoEmpaquePrecioInput) => {
      if (!user) throw new Error("Debes iniciar sesion para registrar un precio de envasado.");
      const { error } = await SUPA.from("empaque_precios").insert({
        user_id: user.id,
        tipo_malla: input.tipo_malla,
        componente: input.componente,
        precio_malla: input.precio_malla,
        vigente_desde: input.vigente_desde,
        notas: input.notas,
      });
      if (error) throw toError(error);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: baseKey });
    },
  });

  const editar = useMutation({
    mutationFn: async (input: EmpaquePrecioRow) => {
      const { id, user_id: _, created_at: _c, ...rest } = input as any;
      const { error } = await SUPA
        .from("empaque_precios")
        .update(rest)
        .eq("id", id);
      if (error) throw toError(error);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: baseKey });
    },
  });

  const borrar = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await SUPA.from("empaque_precios").delete().eq("id", id);
      if (error) throw toError(error);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: baseKey });
    },
  });

  return {
    precios,
    vigentePorTipo,
    historicoPorTipo,
    hayPrecioCero,
    costesVigentes,
    isLoading: query.isLoading,
    sinPermiso,
    crear,
    editar,
    borrar,
  };
}
```

Wait, I'm referencing `COMPONENTES_EMPAQUE` from `costeEmpaque.ts` but I need that in the hook too. Let me make sure it's imported properly. Yes, it's imported at the top.

- [ ] **Step 2: Commit**

```bash
git add src/hooks/useEmpaquePrecios.ts
git commit -m "feat(empaque): hook useEmpaquePrecios con CRUD"
```

---

### Task 4: Añadir sección en EconomicoPrecios.tsx

**Files:**
- Modify: `src/pages/EconomicoPrecios.tsx` (añadir sección "Costes de envasado" después de MallasRotasSection)

- [ ] **Step 1: Añadir imports**

Tras los imports existentes, añadir:
```typescript
import {
  useEmpaquePrecios,
  type NuevoEmpaquePrecioInput,
} from "@/hooks/useEmpaquePrecios";
import {
  COMPONENTES_EMPAQUE,
  COMPONENTE_LABEL,
  TIPO_MALLA_LABEL,
  type EmpaqueComponente,
  type TipoMalla,
} from "@/lib/costeEmpaque";
```

- [ ] **Step 2: Usar hook en el componente principal**

En `export default function EconomicoPrecios()`, añadir tras la línea `const mallas = useMallasConfig();`:
```typescript
const empaque = useEmpaquePrecios();
```

Pasar `empaque` al export:
En `exportarPrecios(...)`, añadir `empaque.configs` al call.

Y en el JSX, tras `{/* <MallasRotasSection ... /> */}`, añadir:
```tsx
<EmpaqueSection empaque={empaque} />
```

- [ ] **Step 3: Crear componente EmpaqueSection**

Añadir después del final del archivo (antes de las funciones helper de exportación):

```tsx
function formatPrecioEmpaque(precio: number | null): string {
  return precio != null ? `${formatNumber(precio, 4)} €/malla` : "—";
}

function EmpaqueSection({ empaque }: { empaque: ReturnType<typeof useEmpaquePrecios> }) {
  const {
    vigentePorTipo, hayPrecioCero, isLoading, costesVigentes, crear,
  } = empaque;

  const [dialogOpen, setDialogOpen] = useState(false);
  const [tipoDialog, setTipoDialog] = useState<TipoMalla>("3kg");
  const [componenteDialog, setComponenteDialog] = useState<EmpaqueComponente>("etiqueta");
  const [expandidos, setExpandidos] = useState<Set<TipoMalla>>(new Set());

  const toggleExpandido = (tipo: TipoMalla) => {
    setExpandidos((prev) => {
      const next = new Set(prev);
      if (next.has(tipo)) next.delete(tipo);
      else next.add(tipo);
      return next;
    });
  };

  return (
    <>
      <div className="flex items-center gap-3 pt-2">
        <div className="h-7 w-1 rounded-full bg-primary" />
        <div>
          <p className="panel-kicker">Económico</p>
          <h2 className="text-xl font-semibold tracking-tight">Costes de envasado</h2>
          <p className="text-sm text-muted-foreground">
            Precios de materiales de packaging (etiqueta, caja, palet, malla, banda, fleje, asa) por tipo de malla.
          </p>
        </div>
      </div>

      {hayPrecioCero && (
        <Card className="glass border-warning/30 bg-warning/6">
          <CardContent className="flex items-center gap-3 pt-6">
            <AlertTriangle className="h-5 w-5 shrink-0 text-warning" />
            <p className="text-sm">
              <span className="font-semibold">Faltan precios de envasado:</span> algunos componentes tienen precio 0.
            </p>
          </CardContent>
        </Card>
      )}

      <Card className="glass-accented overflow-hidden">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="space-y-2 py-4">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : costesVigentes.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-14 text-center">
              <Package className="h-10 w-10 text-muted-foreground/50" />
              <div>
                <h2 className="text-lg font-semibold">Sin precios de envasado</h2>
                <p className="mt-1 max-w-md text-sm text-muted-foreground">
                  Da de alta los precios por componente con el botón de cada tipo de malla.
                </p>
              </div>
            </div>
          ) : (
            <ul className="divide-y divide-[var(--glass-border)]">
              {costesVigentes.map((coste) => {
                const vigentes = vigentePorTipo.get(coste.tipoMalla) ?? new Map();
                const expandido = expandidos.has(coste.tipoMalla);

                return (
                  <li key={coste.tipoMalla}>
                    <Collapsible open={expandido} onOpenChange={() => toggleExpandido(coste.tipoMalla)}>
                      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5">
                        <div className="flex min-w-0 flex-1 items-center gap-3">
                          <CollapsibleTrigger asChild>
                            <button
                              type="button"
                              className="flex items-center gap-2 text-left"
                              aria-label={expandido ? "Ocultar desglose" : "Ver desglose"}
                            >
                              <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200", expandido && "rotate-180")} />
                              <span className="font-semibold">{TIPO_MALLA_LABEL[coste.tipoMalla]}</span>
                            </button>
                          </CollapsibleTrigger>
                          {coste.incompleto && (
                            <Badge variant="outline" className="border-warning/40 bg-warning/10 text-[10px] text-warning">
                              Incompleto
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-4">
                          <div className="text-right">
                            <p className="text-sm font-semibold tabular-nums text-success">
                              {formatPrecioEmpaque(coste.totalPorMalla)}
                            </p>
                            <p className="text-[11px] text-muted-foreground">
                              {coste.desglose.length} componente(s)
                            </p>
                          </div>
                        </div>
                      </div>
                      <CollapsibleContent>
                        <div className="border-t border-[var(--glass-border)] bg-[var(--glass-bg-strong)]/40 px-4 py-3">
                          <p className="mb-2 text-[11px] uppercase tracking-wider text-muted-foreground">Desglose por componente</p>
                          <ul className="space-y-1.5">
                            {COMPONENTES_EMPAQUE.map((comp) => {
                              const vigente = vigentes.get(comp) ?? null;
                              const precio = coste.desglose.find((d) => d.componente === comp)?.precioMalla ?? 0;
                              return (
                                <li key={comp} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                                  <div className="min-w-0">
                                    <span className="font-medium">{COMPONENTE_LABEL[comp]}</span>
                                    <span className="ml-2 tabular-nums">{formatPrecioEmpaque(precio)}</span>
                                    {vigente && (
                                      <span className="ml-2 text-xs text-muted-foreground">
                                        desde {formatDate(vigente.vigente_desde)}
                                      </span>
                                    )}
                                    {vigente?.notas ? (
                                      <span className="ml-2 text-xs text-muted-foreground">· {vigente.notas}</span>
                                    ) : null}
                                  </div>
                                  <div className="flex items-center gap-1">
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="h-7 text-xs"
                                      onClick={() => {
                                        setTipoDialog(coste.tipoMalla);
                                        setComponenteDialog(comp);
                                        setDialogOpen(true);
                                      }}
                                    >
                                      <Plus className="mr-1 h-3 w-3" /> Nueva vigencia
                                    </Button>
                                  </div>
                                </li>
                              );
                            })}
                          </ul>
                        </div>
                      </CollapsibleContent>
                    </Collapsible>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <EmpaquePrecioDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        tipoMalla={tipoDialog}
        componente={componenteDialog}
        crear={crear}
      />
    </>
  );
}

function EmpaquePrecioDialog({
  open, onOpenChange, tipoMalla, componente, crear,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tipoMalla: TipoMalla;
  componente: EmpaqueComponente;
  crear: ReturnType<typeof useEmpaquePrecios>["crear"];
}) {
  const [precio, setPrecio] = useState("");
  const [vigenteDesde, setVigenteDesde] = useState(today());
  const [notas, setNotas] = useState("");
  const [saving, setSaving] = useState(false);

  const resetForm = () => {
    setPrecio("");
    setVigenteDesde(today());
    setNotas("");
  };

  const handleSubmit = async () => {
    const precioNumerico = Number(precio.replace(",", "."));
    if (!Number.isFinite(precioNumerico) || precioNumerico < 0) {
      toast({ title: "Precio no válido", description: "Introduce un precio válido.", variant: "destructive" });
      return;
    }
    if (!vigenteDesde) {
      toast({ title: "Fecha requerida", variant: "destructive" });
      return;
    }

    const payload: NuevoEmpaquePrecioInput = {
      tipo_malla: tipoMalla,
      componente,
      precio_malla: precioNumerico,
      vigente_desde: vigenteDesde,
      notas: notas.trim() || null,
    };

    setSaving(true);
    try {
      await crear.mutateAsync(payload);
      toast({ title: "Precio registrado" });
      resetForm();
      onOpenChange(false);
    } catch (error) {
      toast({ title: "Error al guardar", description: errorMessage(error), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) resetForm(); onOpenChange(next); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            Nuevo precio — {TIPO_MALLA_LABEL[tipoMalla]} · {COMPONENTE_LABEL[componente]}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Precio por malla (€)</Label>
            <Input
              inputMode="decimal"
              value={precio}
              onChange={(e) => setPrecio(e.target.value)}
              placeholder="0,0000"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Vigente desde</Label>
            <GlassDatePicker value={vigenteDesde} onChange={setVigenteDesde} className="w-full" />
          </div>
          <div className="space-y-1.5">
            <Label>Notas (opcional)</Label>
            <Textarea value={notas} onChange={(e) => setNotas(e.target.value)} rows={2} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancelar</Button>
          <Button onClick={handleSubmit} disabled={saving}>
            {saving ? "Guardando…" : "Registrar precio"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 4: Añadir import de Package icon**

Añadir `Package` al import de lucide-react si no está ya.

El import actual en EconomicoPrecios.tsx es:
```typescript
import {
  AlertTriangle, ChevronDown, Download, History, Pencil, Plus, ShieldAlert, Trash2,
} from "lucide-react";
```

Cambiar a:
```typescript
import {
  AlertTriangle, ChevronDown, Download, History, Package, Pencil, Plus, ShieldAlert, Trash2,
} from "lucide-react";
```

- [ ] **Step 5: Commit**

```bash
git add src/pages/EconomicoPrecios.tsx
git commit -m "feat(empaque): seccion costes de envasado en pagina de tarifas"
```
