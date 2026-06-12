# Consumos Fisicos Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the redesigned Consumos section so Lasarte can track physical water, electricity, gasoil, and chemical consumption per kg, using partes when available and kg sold as a traceable proxy before partes exist.

**Architecture:** Add a period-based consumption model beside the existing `sesiones_consumo` workflow. Put all physical-unit conversions, kg-base selection, confidence labels, and monthly aggregation in a tested domain helper, then keep the React page focused on queries, forms, tables, and charts. Persist measured resource entries in `consumos_fisicos` and persist non-partes kg bases in `consumos_bases_kg`.

**Tech Stack:** React 18, TypeScript, Vite, Supabase JS, Postgres/RLS migrations, TanStack Query, shadcn/ui, Recharts, Vitest.

---

## File Structure

- Create `src/lib/consumosFisicos.ts`: pure domain logic for unit normalization, kg-base selection, confidence labels, monthly aggregation, and validation issues.
- Create `src/test/consumosFisicos.test.ts`: focused tests for real, estimated, mixed, incomplete, and unit conversion behavior.
- Create `supabase/migrations/20260612120000_consumos_fisicos_periodos.sql`: tables for period consumption entries and kg bases from sales/manual input, with RLS.
- Modify `src/lib/types.ts`: add frontend row interfaces for the new Supabase tables and calculated monthly rows.
- Modify `src/integrations/supabase/types.ts`: add typed Supabase table definitions for `consumos_fisicos` and `consumos_bases_kg`.
- Create `src/hooks/useConsumosFisicos.ts`: fetch new consumption data, kg bases, partes kg, and expose mutations.
- Modify `src/pages/ConsumoCostes.tsx`: replace the current four-tab session surface with Resumen, Registrar, Historico, Validacion, and keep the Maquinas tab as an advanced electricity detail.
- Modify `src/lib/exportConsumo.ts`: export the new period/monthly model with confidence and validation sheets while retaining machine detail.

---

## Task 1: Calculation Domain Helper

**Files:**
- Create: `src/lib/consumosFisicos.ts`
- Create: `src/test/consumosFisicos.test.ts`

- [ ] **Step 1: Write the failing calculation tests**

Create `src/test/consumosFisicos.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  buildMonthlyConsumptionRows,
  kgProducidosParte,
  normalizeConsumoCantidad,
} from "@/lib/consumosFisicos";

describe("consumos fisicos helpers", () => {
  it("normalizes physical units", () => {
    expect(normalizeConsumoCantidad({ recurso: "agua", cantidad: 3, unidad: "m3" })).toEqual({
      cantidadBase: 3000,
      unidadBase: "l",
    });
    expect(normalizeConsumoCantidad({ recurso: "electricidad", cantidad: 125, unidad: "kwh" })).toEqual({
      cantidadBase: 125,
      unidadBase: "kwh",
    });
  });

  it("uses the existing production kg formula from partes", () => {
    expect(kgProducidosParte({
      date: "2026-04-05",
      kg_produccion_calibrador: 10000,
      kg_mujeres_calibrador: 500,
      kg_reciclado_malla_z1: 300,
      kg_reciclado_malla_z2: 200,
    })).toBe(9000);
  });

  it("builds real monthly ratios from partes kg", () => {
    const rows = buildMonthlyConsumptionRows({
      rangeStart: "2026-04-01",
      rangeEnd: "2026-04-30",
      consumos: [
        { id: "agua-1", recurso: "agua", fecha_inicio: "2026-04-01", fecha_fin: "2026-04-30", cantidad: 3000, unidad: "l", fuente: "contador" },
        { id: "luz-1", recurso: "electricidad", fecha_inicio: "2026-04-01", fecha_fin: "2026-04-30", cantidad: 1500, unidad: "kwh", fuente: "contador" },
        { id: "gas-1", recurso: "gasoil", fecha_inicio: "2026-04-01", fecha_fin: "2026-04-30", cantidad: 450, unidad: "l", fuente: "albaran" },
      ],
      partes: [
        { date: "2026-04-05", kg_produccion_calibrador: 10000, kg_mujeres_calibrador: 500, kg_reciclado_malla_z1: 300, kg_reciclado_malla_z2: 200 },
        { date: "2026-04-06", kg_produccion_calibrador: 6000, kg_mujeres_calibrador: 0, kg_reciclado_malla_z1: 0, kg_reciclado_malla_z2: 0 },
      ],
      basesKg: [],
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].confianza).toBe("real");
    expect(rows[0].kgBase).toBe(15000);
    expect(rows[0].aguaLKg).toBeCloseTo(0.2);
    expect(rows[0].electricidadKwhKg).toBeCloseTo(0.1);
    expect(rows[0].gasoilMlKg).toBeCloseTo(30);
  });

  it("uses kg sold as estimated base when no partes exist", () => {
    const rows = buildMonthlyConsumptionRows({
      rangeStart: "2026-03-01",
      rangeEnd: "2026-03-31",
      consumos: [
        { id: "agua-marzo", recurso: "agua", fecha_inicio: "2026-03-01", fecha_fin: "2026-03-31", cantidad: 2, unidad: "m3", fuente: "factura_detallada" },
      ],
      partes: [],
      basesKg: [
        { id: "ventas-marzo", tipo_base: "ventas", fecha_inicio: "2026-03-01", fecha_fin: "2026-03-31", kg: 10000 },
      ],
    });

    expect(rows[0].confianza).toBe("estimado");
    expect(rows[0].kgBase).toBe(10000);
    expect(rows[0].aguaLKg).toBeCloseTo(0.2);
  });

  it("marks a month as mixed when partes and proxy kg coexist", () => {
    const rows = buildMonthlyConsumptionRows({
      rangeStart: "2026-04-01",
      rangeEnd: "2026-04-30",
      consumos: [
        { id: "gas-abril", recurso: "gasoil", fecha_inicio: "2026-04-01", fecha_fin: "2026-04-30", cantidad: 300, unidad: "l", fuente: "albaran" },
      ],
      partes: [
        { date: "2026-04-15", kg_produccion_calibrador: 12000, kg_mujeres_calibrador: 0, kg_reciclado_malla_z1: 0, kg_reciclado_malla_z2: 0 },
      ],
      basesKg: [
        { id: "ventas-abril", tipo_base: "ventas", fecha_inicio: "2026-04-01", fecha_fin: "2026-04-30", kg: 8000 },
      ],
    });

    expect(rows[0].confianza).toBe("mixto");
    expect(rows[0].kgBase).toBe(12000);
    expect(rows[0].kgVentas).toBe(8000);
  });

  it("marks incomplete rows when consumption or kg base is missing", () => {
    const rows = buildMonthlyConsumptionRows({
      rangeStart: "2026-02-01",
      rangeEnd: "2026-02-28",
      consumos: [],
      partes: [],
      basesKg: [],
    });

    expect(rows[0].confianza).toBe("incompleto");
    expect(rows[0].issues).toContain("Sin consumo fisico registrado");
    expect(rows[0].issues).toContain("Sin kg base para calcular ratios");
  });
});
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
npx vitest run src/test/consumosFisicos.test.ts
```

