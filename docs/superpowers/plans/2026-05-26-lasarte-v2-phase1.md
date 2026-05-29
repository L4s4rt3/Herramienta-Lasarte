# Lasarte SAT v2 — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the Lasarte SAT app from functional/amateurish to polished/professional with command palette, redesigned dashboard, regrouped navigation, and global animations.

**Architecture:** Add a global command palette component rendered in AppLayout, restructure sidebar nav groups, redesign Dashboard as a strategic landing page with KPIs/alerts/trends, add CSS animations and transitions, and update TopBar route metadata.

**Tech Stack:** React 18, React Router 6, shadcn/ui (Command Dialog, Sidebar), TanStack Query, Recharts, Tailwind CSS, Lucide icons.

---

### Task 1: Command Palette Component

**Files:**
- Create: `src/components/CommandPalette.tsx`
- Modify: `src/components/AppLayout.tsx`

- [ ] **Step 1: Create CommandPalette.tsx**

```tsx
import { useCallback, useEffect, useState } from "react";
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
  Search,
  ArrowRight,
} from "lucide-react";

const PAGES = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, keywords: "panel inicio" },
  { to: "/partes", label: "Partes diarios", icon: FileText, keywords: "produccion diario" },
  { to: "/dsj", label: "Calculadora DJPMN", icon: Calculator, keywords: "dsj descuadre calculo" },
  { to: "/analisis/diario", label: "Análisis diario", icon: BarChart3, keywords: "analisis lotes calibres" },
  { to: "/productores", label: "Productores", icon: Sprout, keywords: "proveedores origen" },
  { to: "/costes/consumos", label: "Consumos", icon: Droplet, keywords: "agua energia gasoil" },
  { to: "/costes/asistencia", label: "Asistencia", icon: Users, keywords: "trabajadores turnos" },
  { to: "/calendario", label: "Calendario", icon: CalendarDays, keywords: "planificacion fechas" },
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

  const handleSelect = useCallback(
    (to: string) => {
      onOpenChange(false);
      navigate(to);
    },
    [navigate, onOpenChange]
  );

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Buscar páginas, partes, acciones..." />
      <CommandList>
        <CommandEmpty>Sin resultados.</CommandEmpty>
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
      </CommandList>
    </CommandDialog>
  );
}

export function useCommandPalette() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, []);

  return { open, setOpen };
}
```

- [ ] **Step 2: Integrate CommandPalette in AppLayout**

Replace the end of `AppLayout.tsx` — import the command palette and render it inside the layout.

Add imports:
```tsx
import { CommandPalette, useCommandPalette } from "@/components/CommandPalette";
```

Add inside the component, before the closing `</SidebarProvider>`:
```tsx
const cmd = useCommandPalette();

// ... (inside the return, near the end, before </SidebarProvider>)
<CommandPalette open={cmd.open} onOpenChange={cmd.setOpen} />
```

- [ ] **Step 3: Verify no compile errors**

Run: `npm run build` (or `npx tsc --noEmit`)
Expected: No errors

---

### Task 2: Regroup Sidebar Navigation

**Files:**
- Modify: `src/components/AppLayout.tsx`
- Modify: `src/components/TopBar.tsx`

- [ ] **Step 1: Update navGroups in AppLayout.tsx**

Replace the `navGroups` array with the new v2 structure:

```tsx
const navGroups: Array<{ label: string; items: NavItem[] }> = [
  {
    label: "Dashboard",
    items: [
      { to: "/", label: "Panel de producción", icon: LayoutDashboard, match: (path) => path === "/" },
    ],
  },
  {
    label: "Operaciones diarias",
    items: [
      { to: "/partes", label: "Partes", icon: FileText, match: (path) => path.startsWith("/partes") },
      { to: "/dsj", label: "Calculadora DJPMN", icon: Calculator },
    ],
  },
  {
    label: "Producción",
    items: [
      { to: "/analisis/diario", label: "Análisis diario", icon: BarChart3 },
      { to: "/productores", label: "Productores", icon: Sprout },
      { to: "/calendario", label: "Calendario", icon: CalendarDays },
    ],
  },
  {
    label: "Operaciones",
    items: [
      { to: "/costes/consumos", label: "Consumos", icon: Droplet },
      { to: "/costes/asistencia", label: "Asistencia", icon: Users },
    ],
  },
];
```

- [ ] **Step 2: Update TopBar route metadata**

In `TopBar.tsx`, update `ROUTE_META` to reflect the new grouping:

```tsx
const ROUTE_META: Record<string, { label: string; subtitle: string; parent?: string; parentLabel?: string }> = {
  "/": {
    label: "Dashboard",
    subtitle: "Visión estratégica de producción, alertas y tendencias",
  },
  "/partes": {
    label: "Partes",
    subtitle: "Reconciliación diaria y seguimiento de descuadres",
    parent: "/",
    parentLabel: "Operaciones diarias",
  },
  "/dsj": {
    label: "Calculadora DJPMN",
    subtitle: "Simulación y validación de diferencias sin justificar",
    parent: "/",
    parentLabel: "Operaciones diarias",
  },
  "/analisis/diario": {
    label: "Análisis diario",
    subtitle: "Indicadores diarios de rendimiento y calidad",
    parent: "/",
    parentLabel: "Producción",
  },
  "/productores": {
    label: "Productores",
    subtitle: "Análisis de origen, rendimiento y comportamiento",
    parent: "/",
    parentLabel: "Producción",
  },
  "/calendario": {
    label: "Calendario",
    subtitle: "Planificación de producción y actividad",
    parent: "/",
    parentLabel: "Producción",
  },
  "/costes/consumos": {
    label: "Consumos",
    subtitle: "Control operativo de recursos y consumos físicos",
    parent: "/",
    parentLabel: "Operaciones",
  },
  "/costes/asistencia": {
    label: "Asistencia",
    subtitle: "Seguimiento de turnos, horas y equipos",
    parent: "/",
    parentLabel: "Operaciones",
  },
};
```

- [ ] **Step 3: Verify running**

Run: `npm run build`
Expected: No errors

---

### Task 3: Redesign Dashboard as Strategic Landing Page

**Files:**
- Modify: `src/pages/Dashboard.tsx`

- [ ] **Step 1: Restructure the Dashboard component**

Replace the entire `Dashboard.tsx` with the strategic version that features:
- Alertas activas section (DSJ críticos, partes en borrador)
- KPIs with trend arrows (production, DJPMN, palets, pace)
- Weekly area chart instead of composed bar+line
- Quick action buttons (nuevo parte, ir a hoy)
- Recent parts list with contextual links
- Skeleton loading for all sections

The key structural changes:
1. Add an "Alertas" section at the top when there are critical items
2. Replace the composed chart with a cleaner area chart
3. Add a "Acceso rápido" section with action buttons
4. Keep the semáforo and KPIs but rearrange for better scanning

Concrete code changes:

**a) Add alertas section after KPIs:**

```tsx
// ─── Alertas activas ──────────────────────────────────────────
const criticalPartes = useMemo(
  () => recentPartes.filter((p) => Math.abs(p.cascade.dsj_pct) > 5).slice(0, 3),
  [recentPartes]
);

// In the JSX, after the semáforo section:
{criticalPartes.length > 0 && (
  <Card className="border-red-200/50 bg-red-50/30 dark:bg-red-950/10">
    <CardHeader className="pb-2 flex flex-row items-center gap-2">
      <AlertTriangle className="h-4 w-4 text-destructive" />
      <CardTitle className="text-sm font-semibold text-destructive">
        Alertas activas
      </CardTitle>
      <Badge variant="destructive" className="ml-auto text-[10px]">
        {criticalPartes.length} pendientes
      </Badge>
    </CardHeader>
    <CardContent className="space-y-2">
      {criticalPartes.map((p) => (
        <Link
          key={p.id}
          to={`/partes/${p.id}`}
          className="flex items-center justify-between rounded-lg border border-red-200/50 bg-white/50 px-3 py-2 text-sm hover:bg-red-50/50 dark:bg-red-950/20 dark:hover:bg-red-950/30 transition-colors"
        >
          <span className="font-medium">{formatDate(p.date)}</span>
          <span className="font-bold text-destructive tabular-nums">
            {p.cascade.dsj_pct >= 0 ? "+" : ""}{p.cascade.dsj_pct.toFixed(2)}%
          </span>
        </Link>
      ))}
    </CardContent>
  </Card>
)}
```

**b) Add Acceso rápido section after the chart:**

