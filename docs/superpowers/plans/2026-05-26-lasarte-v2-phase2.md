# Lasarte SAT v2 — Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Add real data search to Cmd+K, contextual links between entities, DSJ discrepancy notifications, and an improved daily analysis view.

**Architecture:** Extend CommandPalette with async Supabase search; add Badge components for notifications; add Link wrappers and navigation helpers for contextual cross-references; enhance AnalisisDiario page with trend charts and better layout.

**Tech Stack:** React 18, Supabase, TanStack Query, shadcn/ui (Badge, Command Dialog), Recharts, React Router 6.

---

### Task 1: Búsqueda global con datos reales

**Files:**
- Modify: `src/components/CommandPalette.tsx`
- Create: `src/hooks/useGlobalSearch.ts`

- [ ] **Step 1: Create useGlobalSearch hook**

Create `src/hooks/useGlobalSearch.ts`:

```tsx
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useDebounce } from "@/hooks/useDebounce";

export type SearchResult = {
  id: string;
  type: "parte" | "productor" | "pagina";
  label: string;
  subtitle: string;
  to: string;
};

export function useGlobalSearch(query: string) {
  const debounced = useDebounce(query, 300);

  return useQuery({
    queryKey: ["global-search", debounced],
    queryFn: async (): Promise<SearchResult[]> => {
      if (!debounced || debounced.length < 2) return [];

      const results: SearchResult[] = [];

      if (/^\d/.test(debounced) || debounced.length > 2) {
        const { data: partes } = await supabase
          .from("partes_diarios")
          .select("id, date")
          .textSearch("date", debounced, { type: "websearch" })
          .limit(5);

        if (partes) {
          for (const p of partes) {
            results.push({
              id: p.id,
              type: "parte",
              label: `Parte ${p.date}`,
              subtitle: `Parte diario del ${p.date}`,
              to: `/partes/${p.id}`,
            });
          }
        }
      }

      const { data: productores } = await supabase
        .from("productores")
        .select("id, nombre, apellidos")
        .or(`nombre.ilike.%${debounced}%,apellidos.ilike.%${debounced}%`)
        .limit(5);

      if (productores) {
        for (const p of productores) {
          results.push({
            id: p.id,
            type: "productor",
            label: `${p.nombre} ${p.apellidos}`,
            subtitle: "Productor",
            to: `/productores/${p.id}`,
          });
        }
      }

      return results;
    },
    enabled: debounced.length >= 2,
    staleTime: 30_000,
  });
}
```

- [ ] **Step 2: Create useDebounce hook**

Create `src/hooks/useDebounce.ts`:

```tsx
import { useState, useEffect } from "react";

export function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debounced;
}
```

- [ ] **Step 3: Update CommandPalette with search**

Modify `src/components/CommandPalette.tsx`:

Replace the component to accept a search state and query Supabase results. The key changes:
- Add a `searchQuery` state
- Use `useGlobalSearch` hook
- Show loading state while searching
- Display search results alongside page navigation
- Add keyboard navigation between results and pages

Replace the CommandPalette component:

```tsx
import { useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import {
  LayoutDashboard,
  FileText,
  Calculator,
  BarChart3,
  Sprout,
  Droplet,
  Users,
  CalendarDays,
  Plus,
  ArrowRight,
  Loader2,
  Search,
} from "lucide-react";
import { useGlobalSearch } from "@/hooks/useGlobalSearch";

const PAGES = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, keywords: "panel inicio dashboard" },
  { to: "/partes", label: "Partes diarios", icon: FileText, keywords: "partes produccion diario" },
  { to: "/dsj", label: "Calculadora DJPMN", icon: Calculator, keywords: "dsj calculadora descuadre calculo" },
  { to: "/analisis/diario", label: "Análisis diario", icon: BarChart3, keywords: "analisis diario lotes calibres" },
  { to: "/productores", label: "Productores", icon: Sprout, keywords: "productores proveedores origen" },
  { to: "/costes/consumos", label: "Consumos", icon: Droplet, keywords: "consumos costes agua energia gasoil" },
  { to: "/costes/asistencia", label: "Asistencia", icon: Users, keywords: "asistencia trabajadores turnos" },
  { to: "/calendario", label: "Calendario", icon: CalendarDays, keywords: "calendario planificacion fechas" },
];

const ACTIONS = [
  { id: "nuevo-parte", label: "Crear nuevo parte", icon: Plus, to: "/partes" },
  { id: "ir-hoy", label: "Ir al día de hoy", icon: ArrowRight, to: "/calendario" },
];

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState("");
  const { data: searchResults, isLoading } = useGlobalSearch(searchQuery);

  const handleSelect = useCallback(
    (to: string) => {
      onOpenChange(false);
      setSearchQuery("");
      navigate(to);
    },
    [navigate, onOpenChange]
  );

  const hasSearchResults = searchResults && searchResults.length > 0;
  const showPages = !searchQuery || searchQuery.length < 2;

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput
        placeholder="Buscar partes, productores, páginas..."
        value={searchQuery}
        onValueChange={setSearchQuery}
      />
      <CommandList>
        {isLoading ? (
          <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Buscando...
          </div>
        ) : searchQuery.length >= 2 && !hasSearchResults ? (
          <CommandEmpty>Sin resultados para "{searchQuery}".</CommandEmpty>
        ) : null}

        {hasSearchResults && (
          <>
            <CommandGroup heading="Resultados">
              {searchResults.map((result) => {
                const icon = result.type === "parte" ? FileText : Sprout;
                return (
                  <CommandItem
                    key={`${result.type}-${result.id}`}
                    onSelect={() => handleSelect(result.to)}
                  >
                    {icon({ className: "mr-2 h-4 w-4" })}
                    <span>{result.label}</span>
                    <span className="ml-auto text-xs text-muted-foreground">
                      {result.subtitle}
                    </span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
            <CommandSeparator />
          </>
        )}

        {showPages && (
          <>
            <CommandGroup heading="Acciones rápidas">
              {ACTIONS.map((action) => (
                <CommandItem
                  key={action.id}
                  onSelect={() => handleSelect(action.to)}
                >
                  <action.icon className="mr-2 h-4 w-4" />
                  <span>{action.label}</span>
                </CommandItem>
              ))}
            </CommandGroup>
            <CommandSeparator />
            <CommandGroup heading="Navegación">
              {PAGES.map((page) => (
                <CommandItem
                  key={page.to}
                  onSelect={() => handleSelect(page.to)}
                  keywords={page.keywords.split(" ")}
                >
                  <page.icon className="mr-2 h-4 w-4" />
                  <span>{page.label}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}
      </CommandList>
    </CommandDialog>
  );
}

export function useCommandPalette() {
  const [open, setOpen] = useState(false);

  useState(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  });

  return { open, setOpen };
}
```

- [ ] **Step 4: Verify build**

Run: `npm run build`
Expected: Clean build

---

### Task 2: Enlaces contextuales entre entidades

**Files:**
- Modify: `src/pages/PartDetail.tsx`
- Modify: `src/pages/Productores.tsx`
- Modify: `src/pages/AnalisisDiario.tsx`
- Modify: `src/components/TopBar.tsx`

- [ ] **Step 1: Add contextual link to productor from PartDetail**

Read `src/pages/PartDetail.tsx` and find where the productor/transportista info is displayed. Add a link wrapping the productor name to `/productores` and a link wrapping the date to `/calendario`.

The key pattern to add (find the appropriate location in the file):
```tsx
<Link
  to={`/productores`}
  className="font-medium text-primary hover:underline transition-all"
>
  {productorName}
</Link>
```

For date links:
```tsx
<Link
  to={`/calendario`}
  className="font-medium text-primary hover:underline transition-all"
>
  {formatDate(parte.date)}
</Link>
```

- [ ] **Step 2: Add contextual link from Productores to their partes**

Read `src/pages/Productores.tsx`. Find the table or card listing productores. Add a link to `/partes` with a query param or just navigate to the partes page and let the user filter.