Expected: FAIL because `src/lib/consumosFisicos.ts` does not exist.

- [ ] **Step 3: Add the calculation helper**

Create `src/lib/consumosFisicos.ts`:

```ts
export type ConsumoRecurso = "agua" | "electricidad" | "gasoil" | "quimicos";
export type ConsumoUnidad = "l" | "m3" | "kwh";
export type ConsumoFuente = "contador" | "factura_detallada" | "albaran" | "estimacion_manual";
export type BaseKgTipo = "ventas" | "manual";
export type ConsumoConfianza = "real" | "estimado" | "mixto" | "incompleto";

export interface ConsumoFisicoInput {
  id: string;
  recurso: ConsumoRecurso;
  fecha_inicio: string;
  fecha_fin: string;
  cantidad: number;
  unidad: ConsumoUnidad;
  fuente: ConsumoFuente;
}

export interface BaseKgInput {
  id: string;
  tipo_base: BaseKgTipo;
  fecha_inicio: string;
  fecha_fin: string;
  kg: number;
}

export interface ParteKgInput {
  date: string;
  kg_produccion_calibrador: number | null;
  kg_mujeres_calibrador: number | null;
  kg_reciclado_malla_z1: number | null;
  kg_reciclado_malla_z2: number | null;
}

export interface NormalizedConsumo {
  cantidadBase: number;
  unidadBase: "l" | "kwh";
}

export interface ConsumoPeriodoRow {
  periodo: string;
  fechaInicio: string;
  fechaFin: string;
  kgPartes: number;
  kgVentas: number;
  kgManual: number;
  kgBase: number;
  baseUsada: "partes" | "ventas" | "manual" | "sin_base";
  confianza: ConsumoConfianza;
  aguaL: number;
  electricidadKwh: number;
  gasoilL: number;
  quimicosL: number;
  aguaLKg: number | null;
  electricidadKwhKg: number | null;
  gasoilMlKg: number | null;
  gasoilLT: number | null;
  quimicosMlKg: number | null;
  issues: string[];
}

interface BuildRowsInput {
  rangeStart: string;
  rangeEnd: string;
  consumos: ConsumoFisicoInput[];
  partes: ParteKgInput[];
  basesKg: BaseKgInput[];
}

const MS_DAY = 24 * 60 * 60 * 1000;

function n(value: unknown): number {
  return Number(value) || 0;
}

function utcDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function iso(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function daysInclusive(start: string, end: string): number {
  return Math.max(0, Math.floor((utcDate(end).getTime() - utcDate(start).getTime()) / MS_DAY) + 1);
}

function overlapDays(aStart: string, aEnd: string, bStart: string, bEnd: string): number {
  const start = Math.max(utcDate(aStart).getTime(), utcDate(bStart).getTime());
  const end = Math.min(utcDate(aEnd).getTime(), utcDate(bEnd).getTime());
  if (end < start) return 0;
  return Math.floor((end - start) / MS_DAY) + 1;
}

function monthRanges(rangeStart: string, rangeEnd: string) {
  const ranges: Array<{ periodo: string; fechaInicio: string; fechaFin: string }> = [];
  let cursor = utcDate(rangeStart);
  const final = utcDate(rangeEnd);

  while (cursor <= final) {
    const year = cursor.getUTCFullYear();
    const month = cursor.getUTCMonth();
    const first = new Date(Date.UTC(year, month, 1));
    const last = new Date(Date.UTC(year, month + 1, 0));
    const fechaInicio = iso(cursor > first ? cursor : first);
    const fechaFin = iso(final < last ? final : last);
    ranges.push({
      periodo: `${year}-${String(month + 1).padStart(2, "0")}`,
      fechaInicio,
      fechaFin,
    });
    cursor = new Date(Date.UTC(year, month + 1, 1));
  }

  return ranges;
}

export function normalizeConsumoCantidad(input: Pick<ConsumoFisicoInput, "recurso" | "cantidad" | "unidad">): NormalizedConsumo {
  if (input.recurso === "electricidad") {
    return { cantidadBase: n(input.cantidad), unidadBase: "kwh" };
  }

  if (input.unidad === "m3") {
    return { cantidadBase: n(input.cantidad) * 1000, unidadBase: "l" };
  }

  return { cantidadBase: n(input.cantidad), unidadBase: "l" };
}

export function kgProducidosParte(parte: ParteKgInput): number {
  return n(parte.kg_produccion_calibrador)
    - n(parte.kg_mujeres_calibrador)
    - n(parte.kg_reciclado_malla_z1)
    - n(parte.kg_reciclado_malla_z2);
}

function proratedAmount(itemStart: string, itemEnd: string, amount: number, targetStart: string, targetEnd: string): number {
  const overlap = overlapDays(itemStart, itemEnd, targetStart, targetEnd);
  if (overlap <= 0) return 0;
  const totalDays = daysInclusive(itemStart, itemEnd) || 1;
  return (amount * overlap) / totalDays;
}

function ratio(value: number, kg: number): number | null {
  return kg > 0 ? value / kg : null;
}

function confidence(kgPartes: number, kgProxy: number, hasConsumption: boolean): ConsumoConfianza {
  if (!hasConsumption || (kgPartes <= 0 && kgProxy <= 0)) return "incompleto";
  if (kgPartes > 0 && kgProxy > 0) return "mixto";
  if (kgPartes > 0) return "real";
  return "estimado";
}

export function buildMonthlyConsumptionRows(input: BuildRowsInput): ConsumoPeriodoRow[] {
  return monthRanges(input.rangeStart, input.rangeEnd).map((month) => {
    const kgPartes = input.partes
      .filter((parte) => parte.date >= month.fechaInicio && parte.date <= month.fechaFin)
      .reduce((sum, parte) => sum + kgProducidosParte(parte), 0);

    const kgVentas = input.basesKg
      .filter((base) => base.tipo_base === "ventas")
      .reduce((sum, base) => sum + proratedAmount(base.fecha_inicio, base.fecha_fin, base.kg, month.fechaInicio, month.fechaFin), 0);

    const kgManual = input.basesKg
      .filter((base) => base.tipo_base === "manual")
      .reduce((sum, base) => sum + proratedAmount(base.fecha_inicio, base.fecha_fin, base.kg, month.fechaInicio, month.fechaFin), 0);

    let aguaL = 0;
    let electricidadKwh = 0;
    let gasoilL = 0;
    let quimicosL = 0;

    input.consumos.forEach((consumo) => {
      const normalized = normalizeConsumoCantidad(consumo);
      const amount = proratedAmount(consumo.fecha_inicio, consumo.fecha_fin, normalized.cantidadBase, month.fechaInicio, month.fechaFin);
      if (consumo.recurso === "agua") aguaL += amount;
      if (consumo.recurso === "electricidad") electricidadKwh += amount;
      if (consumo.recurso === "gasoil") gasoilL += amount;
      if (consumo.recurso === "quimicos") quimicosL += amount;
    });

    const kgProxy = kgVentas + kgManual;
    const kgBase = kgPartes > 0 ? kgPartes : kgVentas > 0 ? kgVentas : kgManual;
    const baseUsada = kgPartes > 0 ? "partes" : kgVentas > 0 ? "ventas" : kgManual > 0 ? "manual" : "sin_base";
    const hasConsumption = aguaL + electricidadKwh + gasoilL + quimicosL > 0;
    const issues: string[] = [];

    if (!hasConsumption) issues.push("Sin consumo fisico registrado");
    if (kgBase <= 0) issues.push("Sin kg base para calcular ratios");
    if (kgPartes > 0 && kgProxy > 0) issues.push("Periodo con partes y kg proxy; el KPI usa partes");

    return {
      periodo: month.periodo,
      fechaInicio: month.fechaInicio,
      fechaFin: month.fechaFin,
      kgPartes: +kgPartes.toFixed(2),
      kgVentas: +kgVentas.toFixed(2),
      kgManual: +kgManual.toFixed(2),
      kgBase: +kgBase.toFixed(2),
      baseUsada,
      confianza: confidence(kgPartes, kgProxy, hasConsumption),
      aguaL: +aguaL.toFixed(2),
      electricidadKwh: +electricidadKwh.toFixed(2),
      gasoilL: +gasoilL.toFixed(2),
      quimicosL: +quimicosL.toFixed(2),
      aguaLKg: ratio(aguaL, kgBase),
      electricidadKwhKg: ratio(electricidadKwh, kgBase),
      gasoilMlKg: kgBase > 0 ? (gasoilL * 1000) / kgBase : null,
      gasoilLT: kgBase > 0 ? gasoilL / (kgBase / 1000) : null,
      quimicosMlKg: kgBase > 0 ? (quimicosL * 1000) / kgBase : null,
      issues,
    };
  });
}
```

