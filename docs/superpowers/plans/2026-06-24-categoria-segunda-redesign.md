# Categoria Segunda - Filtros Globales Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redisenar la pagina VentasCategoriaSegunda con filtros globales visibles siempre (campana, mes, cliente, producto, articulo) que afecten a Dashboard, Clientes, Productos, Articulos y Base diaria.

**Architecture:** Se anade una query `allLinesQuery` que carga todas las lineas. Cuando hay filtros activos, se filtran y agregan en cliente via `aggregateVentasCategoria`. Sin filtros, se usan las vistas pre-agregadas existentes. Los filtros se extraen a un componente `VentasCategoriaFilterBar` colocado entre el header y las pestanas.

**Tech Stack:** React + TypeScript + TanStack Query + Supabase + shadcn/ui + Vitest

**Files to modify:**
- `src/lib/ventasCategoria.ts` — anadir `applyVentasCategoriaFilters`
- `src/lib/ventasCategoria.test.ts` — tests para el filtro
- `src/hooks/useVentasCategoria.ts` — anadir `allLinesQuery`
- `src/pages/VentasCategoriaSegunda.tsx` — refactor principal

**Files to create:**
- `src/components/VentasCategoriaFilterBar.tsx` — componente de barra de filtros

---

### Task 1: Add `applyVentasCategoriaFilters` helper + tests

**Files:**
- Modify: `src/lib/ventasCategoria.ts` (anadir funcion)
- Modify: `src/lib/ventasCategoria.test.ts` (anadir test)

- [ ] **Step 1: Write the failing test**

Anadir al final de `src/lib/ventasCategoria.test.ts`:

```typescript
import {
  ...
  applyVentasCategoriaFilters,
} from "./ventasCategoria";

...

describe("applyVentasCategoriaFilters", () => {
  const lines = [
    normalizeVentasCategoriaLinea({ ...baseLine, campana: "2526", mes: "2025-10", cliente_codigo: "C001", metodo_producto: "LN211", articulo: "NARANJA VALENCIA" }),
    normalizeVentasCategoriaLinea({ ...baseLine, campana: "2526", mes: "2025-11", cliente_codigo: "C002", metodo_producto: "LN210", articulo: "LIMON VERNA" }),
    normalizeVentasCategoriaLinea({ ...baseLine, campana: "2425", mes: "2025-01", cliente_codigo: "C001", metodo_producto: "LN211", articulo: "NARANJA NAVEL" }),
  ];

  it("filtra por campana exacta", () => {
    const result = applyVentasCategoriaFilters(lines, { campana: "2526" });
    expect(result).toHaveLength(2);
    expect(result.every((l) => l.campana === "2526")).toBe(true);
  });

  it("filtra por mes exacto", () => {
    const result = applyVentasCategoriaFilters(lines, { mes: "2025-10" });
    expect(result).toHaveLength(1);
    expect(result[0].mes).toBe("2025-10");
  });

  it("filtra por cliente (codigo)", () => {
    const result = applyVentasCategoriaFilters(lines, { cliente: "C001" });
    expect(result).toHaveLength(2);
    expect(result.every((l) => l.cliente_codigo === "C001")).toBe(true);
  });

  it("filtra por metodo/producto", () => {
    const result = applyVentasCategoriaFilters(lines, { metodo: "LN210" });
    expect(result).toHaveLength(1);
    expect(result[0].metodo_producto).toBe("LN210");
  });

  it("filtra por texto de articulo (busqueda parcial)", () => {
    const result = applyVentasCategoriaFilters(lines, { articulo: "NARANJA" });
    expect(result).toHaveLength(2);
    expect(result.every((l) => l.articulo.includes("NARANJA"))).toBe(true);
  });

  it("combina multiples filtros (AND)", () => {
    const result = applyVentasCategoriaFilters(lines, { campana: "2526", cliente: "C001" });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ campana: "2526", cliente_codigo: "C001" });
  });

  it("devuelve todas las lineas si no hay filtros", () => {
    const result = applyVentasCategoriaFilters(lines, {});
    expect(result).toHaveLength(3);
  });

  it("devuelve array vacio si ningun filtro coincide", () => {
    const result = applyVentasCategoriaFilters(lines, { campana: "NO_EXISTE" });
    expect(result).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- ventasCategoria`
Expected: FAIL with "applyVentasCategoriaFilters is not a function" (or import error)

- [ ] **Step 3: Write minimal implementation**

Anadir en `src/lib/ventasCategoria.ts` antes del `export` final:

```typescript
export function applyVentasCategoriaFilters(
  lines: VentasCategoriaLinea[],
  filters: VentasCategoriaDetalleFilters
): VentasCategoriaLinea[] {
  return lines.filter((line) => {
    if (filters.campana && line.campana !== filters.campana) return false;
    if (filters.mes && line.mes !== filters.mes) return false;
    if (filters.cliente && line.cliente_codigo !== filters.cliente) return false;
    if (filters.metodo && line.metodo_producto !== filters.metodo) return false;
    if (filters.articulo) {
      const search = filters.articulo.toLowerCase();
      if (!line.articulo.toLowerCase().includes(search)) return false;
    }
    return true;
  });
}
```

Tambien importar el tipo `VentasCategoriaDetalleFilters` al inicio (existe ya en el hook, mover la definicion o importarla). Lo movemos a un type exportable desde `ventasCategoria.ts`:

Anadir al inicio de `src/lib/ventasCategoria.ts`:

```typescript
export interface VentasCategoriaDetalleFilters {
  campana?: string;
  mes?: string;
  cliente?: string;
  metodo?: string;
  articulo?: string;
}
```

Y en `src/hooks/useVentasCategoria.ts`, reemplazar la definicion local por el import:

```typescript
import { ..., applyVentasCategoriaFilters, VentasCategoriaDetalleFilters } from "@/lib/ventasCategoria";
```

Y eliminar la interfaz local `VentasCategoriaDetalleFilters` del hook (lineas 18-24).

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- ventasCategoria`
Expected: PASS (all tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/ventasCategoria.ts src/lib/ventasCategoria.test.ts src/hooks/useVentasCategoria.ts
git commit -m "feat: add applyVentasCategoriaFilters helper with tests"
```

---

### Task 2: Add `allLinesQuery` to useVentasCategoria hook

**Files:**
- Modify: `src/hooks/useVentasCategoria.ts`

- [ ] **Step 1: Verify test suite still passes (baseline)**

Run: `npm test -- ventasCategoria`
Expected: PASS

- [ ] **Step 2: Add allLinesQuery to the hook**

En `src/hooks/useVentasCategoria.ts`, dentro de `useVentasCategoria()`, anadir despues de `filterOptionsQuery`:

```typescript
const allLinesQuery = useQuery({
  queryKey: [...baseKey, categoriaId, "all-lines"],
  queryFn: async () => {
    const { data, error } = await supabase
      .from("ventas_categoria_lineas")
      .select("*")
      .eq("categoria_id", categoriaId)
      .order("fecha", { ascending: false })
      .limit(20000);
    if (error) throw toError(error);
    return (data ?? []) as VentasCategoriaLineaRow[];
  },
  enabled: Boolean(user && categoriaId && hasAccess),
  staleTime: 5 * 60 * 1000,
});
```

Tambien anadir al return del hook:

```typescript
return {
  ...
  allLinesQuery,
};
```

- [ ] **Step 3: Run tests to verify nothing broke**

Run: `npm test`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useVentasCategoria.ts
git commit -m "feat: add allLinesQuery for client-side filtering"
```

---

### Task 3: Create VentasCategoriaFilterBar component

**Files:**
- Create: `src/components/VentasCategoriaFilterBar.tsx`

- [ ] **Step 1: Write the component**

Crear `src/components/VentasCategoriaFilterBar.tsx`:

```tsx
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Search, X } from "lucide-react";
import type { VentasCategoriaFilterOptions } from "@/lib/ventasCategoria";

const ALL_FILTER_VALUE = "__all__";

interface FilterValues {
  campana: string;
  mes: string;
  cliente: string;
  metodo: string;
  articulo: string;
}

interface VentasCategoriaFilterBarProps {
  filters: FilterValues;
  filterOptions: VentasCategoriaFilterOptions;
  onChange: (key: keyof FilterValues, value: string) => void;
  onClear: () => void;
  activeCount: number;
}