```tsx
{/* ─── Acceso rápido ──────────────────────────────────────────── */}
<section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
  <Link
    to="/partes"
    className="flex items-center gap-4 rounded-xl glass glass-hover p-4 transition-all duration-200 hover:-translate-y-0.5"
  >
    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
      <Plus className="h-5 w-5" />
    </div>
    <div>
      <p className="text-sm font-semibold">Nuevo parte</p>
      <p className="text-xs text-muted-foreground">Crear parte diario</p>
    </div>
  </Link>
  <Link
    to="/analisis/diario"
    className="flex items-center gap-4 rounded-xl glass glass-hover p-4 transition-all duration-200 hover:-translate-y-0.5"
  >
    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600">
      <BarChart3 className="h-5 w-5" />
    </div>
    <div>
      <p className="text-sm font-semibold">Análisis diario</p>
      <p className="text-xs text-muted-foreground">Lotes, calibres, rendimiento</p>
    </div>
  </Link>
  <Link
    to="/calendario"
    className="flex items-center gap-4 rounded-xl glass glass-hover p-4 transition-all duration-200 hover:-translate-y-0.5"
  >
    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-500/10 text-amber-600">
      <CalendarDays className="h-5 w-5" />
    </div>
    <div>
      <p className="text-sm font-semibold">Calendario</p>
      <p className="text-xs text-muted-foreground">Planificación mensual</p>
    </div>
  </Link>
  <Link
    to="/costes/consumos"
    className="flex items-center gap-4 rounded-xl glass glass-hover p-4 transition-all duration-200 hover:-translate-y-0.5"
  >
    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-500/10 text-blue-600">
      <Droplet className="h-5 w-5" />
    </div>
    <div>
      <p className="text-sm font-semibold">Consumos</p>
      <p className="text-xs text-muted-foreground">Agua, energía, gasoil</p>
    </div>
  </Link>
</section>
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: No errors

---

### Task 4: Global Animations and CSS Polish

**Files:**
- Modify: `src/index.css`

- [ ] **Step 1: Add page transition animations**

Add to the `@layer utilities` section:
```css
@layer utilities {
  .animate-fadeIn {
    animation: fadeIn 0.3s ease-out;
  }

  .animate-slideIn {
    animation: slideIn 0.25s ease-out;
  }

  .animate-scaleIn {
    animation: scaleIn 0.2s ease-out;
  }
}

@keyframes slideIn {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
}

@keyframes scaleIn {
  from { opacity: 0; transform: scale(0.95); }
  to   { opacity: 1; transform: scale(1); }
}
```

- [ ] **Step 2: Add glass hover enhancement**

Add to `@layer components`:
```css
.glass-lift {
  @apply glass transition-all duration-200;
}
.glass-lift:hover {
  transform: translateY(-2px);
  box-shadow: var(--glass-shadow-lg), var(--glass-glow);
}
```

- [ ] **Step 3: Add page shell animation**

In `AppLayout.tsx`, update the Outlet container:
```tsx
<div className="flex flex-1 flex-col px-4 py-5 animate-slideIn sm:px-6 lg:px-8">
  <Outlet />
</div>
```

- [ ] **Step 4: Add breadcrumb to TopBar as glass element**

Already glass — but add the glass-hover class to the sidebar trigger for consistency.

- [ ] **Step 5: Verify**

Run: `npm run build`
Expected: No errors

---

### Task 5: Contextual Navigation Links

**Files:**
- Modify: `src/pages/Dashboard.tsx`
- Modify: `src/components/KPICard.tsx`

- [ ] **Step 1: Make KPICard optionally clickable**

Add `to` prop to KPICard:
```tsx
interface KPICardProps {
  label: string;
  value: string;
  hint?: string;
  icon?: LucideIcon;
  trend?: "up" | "down" | "neutral";
  className?: string;
  to?: string;  // new
}
```

When `to` is provided, wrap content in a `<Link>`:
```tsx
import { Link } from "react-router-dom";

const content = (
  <CardContent className="relative p-5">
    {/* existing content */}
  </CardContent>
);

if (to) {
  return (
    <Link to={to} className="block transition-all duration-200 hover:-translate-y-0.5">
      <Card className={cn("overflow-hidden", className)}>
        {content}
      </Card>
    </Link>
  );
}
```

- [ ] **Step 2: Wire KPICard links on Dashboard**

Add `to` props:
```tsx
<KPICard label="Producción real" value={formatKg(totals.produccion_real)} icon={Truck} to="/analisis/diario" />
<KPICard label="Kg dados de alta" value={formatKg(totals.palets_ajustados)} icon={Package} to="/partes" />
<KPICard label="Dif. Sin Justificar" value={formatKg(totals.dsj)} icon={TrendingDown} to="/dsj" />
<KPICard label="Velocidad media" value={avgTph !== null ? `${avgTph.toFixed(1)} T/h` : "—"} icon={Gauge} to="/analisis/diario" />
```

- [ ] **Step 3: Verify**

Run: `npm run build`
Expected: No errors

---

### Verification

- [ ] Run: `npm run build`
Expected: Clean build with no errors
- [ ] Run: `npm run dev`
Expected: App starts on localhost:8080
- [ ] Manual check: Cmd+K opens command palette
- [ ] Manual check: Sidebar shows regrouped nav
- [ ] Manual check: Dashboard shows alerts and quick actions
- [ ] Manual check: KPIs are clickable
- [ ] Manual check: Page transitions are smooth