- [ ] **Step 4: Run the helper tests**

Run:

```bash
npx vitest run src/test/consumosFisicos.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the helper**

Run:

```bash
git add src/lib/consumosFisicos.ts src/test/consumosFisicos.test.ts
git commit -m "feat: add physical consumption calculations"
```

---

## Task 2: Supabase Schema And Types

**Files:**
- Create: `supabase/migrations/20260612120000_consumos_fisicos_periodos.sql`
- Modify: `src/lib/types.ts`
- Modify: `src/integrations/supabase/types.ts`

- [ ] **Step 1: Add the migration**

Before applying schema changes, run:

```bash
npx supabase --version
npx supabase migration new consumos_fisicos_periodos
```

Use the generated migration command to keep Supabase history clean. Copy the SQL below into `supabase/migrations/20260612120000_consumos_fisicos_periodos.sql` if the generated path is not being used in this worktree:

```sql
-- =============================================================================
-- MIGRACION: Consumos fisicos por periodo y bases kg proxy
-- =============================================================================

CREATE TABLE public.consumos_fisicos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  recurso TEXT NOT NULL CHECK (recurso IN ('agua', 'electricidad', 'gasoil', 'quimicos')),
  fecha_inicio DATE NOT NULL,
  fecha_fin DATE NOT NULL,
  cantidad NUMERIC NOT NULL DEFAULT 0 CHECK (cantidad >= 0),
  unidad TEXT NOT NULL CHECK (unidad IN ('l', 'm3', 'kwh')),
  fuente TEXT NOT NULL CHECK (fuente IN ('contador', 'factura_detallada', 'albaran', 'estimacion_manual')),
  referencia TEXT,
  notas TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT consumos_fisicos_fechas_check CHECK (fecha_fin >= fecha_inicio)
);

CREATE INDEX idx_consumos_fisicos_user_fecha ON public.consumos_fisicos(user_id, fecha_inicio DESC);
CREATE INDEX idx_consumos_fisicos_recurso_fecha ON public.consumos_fisicos(recurso, fecha_inicio DESC);

ALTER TABLE public.consumos_fisicos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "consumos_fisicos_select_all_authenticated"
  ON public.consumos_fisicos FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "consumos_fisicos_insert_own"
  ON public.consumos_fisicos FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "consumos_fisicos_update_own_or_admin"
  ON public.consumos_fisicos FOR UPDATE
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "consumos_fisicos_delete_own_or_admin"
  ON public.consumos_fisicos FOR DELETE
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

CREATE TABLE public.consumos_bases_kg (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tipo_base TEXT NOT NULL CHECK (tipo_base IN ('ventas', 'manual')),
  fecha_inicio DATE NOT NULL,
  fecha_fin DATE NOT NULL,
  kg NUMERIC NOT NULL DEFAULT 0 CHECK (kg >= 0),
  referencia TEXT,
  notas TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT consumos_bases_kg_fechas_check CHECK (fecha_fin >= fecha_inicio)
);

CREATE INDEX idx_consumos_bases_kg_user_fecha ON public.consumos_bases_kg(user_id, fecha_inicio DESC);
CREATE INDEX idx_consumos_bases_kg_tipo_fecha ON public.consumos_bases_kg(tipo_base, fecha_inicio DESC);