export function VentasCategoriaFilterBar({ filters, filterOptions, onChange, onClear, activeCount }: VentasCategoriaFilterBarProps) {
  return (
    <div className="rounded-lg border border-[var(--glass-border)] bg-[var(--glass-bg)] p-4 shadow-[var(--glass-shadow)] backdrop-blur-xl">
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-sm font-semibold">Filtros globales</h2>
          <p className="text-xs text-muted-foreground">
            {activeCount > 0
              ? `${activeCount} filtro${activeCount === 1 ? "" : "s"} activo${activeCount === 1 ? "" : "s"}`
              : "Sin filtros — mostrando todos los datos"}
          </p>
        </div>
        <Button variant="outline" size="sm" className="gap-1.5" disabled={activeCount === 0} onClick={onClear}>
          <X className="h-3.5 w-3.5" />
          Limpiar
        </Button>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <div className="space-y-1.5">
          <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Campana</Label>
          <Select value={filters.campana || ALL_FILTER_VALUE} onValueChange={(v) => onChange("campana", v === ALL_FILTER_VALUE ? "" : v)}>
            <SelectTrigger><SelectValue placeholder="Todas" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_FILTER_VALUE}>Todas</SelectItem>
              {filterOptions.campanas.map((c) => (
                <SelectItem key={c} value={c}>{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Mes</Label>
          <Select value={filters.mes || ALL_FILTER_VALUE} onValueChange={(v) => onChange("mes", v === ALL_FILTER_VALUE ? "" : v)}>
            <SelectTrigger><SelectValue placeholder="Todos" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_FILTER_VALUE}>Todos</SelectItem>
              {filterOptions.meses.map((m) => (
                <SelectItem key={m} value={m}>{m}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Cliente</Label>
          <Select value={filters.cliente || ALL_FILTER_VALUE} onValueChange={(v) => onChange("cliente", v === ALL_FILTER_VALUE ? "" : v)}>
            <SelectTrigger><SelectValue placeholder="Todos" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_FILTER_VALUE}>Todos</SelectItem>
              {filterOptions.clientes.map((c) => (
                <SelectItem key={c.codigo} value={c.codigo}>{c.nombre} - {c.codigo}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Producto</Label>
          <Select value={filters.metodo || ALL_FILTER_VALUE} onValueChange={(v) => onChange("metodo", v === ALL_FILTER_VALUE ? "" : v)}>
            <SelectTrigger><SelectValue placeholder="Todos" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_FILTER_VALUE}>Todos</SelectItem>
              {filterOptions.metodos.map((m) => (
                <SelectItem key={m} value={m}>{m}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Articulo</Label>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-8"
              value={filters.articulo}
              onChange={(e) => onChange("articulo", e.target.value)}
              placeholder="Buscar texto..."
            />
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run build`
Expected: Build exits with code 0 (component is not yet imported, but should parse fine)

- [ ] **Step 3: Commit**

```bash
git add src/components/VentasCategoriaFilterBar.tsx
git commit -m "feat: create VentasCategoriaFilterBar component"
```

---

### Task 4: Refactor VentasCategoriaSegunda page for global filters

**Files:**
- Modify: `src/pages/VentasCategoriaSegunda.tsx`

- [ ] **Step 1: Verify baseline builds**

Run: `npm run build`
Expected: BUILD OK

- [ ] **Step 2: Replace local filter UI with GlobalFilterBar in the page**

Changes to `src/pages/VentasCategoriaSegunda.tsx`:

1. **Anadir imports:**
```typescript
import { VentasCategoriaFilterBar } from "@/components/VentasCategoriaFilterBar";
import { applyVentasCategoriaFilters, aggregateVentasCategoria, type VentasCategoriaDetalleFilters } from "@/lib/ventasCategoria";
```

2. **Renombrar el estado de filtros** (cambiar clave `metodo` por coherencia — ya se usa asi):
   - El estado actual ya usa `metodo` como clave. Dejarlo igual, solo cambiamos la label en UI.

3. **Obtener allLines y computar datos filtrados** despues de `const filterOptions = ...`:

```typescript
const allLines = ventas.allLinesQuery.data ?? EMPTY_ROWS;
const hasActiveFilters = activeFilters > 0;

const filteredLines = useMemo(
  () => applyVentasCategoriaFilters(allLines, filters),
  [allLines, filters]
);

const filteredAggregation = useMemo(
  () => aggregateVentasCategoria(filteredLines),
  [filteredLines]
);

// Use filtered aggregation when filters active, otherwise use view queries
const displayResumen = hasActiveFilters ? filteredAggregation.resumen : resumen;
const displayRanking = hasActiveFilters ? filteredAggregation.clientes : rankingClientes;
const displayMensualProducto = hasActiveFilters ? filteredAggregation.mensualProducto : mensualProducto;
const displayMensualCliente = hasActiveFilters ? filteredAggregation.mensualCliente : mensualCliente;
const displayArticulos = hasActiveFilters ? filteredAggregation.articulos : articulos;
```

4. **Insertar VentasCategoriaFilterBar** entre el header y las pestanas, justo despues del `</header>` y antes de `<Tabs ...>`:

```tsx
<section className="space-y-1">
  <VentasCategoriaFilterBar
    filters={filters}
    filterOptions={filterOptions}
    onChange={setFilter}
    onClear={clearFilters}
    activeCount={activeFilters}
  />
</section>
```

5. **Reemplazar referencias de datos** en cada pestana:

   **Dashboard:** Reemplazar `resumen` por `displayResumen`, `rankingClientes` por `displayRanking`, `mensualProducto` por `displayMensualProducto`, `monthlyTotals` debe recalcularse desde `displayMensualProducto`:

```typescript
const monthlyTotals = useMemo(() => {
  const map = new Map<string, { mes: string; kilos: number; base: number; pm: number }>();
  (hasActiveFilters ? displayMensualProducto : mensualProducto).forEach((row) => {
    ...
  });
  return Array.from(map.values()).sort((a, b) => a.mes.localeCompare(b.mes));
}, [hasActiveFilters, displayMensualProducto, mensualProducto]);
```

   **Clientes:** Reemplazar `rankingClientes` por `displayRanking` en los rankings.

   **Productos:** Reemplazar `mensualProducto` por `displayMensualProducto` en `productMonthlyChart`:

```typescript
const productMonthlyChart = useMemo(() => pivotMonthlyProducts(
  hasActiveFilters ? displayMensualProducto : mensualProducto,
  catalogo.map((row) => row.metodo)
), [catalogo, hasActiveFilters, displayMensualProducto, mensualProducto]);
```

   **Articulos:** Reemplazar `articulos` por `displayArticulos`.

6. **Remover el bloque de filtros** de la pestana Base diaria (el `Card` con titulo "Filtros de base diaria" y los `SelectFilter`/`FilterInput` dentro del `CardContent`). La pestana Base diaria ahora debe usar los filtros globales.

7. **Actualizar detalle de Base diaria** para usar `filteredLines` con paginacion en cliente en vez de la query servidor:

```typescript
// Reemplazar el uso de detalle query
const pagedLines = useMemo(() => {
  const start = page * PAGE_SIZE;
  return filteredLines.slice(start, start + PAGE_SIZE);
}, [filteredLines, page]);

const totalFiltered = filteredLines.length;
```

   Y en el JSX de la pestana base, reemplazar `detalle.data?.rows` por `pagedLines` y `detalle.data?.count` por `totalFiltered`.

   Nota: deshabilitar la query `detalle` cuando estamos en base (o usar filteredLines directamente). Pondremos `enabled: false` para `detalle` query ya que ahora usamos datos en cliente.

- [ ] **Step 3: Verificar el tipado**

Asegurarse de que `filteredAggregation.clientes` tiene el mismo tipo que `rankingClientes`. El tipo de retorno de `aggregateVentasCategoria().clientes` es `VentasCategoriaClienteRow[]`, y el tipo de `rankingClientesQuery.data` también deberia ser compatible.

Ejecutar:

Run: `npm run build` o `npx tsc --noEmit`
Expected: Sin errores de tipo

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/pages/VentasCategoriaSegunda.tsx src/components/VentasCategoriaFilterBar.tsx
git commit -m "feat: implement global filters across all tabs in categoria-segunda"
```

---

### Task 5: Lint and verify build

**Files:**
All modified files.

- [ ] **Step 1: Run linter**

Run: `npm run lint`
Expected: No errors. If there are errors, fix them.

- [ ] **Step 2: Run full test suite**

Run: `npm test`
Expected: All existing tests pass + new filter tests pass.

- [ ] **Step 3: Run production build**

Run: `npm run build`
Expected: BUILD OK, chunk size similar to before.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: lint and verify build for categoria-segunda redesign"
```

---

## Spec Coverage Check

| Spec requirement | Task covering it |
|---|---|
| Filtros globales visibles siempre | Task 3 (component), Task 4 (placement) |
| Filtros: campana, mes, cliente, producto, articulo | Task 1 (helper), Task 3 (UI) |
| Dashboard filtrado | Task 4 (displayResumen, displayRanking, displayMensualProducto) |
| Clientes filtrado | Task 4 (displayRanking) |
| Productos filtrado (grafico) | Task 4 (displayMensualProducto) |
| Articulos filtrado | Task 4 (displayArticulos) |
| Base diaria usa filtros globales | Task 4 (filteredLines + paginacion cliente) |
| Importar sin cambios | Dejado intacto en Task 4 |
| Agregacion cliente-side | Task 1 (filter helper), Task 4 (useMemo aggregation) |
| Sin cambios en BD | No se tocan migraciones |
| Label "Producto" en vez de "Metodo" | Task 3 (component UI) |
| pm_real con ajustes | Task 4 (displayRanking usa datos con pm_real de vistas, o calculado en filteredAggregation) |
