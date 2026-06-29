# Calidad MVP Vision Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first usable Calidad MVP for photo-backed lot reports with autosaved drafts, IA-assisted report text, human validation, locked official reports, draft/official PDFs, and historical structured data.

**Architecture:** Extend the existing Calidad module instead of rewriting it. Keep Supabase tables compatible by adding nullable/defaulted columns to `calidad_lotes`, update `src/lib/calidad.ts` as the domain/export boundary, then wire `src/pages/CalidadJornada.tsx` to autosave and state transitions. IA is MVP-local report generation from structured data/photos count; true multimodal model integration remains a later task.

**Tech Stack:** React/Vite/TypeScript, Supabase/Postgres, Supabase Storage, shadcn/ui, jsPDF, Vitest.

---

## File Structure

- Modify `src/lib/calidad.ts`: source of truth for quality options, defect options, report states, validation helpers, draft report generation, Excel/PDF export.
- Modify `src/pages/CalidadJornada.tsx`: UI labels, autosave, locked validated state, generate report, validate, reopen, draft/official PDF actions.
- Create `src/lib/calidadMvp.test.ts`: focused tests for new quality/defect states, `Otro` validation, report state transitions, draft PDF metadata helpers.
- Create `supabase/migrations/20260629120000_calidad_mvp_vision.sql`: additive migration for report state, IA proposal fields, validation/reopen metadata, `otro` detail and quality check update.
- Update `docs/superpowers/specs/2026-06-29-calidad-mvp-vision-design.md` only if implementation discovers a necessary scope correction.

## Scope Notes

- Do not implement the mallas module in this plan.
- Do not train or call a real vision model in this plan.
- Do not require a new external API key in this plan.
- Preserve existing Calidad data by mapping `Rechazado` to `Pésimo`.

---

### Task 1: Domain Model and Tests

**Files:**
- Modify: `src/lib/calidad.ts`
- Create: `src/lib/calidadMvp.test.ts`

- [ ] **Step 1: Add failing tests for options, validation, and state helpers**

Create `src/lib/calidadMvp.test.ts` with:

```ts
import { describe, expect, it } from "vitest";
import {
  CALIDAD_OPTIONS,
  DEFECTO_OPTIONS,
  canValidateCalidadLote,
  createCalidadDraftReport,
  isCalidadLoteLocked,
  reopenCalidadLote,
  validateCalidadLote,
  type CalidadLote,
} from "./calidad";

function lote(overrides: Partial<CalidadLote> = {}): CalidadLote {
  return {
    id: "lote-1",
    jornada_id: "jornada-1",
    user_id: "user-1",
    fecha: "2026-06-29",
    numero_lote: "L-1",
    productor_finca_id: null,
    productor_finca_nombre: "Finca A",
    producto: "Naranja",
    variedad: "Navelina",
    cantidad: "64 frutos",
    hora: null,
    aerobotics_realizado: false,
    calidad: "Regular",
    defectos: [],
    defecto_otro: "",
    observacion: "",
    accion_recomendada: "",
    informe_estado: "borrador",
    informe_generado: "",
    ia_calidad: null,
    ia_defectos: [],
    ia_resumen: "",
    ia_accion_recomendada: "",
    validado_at: null,
    validado_by: null,
    reabierto_at: null,
    reabierto_by: null,
    motivo_reapertura: "",
    created_at: "2026-06-29T10:00:00Z",
    updated_at: "2026-06-29T10:00:00Z",
    ...overrides,
  };
}

describe("calidad MVP domain", () => {
  it("uses the agreed quality and defect options", () => {
    expect(CALIDAD_OPTIONS).toEqual(["Excelente", "Bueno", "Regular", "Deficiente", "Pésimo"]);
    expect(DEFECTO_OPTIONS).toEqual([
      "Rameado",
      "Golpe",
      "Podrido",
      "Mancha",
      "Calibre irregular",
      "Color verde",
      "Piel blanda",
      "Deshidratado",
      "Plaga",
      "Otro",
    ]);
  });

  it("blocks validation when Otro is selected without a manual description", () => {
    const result = canValidateCalidadLote(lote({ defectos: ["Otro"], defecto_otro: "" }), 1);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("Otro");
  });

  it("allows validation with photos and an Otro description", () => {
    const result = canValidateCalidadLote(lote({ defectos: ["Otro"], defecto_otro: "Arañazo raro" }), 1);
    expect(result.ok).toBe(true);
  });

  it("validates and locks a report", () => {
    const validated = validateCalidadLote(lote({ informe_estado: "generado" }), "user-2", "2026-06-29T12:00:00Z");
    expect(validated.informe_estado).toBe("validado");
    expect(validated.validado_by).toBe("user-2");
    expect(isCalidadLoteLocked(validated)).toBe(true);
  });

  it("reopens a validated report and requires revalidation", () => {
    const reopened = reopenCalidadLote(
      lote({ informe_estado: "validado", validado_at: "2026-06-29T12:00:00Z", validado_by: "user-2" }),
      "user-3",
      "2026-06-29T13:00:00Z",
    );
    expect(reopened.informe_estado).toBe("reabierto");
    expect(reopened.reabierto_by).toBe("user-3");
    expect(isCalidadLoteLocked(reopened)).toBe(false);
  });

  it("creates a useful draft report from structured data", () => {
    const report = createCalidadDraftReport(lote({ calidad: "Deficiente", defectos: ["Golpe", "Podrido"] }), 3, []);
    expect(report.informe).toContain("Finca A");
    expect(report.informe).toContain("Deficiente");
    expect(report.informe).toContain("Golpe");
    expect(report.accion_recomendada).toContain("Revisar");
  });
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `npx.cmd vitest run src/lib/calidadMvp.test.ts`

Expected: FAIL because the new exports do not exist yet.

- [ ] **Step 3: Implement the domain exports**

In `src/lib/calidad.ts`:

- Replace `CALIDAD_OPTIONS` with `["Excelente", "Bueno", "Regular", "Deficiente", "Pésimo"]`.
- Add `DEFECTO_OPTIONS`.
- Add `CalidadInformeEstado = "borrador" | "generado" | "validado" | "reabierto"`.
- Extend `CalidadLote` with `user_id`, `defecto_otro`, `informe_estado`, `informe_generado`, IA fields and validation/reopen metadata.
- Add helpers:
  - `canValidateCalidadLote(lote, photoCount)`
  - `isCalidadLoteLocked(lote)`
  - `validateCalidadLote(lote, userId, isoDate)`
  - `reopenCalidadLote(lote, userId, isoDate)`
  - `createCalidadDraftReport(lote, photoCount, history)`

- [ ] **Step 4: Run the focused test and verify it passes**

Run: `npx.cmd vitest run src/lib/calidadMvp.test.ts`

Expected: PASS.

---

### Task 2: Supabase Migration

**Files:**
- Create: `supabase/migrations/20260629120000_calidad_mvp_vision.sql`

- [ ] **Step 1: Add the migration**

Create `supabase/migrations/20260629120000_calidad_mvp_vision.sql`:

```sql
-- Calidad MVP: informe visual asistido, borradores, validacion y reapertura.

ALTER TABLE public.calidad_lotes
  DROP CONSTRAINT IF EXISTS calidad_lotes_estado_check;

UPDATE public.calidad_lotes
SET calidad = 'Pésimo'
WHERE calidad = 'Rechazado';

ALTER TABLE public.calidad_lotes
  ADD COLUMN IF NOT EXISTS defecto_otro TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS informe_estado TEXT NOT NULL DEFAULT 'borrador',
  ADD COLUMN IF NOT EXISTS informe_generado TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS ia_calidad TEXT,
  ADD COLUMN IF NOT EXISTS ia_defectos TEXT[] NOT NULL DEFAULT '{}'::TEXT[],
  ADD COLUMN IF NOT EXISTS ia_resumen TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS ia_accion_recomendada TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS validado_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS validado_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reabierto_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reabierto_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS motivo_reapertura TEXT NOT NULL DEFAULT '';

ALTER TABLE public.calidad_lotes
  ADD CONSTRAINT calidad_lotes_estado_check
  CHECK (calidad IN ('Excelente', 'Bueno', 'Regular', 'Deficiente', 'Pésimo'));

ALTER TABLE public.calidad_lotes
  DROP CONSTRAINT IF EXISTS calidad_lotes_informe_estado_check;

ALTER TABLE public.calidad_lotes
  ADD CONSTRAINT calidad_lotes_informe_estado_check
  CHECK (informe_estado IN ('borrador', 'generado', 'validado', 'reabierto'));

CREATE INDEX IF NOT EXISTS calidad_lotes_informe_estado_idx
  ON public.calidad_lotes (informe_estado);

CREATE INDEX IF NOT EXISTS calidad_lotes_productor_fecha_idx
  ON public.calidad_lotes (productor_finca_nombre, fecha);