ALTER TABLE public.consumos_bases_kg ENABLE ROW LEVEL SECURITY;

CREATE POLICY "consumos_bases_kg_select_all_authenticated"
  ON public.consumos_bases_kg FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "consumos_bases_kg_insert_own"
  ON public.consumos_bases_kg FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "consumos_bases_kg_update_own_or_admin"
  ON public.consumos_bases_kg FOR UPDATE
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "consumos_bases_kg_delete_own_or_admin"
  ON public.consumos_bases_kg FOR DELETE
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));
```

- [ ] **Step 2: Add frontend row interfaces**

Add these interfaces to `src/lib/types.ts` after `ConsumoMaquinaRow`:

```ts
export interface ConsumoFisicoRow {
  id: string;
  user_id: string;
  recurso: "agua" | "electricidad" | "gasoil" | "quimicos";
  fecha_inicio: string;
  fecha_fin: string;
  cantidad: number;
  unidad: "l" | "m3" | "kwh";
  fuente: "contador" | "factura_detallada" | "albaran" | "estimacion_manual";
  referencia: string | null;
  notas: string | null;
  created_at: string;
}

export interface ConsumoBaseKgRow {
  id: string;
  user_id: string;
  tipo_base: "ventas" | "manual";
  fecha_inicio: string;
  fecha_fin: string;
  kg: number;
  referencia: string | null;
  notas: string | null;
  created_at: string;
}
```

- [ ] **Step 3: Add Supabase generated table types**

In `src/integrations/supabase/types.ts`, add `consumos_fisicos` and `consumos_bases_kg` inside `Database["public"]["Tables"]` near the existing `consumo_maquinas` and `sesiones_consumo` definitions:

```ts
      consumos_fisicos: {
        Row: {
          cantidad: number
          created_at: string
          fecha_fin: string
          fecha_inicio: string
          fuente: "contador" | "factura_detallada" | "albaran" | "estimacion_manual"
          id: string
          notas: string | null
          recurso: "agua" | "electricidad" | "gasoil" | "quimicos"
          referencia: string | null
          unidad: "l" | "m3" | "kwh"
          user_id: string
        }
        Insert: {
          cantidad?: number
          created_at?: string
          fecha_fin: string
          fecha_inicio: string
          fuente: "contador" | "factura_detallada" | "albaran" | "estimacion_manual"
          id?: string
          notas?: string | null
          recurso: "agua" | "electricidad" | "gasoil" | "quimicos"
          referencia?: string | null
          unidad: "l" | "m3" | "kwh"
          user_id: string
        }
        Update: {
          cantidad?: number
          created_at?: string
          fecha_fin?: string
          fecha_inicio?: string
          fuente?: "contador" | "factura_detallada" | "albaran" | "estimacion_manual"
          id?: string
          notas?: string | null
          recurso?: "agua" | "electricidad" | "gasoil" | "quimicos"
          referencia?: string | null
          unidad?: "l" | "m3" | "kwh"
          user_id?: string
        }
        Relationships: []
      }
      consumos_bases_kg: {
        Row: {
          created_at: string
          fecha_fin: string
          fecha_inicio: string
          id: string
          kg: number
          notas: string | null
          referencia: string | null
          tipo_base: "ventas" | "manual"
          user_id: string
        }
        Insert: {
          created_at?: string
          fecha_fin: string
          fecha_inicio: string
          id?: string
          kg?: number
          notas?: string | null
          referencia?: string | null
          tipo_base: "ventas" | "manual"
          user_id: string
        }
        Update: {
          created_at?: string
          fecha_fin?: string
          fecha_inicio?: string
          id?: string
          kg?: number
          notas?: string | null
          referencia?: string | null
          tipo_base?: "ventas" | "manual"
          user_id?: string
        }
        Relationships: []
      }
```

- [ ] **Step 4: Run type and migration checks**

Run:

```bash
npm run build
```

Expected: PASS.

If local Supabase is available, also run:

```bash
npx supabase migration list --local
```

Expected: the new migration appears in the local migration list.

- [ ] **Step 5: Commit the schema and types**

Run:

```bash
git add supabase/migrations/20260612120000_consumos_fisicos_periodos.sql src/lib/types.ts src/integrations/supabase/types.ts
git commit -m "feat: add physical consumption schema"
```

---

## Task 3: Data Hook For Consumption Section

**Files:**
- Create: `src/hooks/useConsumosFisicos.ts`
- Modify: `src/pages/ConsumoCostes.tsx`

- [ ] **Step 1: Create the hook**

Create `src/hooks/useConsumosFisicos.ts`:

```ts
import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthProvider";
import {
  buildMonthlyConsumptionRows,
  BaseKgInput,
  ConsumoFisicoInput,
  ParteKgInput,
} from "@/lib/consumosFisicos";
import { ConsumoBaseKgRow, ConsumoFisicoRow } from "@/lib/types";
import { today } from "@/lib/format";

export interface ConsumoFisicoFormValues {
  recurso: ConsumoFisicoRow["recurso"];
  fecha_inicio: string;
  fecha_fin: string;
  cantidad: number;
  unidad: ConsumoFisicoRow["unidad"];
  fuente: ConsumoFisicoRow["fuente"];
  referencia: string | null;
  notas: string | null;
}

export interface ConsumoBaseKgFormValues {
  tipo_base: ConsumoBaseKgRow["tipo_base"];
  fecha_inicio: string;
  fecha_fin: string;
  kg: number;
  referencia: string | null;
  notas: string | null;
}