At minimum, add a "Ver partes" button/link per productor row:
```tsx
<Link
  to={`/partes`}
  className="text-xs font-medium text-primary hover:underline"
>
  Ver partes →
</Link>
```

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: Clean build

---

### Task 3: Notificaciones de descuadres DSJ

**Files:**
- Modify: `src/components/AppLayout.tsx`
- Modify: `src/components/TopBar.tsx`

- [ ] **Step 1: Add DSJ alert badge to sidebar**

In `AppLayout.tsx`, add a `useQuery` that counts partes with DSJ > 5% in the last 7 days that are in "Completado" state (meaning they were finalized but have issues).

Add before the return:
```tsx
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
```

Add the query:
```tsx
const { data: dsjAlerts } = useQuery({
  queryKey: ["dsj-alerts-count"],
  queryFn: async () => {
    const since = new Date();
    since.setDate(since.getDate() - 7);
    const { count } = await supabase
      .from("partes_diarios")
      .select("id", { count: "exact", head: true })
      .gte("date", since.toISOString().slice(0, 10))
      .neq("estado", "Borrador");
    return count ?? 0;
  },
  refetchInterval: 60_000,
});
```

Add an alert section in the sidebar just before the footer. Find the `SidebarContent` closing tag and add before it:
```tsx
{/* DSJ Alert */}
{dsjAlerts && dsjAlerts > 0 && (
  <SidebarGroup>
    <Link
      to="/dsj"
      className="mx-3 flex items-center gap-2 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs font-medium text-red-400 hover:bg-red-500/20 transition-colors"
    >
      <AlertTriangle className="h-3.5 w-3.5" />
      <span>{dsjAlerts} partes con descuadre</span>
    </Link>
  </SidebarGroup>
)}
```

- [ ] **Step 2: Add DSJ alert badge to TopBar**

In `TopBar.tsx`, add the same query and show a badge when there are alerts:

```tsx
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

// Inside component, add query:
const { data: dsjAlerts } = useQuery({
  queryKey: ["dsj-alerts-count"],
  queryFn: async () => {
    const since = new Date();
    since.setDate(since.getDate() - 7);
    const { count } = await supabase
      .from("partes_diarios")
      .select("id", { count: "exact", head: true })
      .gte("date", since.toISOString().slice(0, 10))
      .neq("estado", "Borrador");
    return count ?? 0;
  },
  refetchInterval: 60_000,
});
```

And replace the static "Producción" badge with a dynamic one:
```tsx
{dsjAlerts && dsjAlerts > 0 ? (
  <Link to="/dsj">
    <Badge variant="destructive" className="rounded-md px-2.5 py-1 font-medium">
      <AlertTriangle className="h-3 w-3 mr-1" />
      {dsjAlerts} descuadres
    </Badge>
  </Link>
) : (
  <Badge variant="outline" className="rounded-md border-primary/20 bg-card/80 px-2.5 py-1 font-medium text-primary md:inline-flex">
    Producción
  </Badge>
)}
```

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: Clean build

---

### Task 4: Análisis diario mejorado

**Files:**
- Modify: `src/pages/AnalisisDiario.tsx`

- [ ] **Step 1: Add trend chart and improve layout**

Read the current `src/pages/AnalisisDiario.tsx` and enhance it with:
1. A production trend chart at the top (area chart showing last 7/14 days)
2. Better section headers with glass styling
3. Summary KPIs (total kg, lotes, average calibre)
4. A date range selector

The exact changes depend on the current file structure. Read the file first, then add:

- A "Resumen" section with 3 KPICards (Total kg, Total lotes, Velocidad media)
- An "Evolución" section with an area chart showing production over time
- Keep existing analysis data but reorganize into glass cards

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: Clean build

---

### Verification

- [ ] Run: `npm run build`
Expected: Clean build
- [ ] Dev server running on localhost:8080
- [ ] Manual check: Cmd+K searches real data
- [ ] Manual check: PartDetail has contextual links
- [ ] Manual check: Sidebar shows DSJ alert badge
- [ ] Manual check: TopBar shows DSJ alert badge
- [ ] Manual check: AnalisisDiario has trend chart