```

- [ ] **Step 2: Do not apply remote migration automatically**

Leave the migration file ready for the existing Supabase deployment flow. Applying to production requires explicit user approval because it changes the remote database schema.

---

### Task 3: Export and PDF Behavior

**Files:**
- Modify: `src/lib/calidad.ts`
- Test: `src/lib/calidadMvp.test.ts`

- [ ] **Step 1: Extend Excel rows**

Update `buildCalidadExcelRows` and `buildCalidadIncidentRows` to include:

- Estado informe.
- Informe generado.
- IA calidad.
- IA defectos.
- Otro defecto.
- Validado at/by.
- Reabierto at/by.

- [ ] **Step 2: Add PDF mode**

Change `exportCalidadToPDF` signature to:

```ts
export function exportCalidadToPDF(
  jornada: CalidadJornada,
  lotes: CalidadLote[],
  adjuntos: CalidadAdjunto[],
  options: { mode?: "borrador" | "oficial" } = {},
)
```

If `mode === "borrador"`, draw a visible `BORRADOR` mark on each page and save as `calidad_<fecha>_borrador.pdf`.

If `mode === "oficial"`, include only validated lots when called from the official button and save as `calidad_<fecha>_oficial.pdf`.

- [ ] **Step 3: Run focused tests**

Run: `npx.cmd vitest run src/lib/calidadMvp.test.ts`

Expected: PASS.

---

### Task 4: Calidad UI Autosave and States

**Files:**
- Modify: `src/pages/CalidadJornada.tsx`

- [ ] **Step 1: Update labels and options**

Use `DEFECTO_OPTIONS` from `src/lib/calidad.ts` instead of local `DEFECTOS`.

Update `QUALITY_STYLES` for:

- Excelente.
- Bueno.
- Regular.
- Deficiente.
- Pésimo.

- [ ] **Step 2: Add dirty autosave state**

Add local state:

```ts
const [autosaveStatus, setAutosaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
const autosaveTimerRef = useRef<number | null>(null);
```

Add `persistLote(lote, options)` helper that updates Supabase and local state.

Add `scheduleAutosave(nextLote)` so `patchSelected` updates local state immediately and saves after a short debounce.

- [ ] **Step 3: Respect locked validated reports**

When `isCalidadLoteLocked(selected)`:

- Disable fields.
- Hide or disable destructive edits.
- Show `Reabrir edición`.
- Still allow official PDF download.

- [ ] **Step 4: Add report actions**

Add buttons:

- `Generar informe`: calls `createCalidadDraftReport`, stores IA proposal fields and `informe_estado = "generado"`.
- `Validar informe`: uses `canValidateCalidadLote`; if valid, stores `validateCalidadLote(...)`.
- `Reabrir edición`: stores `reopenCalidadLote(...)`.
- `PDF borrador`: calls `exportCalidadToPDF(..., { mode: "borrador" })`.
- `PDF oficial`: enabled when selected lot or all selected export set is validated; calls official mode.

- [ ] **Step 5: Handle Otro**

When `Otro` is selected, show an input for `defecto_otro`.

Block validation with a toast if `Otro` is selected and `defecto_otro` is blank.

---

### Task 5: Verification

**Files:**
- Test: `src/lib/calidadMvp.test.ts`
- Build: whole app

- [ ] **Step 1: Run focused unit tests**

Run: `npx.cmd vitest run src/lib/calidadMvp.test.ts src/lib/exportReports.test.ts src/lib/exportWorkbook.test.ts`

Expected: PASS.

- [ ] **Step 2: Run production build**

Run: `npm.cmd run build`

Expected: PASS.

- [ ] **Step 3: Run focused ESLint**

Run:

```powershell
npx.cmd eslint src/lib/calidad.ts src/lib/calidadMvp.test.ts src/pages/CalidadJornada.tsx
```

Expected: no new errors. Existing repo-wide lint errors outside these files are not part of this plan.

- [ ] **Step 4: Manual QA checklist**

Start Vite and verify:

- Create a lot.
- Change quality and defects.
- Select `Otro` and see description input.
- Generate report.
- Reload page and confirm draft persists.
- Validate report and confirm fields lock.
- Reopen report and confirm fields unlock.
- Generate draft PDF and official PDF.

---

## Self-Review

- Spec coverage: photos, draft save, IA proposal, human validation, PDF modes, states, historical fields and exact quality/defect options are covered.
- Scope check: mallas, real vision model, model training, segmentation and advanced dashboards are intentionally excluded.
- Placeholder scan: no TBD/TODO placeholders are present.
- Type consistency: plan uses `informe_estado`, `defecto_otro`, IA fields, validation/reopen fields consistently across migration, lib and UI.