export function useConsumosFisicos(rangeStart = "2025-09-01", rangeEnd = today()) {
  const { user } = useAuth();
  const qc = useQueryClient();

  const consumosQuery = useQuery({
    queryKey: ["consumos_fisicos"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("consumos_fisicos")
        .select("*")
        .order("fecha_inicio", { ascending: false });
      if (error) throw error;
      return (data ?? []) as ConsumoFisicoRow[];
    },
  });

  const basesQuery = useQuery({
    queryKey: ["consumos_bases_kg"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("consumos_bases_kg")
        .select("*")
        .order("fecha_inicio", { ascending: false });
      if (error) throw error;
      return (data ?? []) as ConsumoBaseKgRow[];
    },
  });

  const partesQuery = useQuery({
    queryKey: ["partes_consumos_kg", rangeStart, rangeEnd],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("partes_diarios")
        .select("date, kg_produccion_calibrador, kg_mujeres_calibrador, kg_reciclado_malla_z1, kg_reciclado_malla_z2")
        .gte("date", rangeStart)
        .lte("date", rangeEnd);
      if (error) throw error;
      return (data ?? []) as ParteKgInput[];
    },
  });

  const addConsumo = useMutation({
    mutationFn: async (values: ConsumoFisicoFormValues) => {
      if (!user) throw new Error("No auth");
      const { error } = await supabase.from("consumos_fisicos").insert({
        ...values,
        user_id: user.id,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["consumos_fisicos"] }),
  });

  const addBaseKg = useMutation({
    mutationFn: async (values: ConsumoBaseKgFormValues) => {
      if (!user) throw new Error("No auth");
      const { error } = await supabase.from("consumos_bases_kg").insert({
        ...values,
        user_id: user.id,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["consumos_bases_kg"] }),
  });

  const deleteConsumo = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("consumos_fisicos").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["consumos_fisicos"] }),
  });

  const deleteBaseKg = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("consumos_bases_kg").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["consumos_bases_kg"] }),
  });

  const monthlyRows = useMemo(() => buildMonthlyConsumptionRows({
    rangeStart,
    rangeEnd,
    consumos: (consumosQuery.data ?? []) as ConsumoFisicoInput[],
    basesKg: (basesQuery.data ?? []) as BaseKgInput[],
    partes: partesQuery.data ?? [],
  }), [basesQuery.data, consumosQuery.data, partesQuery.data, rangeEnd, rangeStart]);

  return {
    consumos: consumosQuery.data ?? [],
    basesKg: basesQuery.data ?? [],
    partes: partesQuery.data ?? [],
    monthlyRows,
    isLoading: consumosQuery.isLoading || basesQuery.isLoading || partesQuery.isLoading,
    addConsumo,
    addBaseKg,
    deleteConsumo,
    deleteBaseKg,
  };
}
```

- [ ] **Step 2: Import the hook in the page without rendering it yet**

In `src/pages/ConsumoCostes.tsx`, add:

```ts
import { useConsumosFisicos } from "@/hooks/useConsumosFisicos";
```

Inside `ConsumoCostes`, after `const [tab, setTab] = useState("sesion");`, add:

```ts
  const consumosFisicos = useConsumosFisicos();
```

- [ ] **Step 3: Run build**

Run:

```bash
npm run build
```

Expected: PASS.

- [ ] **Step 4: Commit the hook**

Run:

```bash
git add src/hooks/useConsumosFisicos.ts src/pages/ConsumoCostes.tsx
git commit -m "feat: add physical consumption data hook"
```

---

## Task 4: Register And Base Kg UI

**Files:**
- Modify: `src/pages/ConsumoCostes.tsx`

- [ ] **Step 1: Add form state for period-based consumption**

Inside `ConsumoCostes`, add the form state after `const consumosFisicos = useConsumosFisicos();`:

```ts
  const [cfRecurso, setCfRecurso] = useState<"agua" | "electricidad" | "gasoil" | "quimicos">("gasoil");
  const [cfInicio, setCfInicio] = useState("2025-09-01");
  const [cfFin, setCfFin] = useState(today());
  const [cfCantidad, setCfCantidad] = useState("");
  const [cfUnidad, setCfUnidad] = useState<"l" | "m3" | "kwh">("l");
  const [cfFuente, setCfFuente] = useState<"contador" | "factura_detallada" | "albaran" | "estimacion_manual">("albaran");
  const [cfReferencia, setCfReferencia] = useState("");
  const [cfNotas, setCfNotas] = useState("");
  const [baseTipo, setBaseTipo] = useState<"ventas" | "manual">("ventas");
  const [baseInicio, setBaseInicio] = useState("2025-09-01");
  const [baseFin, setBaseFin] = useState(today());
  const [baseKg, setBaseKg] = useState("");
  const [baseReferencia, setBaseReferencia] = useState("");
  const [baseNotas, setBaseNotas] = useState("");
```

- [ ] **Step 2: Add submit handlers**

Inside `ConsumoCostes`, add these handlers after the form state:

```ts
  const guardarConsumoFisico = () => {
    const cantidad = Number(cfCantidad) || 0;
    if (cantidad <= 0) {
      toast({ title: "Cantidad requerida", description: "Introduce una cantidad fisica mayor que cero.", variant: "destructive" });
      return;
    }
    consumosFisicos.addConsumo.mutate({
      recurso: cfRecurso,
      fecha_inicio: cfInicio,
      fecha_fin: cfFin,
      cantidad,
      unidad: cfUnidad,
      fuente: cfFuente,
      referencia: cfReferencia || null,
      notas: cfNotas || null,
    }, {
      onSuccess: () => {
        toast({ title: "Consumo guardado" });
        setCfCantidad("");
        setCfReferencia("");
        setCfNotas("");
      },
      onError: (e) => toast({ title: "Error", description: e instanceof Error ? e.message : String(e), variant: "destructive" }),
    });
  };

  const guardarBaseKg = () => {
    const kg = Number(baseKg) || 0;
    if (kg <= 0) {
      toast({ title: "Kg requeridos", description: "Introduce kg vendidos o manuales mayores que cero.", variant: "destructive" });
      return;
    }
    consumosFisicos.addBaseKg.mutate({
      tipo_base: baseTipo,
      fecha_inicio: baseInicio,
      fecha_fin: baseFin,
      kg,
      referencia: baseReferencia || null,
      notas: baseNotas || null,
    }, {
      onSuccess: () => {
        toast({ title: "Base kg guardada" });
        setBaseKg("");
        setBaseReferencia("");
        setBaseNotas("");
      },
      onError: (e) => toast({ title: "Error", description: e instanceof Error ? e.message : String(e), variant: "destructive" }),
    });
  };
```

- [ ] **Step 3: Replace tab labels**

Replace the current `TabsList` triggers in `src/pages/ConsumoCostes.tsx` with:

```tsx
          <TabsList className="grid w-full grid-cols-2 md:w-auto md:grid-cols-5">
            <TabsTrigger value="resumen"><BarChart3 className="h-4 w-4 mr-1.5" />Resumen</TabsTrigger>
            <TabsTrigger value="registrar"><Save className="h-4 w-4 mr-1.5" />Registrar</TabsTrigger>
            <TabsTrigger value="historico"><History className="h-4 w-4 mr-1.5" />Historico</TabsTrigger>
            <TabsTrigger value="validacion"><FileText className="h-4 w-4 mr-1.5" />Validacion</TabsTrigger>
            <TabsTrigger value="maquinas"><Settings className="h-4 w-4 mr-1.5" />Maquinas</TabsTrigger>
          </TabsList>
```

Change the tab default:

```ts
  const [tab, setTab] = useState("resumen");
```

- [ ] **Step 4: Add the Registrar tab**

Replace the old `TabsContent value="sesion"` block with:

```tsx
          <TabsContent value="registrar" className="space-y-6">
            <Card className="glass-accented">
              <CardHeader>
                <p className="panel-kicker">Consumo fisico</p>
                <CardTitle>Registrar recurso medido</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-5 md:grid-cols-3">
                <div className="glass p-4 space-y-2">
                  <Label>Recurso</Label>
                  <Select value={cfRecurso} onValueChange={(v) => setCfRecurso(v as typeof cfRecurso)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="agua">Agua</SelectItem>
                      <SelectItem value="electricidad">Electricidad</SelectItem>
                      <SelectItem value="gasoil">Gasoil</SelectItem>
                      <SelectItem value="quimicos">Quimicos</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="glass p-4 space-y-2">
                  <Label>Fecha inicio</Label>
                  <ConsumoDatePicker value={cfInicio} onChange={setCfInicio} />
                </div>
                <div className="glass p-4 space-y-2">
                  <Label>Fecha fin</Label>
                  <ConsumoDatePicker value={cfFin} onChange={setCfFin} />
                </div>
                <div className="glass p-4 space-y-2">
                  <Label>Cantidad fisica</Label>
                  <Input type="number" step="0.01" min="0" value={cfCantidad} onChange={(e) => setCfCantidad(e.target.value)} />
                </div>
                <div className="glass p-4 space-y-2">
                  <Label>Unidad</Label>
                  <Select value={cfUnidad} onValueChange={(v) => setCfUnidad(v as typeof cfUnidad)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="l">Litros</SelectItem>
                      <SelectItem value="m3">m3</SelectItem>
                      <SelectItem value="kwh">kWh</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="glass p-4 space-y-2">
                  <Label>Fuente</Label>
                  <Select value={cfFuente} onValueChange={(v) => setCfFuente(v as typeof cfFuente)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="contador">Contador</SelectItem>
                      <SelectItem value="factura_detallada">Factura detallada</SelectItem>
                      <SelectItem value="albaran">Albaran</SelectItem>
                      <SelectItem value="estimacion_manual">Estimacion manual</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="glass p-4 space-y-2">
                  <Label>Referencia</Label>
                  <Input value={cfReferencia} onChange={(e) => setCfReferencia(e.target.value)} placeholder="Factura, contador o albaran" />
                </div>
                <div className="glass p-4 space-y-2 md:col-span-2">
                  <Label>Notas</Label>
                  <Input value={cfNotas} onChange={(e) => setCfNotas(e.target.value)} placeholder="Opcional" />
                </div>
              </CardContent>
              <CardContent className="flex justify-end pt-0">
                <Button onClick={guardarConsumoFisico} disabled={consumosFisicos.addConsumo.isPending} className="glass glass-hover">
                  <Save className="h-4 w-4 mr-2" /> Guardar consumo
                </Button>
              </CardContent>
            </Card>

            <Card className="glass-accented">
              <CardHeader>
                <p className="panel-kicker">Base kg</p>
                <CardTitle>Registrar kg vendidos o manuales</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-5 md:grid-cols-3">
                <div className="glass p-4 space-y-2">
                  <Label>Tipo</Label>
                  <Select value={baseTipo} onValueChange={(v) => setBaseTipo(v as typeof baseTipo)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ventas">Ventas</SelectItem>
                      <SelectItem value="manual">Manual</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="glass p-4 space-y-2">
                  <Label>Fecha inicio</Label>
                  <ConsumoDatePicker value={baseInicio} onChange={setBaseInicio} />
                </div>
                <div className="glass p-4 space-y-2">
                  <Label>Fecha fin</Label>
                  <ConsumoDatePicker value={baseFin} onChange={setBaseFin} />
                </div>
                <div className="glass p-4 space-y-2">
                  <Label>Kg</Label>
                  <Input type="number" step="0.1" min="0" value={baseKg} onChange={(e) => setBaseKg(e.target.value)} />
                </div>
                <div className="glass p-4 space-y-2">
                  <Label>Referencia</Label>
                  <Input value={baseReferencia} onChange={(e) => setBaseReferencia(e.target.value)} placeholder="Archivo ventas, hoja o ajuste" />
                </div>
                <div className="glass p-4 space-y-2">
                  <Label>Notas</Label>
                  <Input value={baseNotas} onChange={(e) => setBaseNotas(e.target.value)} placeholder="Opcional" />
                </div>
              </CardContent>
              <CardContent className="flex justify-end pt-0">
                <Button onClick={guardarBaseKg} disabled={consumosFisicos.addBaseKg.isPending} className="glass glass-hover">
                  <Save className="h-4 w-4 mr-2" /> Guardar base kg
                </Button>
              </CardContent>
            </Card>
          </TabsContent>
```

- [ ] **Step 5: Run build**

Run:

```bash
npm run build
```

Expected: PASS.

- [ ] **Step 6: Commit the register UI**

Run:

```bash
git add src/pages/ConsumoCostes.tsx
git commit -m "feat: add consumption period registration"
```

---

## Task 5: Summary, History, And Validation UI

**Files:**
- Modify: `src/pages/ConsumoCostes.tsx`

- [ ] **Step 1: Add formatting helpers in the page**

Inside `ConsumoCostes`, add these helpers near `pct`:

```ts
  const ratioText = (value: number | null | undefined, digits: number, suffix: string) =>
    value == null ? "-" : `${formatNumber(value, digits)} ${suffix}`;

  const confianzaLabel = {
    real: "Real",
    estimado: "Estimado",
    mixto: "Mixto",
    incompleto: "Incompleto",
  } as const;

  const confianzaClass = {
    real: "bg-success/10 text-success border-success/20",
    estimado: "bg-warning/10 text-warning border-warning/20",
    mixto: "bg-info/10 text-info border-info/20",
    incompleto: "bg-destructive/10 text-destructive border-destructive/20",
  } as const;

  const rows = consumosFisicos.monthlyRows;
  const selectedRows = rows.filter((r) => r.kgBase > 0 || r.aguaL + r.electricidadKwh + r.gasoilL + r.quimicosL > 0);
  const totalKgBase = selectedRows.reduce((s, r) => s + r.kgBase, 0);
  const totalAguaL = selectedRows.reduce((s, r) => s + r.aguaL, 0);
  const totalElectricidadKwh = selectedRows.reduce((s, r) => s + r.electricidadKwh, 0);
  const totalGasoilL = selectedRows.reduce((s, r) => s + r.gasoilL, 0);
  const totalQuimicosL = selectedRows.reduce((s, r) => s + r.quimicosL, 0);
```

- [ ] **Step 2: Add the Resumen tab**

Replace the old `TabsContent value="resultados"` block with:

```tsx
          <TabsContent value="resumen" className="space-y-6">
            <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <KPICard label="Agua" value={ratioText(totalKgBase > 0 ? totalAguaL / totalKgBase : null, 2, "L/kg")} icon={Droplet} className="glass-accented" />
              <KPICard label="Electricidad" value={ratioText(totalKgBase > 0 ? totalElectricidadKwh / totalKgBase : null, 3, "kWh/kg")} icon={Zap} className="glass-accented" />
              <KPICard label="Gasoil" value={ratioText(totalKgBase > 0 ? (totalGasoilL * 1000) / totalKgBase : null, 1, "mL/kg")} icon={Fuel} className="glass-accented" />
              <KPICard label="Quimicos" value={ratioText(totalKgBase > 0 ? (totalQuimicosL * 1000) / totalKgBase : null, 1, "mL/kg")} icon={FlaskConical} className="glass-accented" />
            </section>

            <Card className="glass-accented">
              <CardHeader>
                <p className="panel-kicker">Campana</p>
                <CardTitle>{formatNumber(totalKgBase, 0)} kg base usados</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <div className="glass p-4">
                  <p className="text-xs text-muted-foreground">Agua total</p>
                  <p className="text-2xl font-bold">{formatNumber(totalAguaL, 0)} L</p>
                </div>
                <div className="glass p-4">
                  <p className="text-xs text-muted-foreground">Electricidad total</p>
                  <p className="text-2xl font-bold">{formatNumber(totalElectricidadKwh, 0)} kWh</p>
                </div>
                <div className="glass p-4">
                  <p className="text-xs text-muted-foreground">Gasoil total</p>
                  <p className="text-2xl font-bold">{formatNumber(totalGasoilL, 0)} L</p>
                </div>
                <div className="glass p-4">
                  <p className="text-xs text-muted-foreground">Quimicos total</p>
                  <p className="text-2xl font-bold">{formatNumber(totalQuimicosL, 0)} L</p>
                </div>
              </CardContent>
            </Card>

            {selectedRows.length > 1 && (
              <Card className="glass-accented">
                <CardHeader>
                  <CardTitle>Evolucion mensual</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className={CHART_PANEL_CLASS}>
                    <ResponsiveContainer width="100%" height={320}>
                      <LineChart data={selectedRows} margin={MARGIN}>
                        <CartesianGrid {...GRID} />
                        <XAxis dataKey="periodo" {...XAXIS} />
                        <YAxis {...YAXIS} />
                        <Tooltip cursor={CHART_LINE_CURSOR} content={<GlassTooltip formatter={(v, n) => `${Number(v).toFixed(3)} ${String(n)}`} />} />
                        <Legend wrapperStyle={legendStyle} />
                        <Line dataKey="aguaLKg" name="Agua L/kg" {...lineStyle(C.info)} />
                        <Line dataKey="electricidadKwhKg" name="Electricidad kWh/kg" {...lineStyle(C.warning)} />
                        <Line dataKey="gasoilMlKg" name="Gasoil mL/kg" {...lineStyle(C.primary)} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>
```

- [ ] **Step 3: Add the Historico tab**

Replace the old `TabsContent value="historico"` block with:

```tsx
          <TabsContent value="historico" className="space-y-6">
            <Card className="glass-accented">
              <CardHeader>
                <p className="panel-kicker">Mensual</p>
                <CardTitle>Consumos fisicos por kg</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Periodo</TableHead>
                      <TableHead>Confianza</TableHead>
                      <TableHead className="text-right">Kg partes</TableHead>
                      <TableHead className="text-right">Kg ventas</TableHead>
                      <TableHead className="text-right">Kg base</TableHead>
                      <TableHead className="text-right">Agua L/kg</TableHead>
                      <TableHead className="text-right">kWh/kg</TableHead>
                      <TableHead className="text-right">Gasoil mL/kg</TableHead>
                      <TableHead className="text-right">Quimicos mL/kg</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((row) => (
                      <TableRow key={row.periodo}>
                        <TableCell className="font-medium">{row.periodo}</TableCell>
                        <TableCell>
                          <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold ${confianzaClass[row.confianza]}`}>
                            {confianzaLabel[row.confianza]}
                          </span>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{formatNumber(row.kgPartes, 0)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatNumber(row.kgVentas, 0)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatNumber(row.kgBase, 0)}</TableCell>
                        <TableCell className="text-right tabular-nums">{ratioText(row.aguaLKg, 2, "")}</TableCell>
                        <TableCell className="text-right tabular-nums">{ratioText(row.electricidadKwhKg, 3, "")}</TableCell>
                        <TableCell className="text-right tabular-nums">{ratioText(row.gasoilMlKg, 1, "")}</TableCell>
                        <TableCell className="text-right tabular-nums">{ratioText(row.quimicosMlKg, 1, "")}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
```

- [ ] **Step 4: Add the Validacion tab**

Add this `TabsContent` before the Maquinas tab:

```tsx
          <TabsContent value="validacion" className="space-y-6">
            <Card className="glass-accented">
              <CardHeader>
                <p className="panel-kicker">Calidad del dato</p>
                <CardTitle>Periodos que necesitan revision</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Periodo</TableHead>
                      <TableHead>Estado</TableHead>
                      <TableHead>Observaciones</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.filter((row) => row.issues.length > 0).map((row) => (
                      <TableRow key={row.periodo}>
                        <TableCell>{row.periodo}</TableCell>
                        <TableCell>
                          <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold ${confianzaClass[row.confianza]}`}>
                            {confianzaLabel[row.confianza]}
                          </span>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">{row.issues.join(" | ")}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
```

- [ ] **Step 5: Remove dead old session UI code when build identifies it**

Delete unused state and mutations only after the new tabs compile:

```ts
// Remove fInicio, fFin, fKg, fAguaLinea, fAguaDrencher, fQuimicos, fGasoil,
// fElectricidad, fNotas, fMaquinaKwh, sessionMut, delSesionMut, resultados,
// historicoChart, ultimaSesion, penultimaSesion, kpisUltima, kpisPenultima.
```

Keep machine state and `consumo_maquinas` queries for the Maquinas tab.

- [ ] **Step 6: Run build and lint**

Run:

```bash
npm run build
npm run lint
```

Expected: both PASS.

- [ ] **Step 7: Commit the reporting UI**

Run:

```bash
git add src/pages/ConsumoCostes.tsx
git commit -m "feat: show physical consumption ratios"
```

---

## Task 6: Export The New Model

**Files:**
- Modify: `src/lib/exportConsumo.ts`
- Modify: `src/pages/ConsumoCostes.tsx`

- [ ] **Step 1: Extend export input**

Modify `src/lib/exportConsumo.ts` imports:

```ts
import { ConsumoPeriodoRow } from "./consumosFisicos";
import { SesionConsumoRow, ConsumoMaquinaRow, MaquinaRow, ConsumoFisicoRow, ConsumoBaseKgRow } from "./types";
```

Replace `ExportData` with:

```ts
export interface ExportData {
  sesiones: SesionConsumoRow[];
  maquinas: MaquinaRow[];
  consumosMaquinas: ConsumoMaquinaRow[];
  consumosFisicos?: ConsumoFisicoRow[];
  basesKg?: ConsumoBaseKgRow[];
  periodos?: ConsumoPeriodoRow[];
}
```

- [ ] **Step 2: Add period sheets to Excel export**

After the current `Resumen recursos` sheet in `exportConsumoToExcel`, add:

```ts
  if (data.periodos?.length) {
    appendRowsSheet(wb, "Consumos por periodo", data.periodos.map((row) => ({
      Periodo: row.periodo,
      "Fecha inicio": row.fechaInicio,
      "Fecha fin": row.fechaFin,
      Confianza: row.confianza,
      "Base usada": row.baseUsada,
      "Kg partes": row.kgPartes,
      "Kg ventas": row.kgVentas,
      "Kg manual": row.kgManual,
      "Kg base": row.kgBase,
      "Agua L": row.aguaL,
      "Agua L/kg": row.aguaLKg ?? "",
      "Electricidad kWh": row.electricidadKwh,
      "kWh/kg": row.electricidadKwhKg ?? "",
      "Gasoil L": row.gasoilL,
      "Gasoil mL/kg": row.gasoilMlKg ?? "",
      "Gasoil L/t": row.gasoilLT ?? "",
      "Quimicos L": row.quimicosL,
      "Quimicos mL/kg": row.quimicosMlKg ?? "",
      Observaciones: row.issues.join(" | "),
    })), [14, 14, 14, 14, 14, 14, 14, 14, 14, 12, 12, 16, 12, 12, 14, 12, 12, 14, 42], { freezeHeader: true });

    appendRowsSheet(wb, "Validacion consumos", data.periodos
      .filter((row) => row.issues.length > 0)
      .map((row) => ({
        Periodo: row.periodo,
        Confianza: row.confianza,
        Observaciones: row.issues.join(" | "),
      })), [14, 14, 60], { freezeHeader: true });
  }
```

- [ ] **Step 3: Pass period data from the page**

Update the export buttons in `src/pages/ConsumoCostes.tsx`:

```tsx
          <Button
            variant="outline"
            size="sm"
            disabled={consumosFisicos.monthlyRows.length === 0}
            onClick={() => exportConsumoToExcel({
              sesiones,
              maquinas,
              consumosMaquinas,
              consumosFisicos: consumosFisicos.consumos,
              basesKg: consumosFisicos.basesKg,
              periodos: consumosFisicos.monthlyRows,
            })}
            className="glass glass-hover"
          >
            <FileSpreadsheet className="h-4 w-4 mr-1.5" /> Excel
          </Button>
```

Apply the same data shape to `exportConsumoToPDF`.

- [ ] **Step 4: Run build**

Run:

```bash
npm run build
```

Expected: PASS.

- [ ] **Step 5: Commit export changes**

Run:

```bash
git add src/lib/exportConsumo.ts src/pages/ConsumoCostes.tsx
git commit -m "feat: export physical consumption periods"
```

---

## Task 7: Verification And Browser QA

**Files:**
- No new files expected.

- [ ] **Step 1: Run the full test suite**

Run:

```bash
npm run test
```

Expected: PASS.

- [ ] **Step 2: Run production build**

Run:

```bash
npm run build
```

Expected: PASS.

- [ ] **Step 3: Start the dev server**

Run:

```bash
npm run dev
```

Expected: Vite serves the app on a local URL such as `http://localhost:5173/`.

- [ ] **Step 4: Browser check**

Open `/costes/consumos` and verify:

- The page loads without console errors.
- The tab row shows Resumen, Registrar, Historico, Validacion, Maquinas.
- Registrar accepts a gasoil entry for 01/04/2026 to 30/04/2026 with liters and source `albaran`.
- Registrar accepts a ventas kg base entry for 01/09/2025 to 31/03/2026.
- Historico shows `Estimado` before partes and `Real` or `Mixto` when partes exist.
- Validacion shows incomplete months when consumption or kg base is missing.
- Export buttons still produce Excel/PDF files.

- [ ] **Step 5: Final commit if verification fixes were needed**

If verification required fixes, commit only the verification fixes:

```bash
git add src/pages/ConsumoCostes.tsx src/lib/consumosFisicos.ts src/lib/exportConsumo.ts
git commit -m "fix: verify physical consumption workflow"
```

---

## Self-Review

- Spec coverage: The plan covers physical resources, kg partes, kg ventas proxy, confidence labels, summary, registration, history, validation, export, and tests.
- Scope: Economic euro/kg calculation, OCR import, and accounting reconciliation remain out of scope.
- Type consistency: `consumos_fisicos`, `consumos_bases_kg`, `ConsumoFisicoRow`, `ConsumoBaseKgRow`, `ConsumoPeriodoRow`, and confidence labels are named consistently across tasks.
- Risk: The current repo does not contain a live ventas integration, so Task 2 adds `consumos_bases_kg` as the first integration point for kg sold by period.
