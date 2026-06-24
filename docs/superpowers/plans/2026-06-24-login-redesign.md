# Login Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite `Auth.tsx` to a modern two-column SaaS login page with premium agricultural branding.

**Architecture:** Replace the current glass-effect layout with a clean two-column split (form left, citrus image right). Keep all Supabase auth logic intact. Use Tailwind for layout + inline styles for auth-specific colors — no global CSS changes. Signup is toggled inline via state instead of tabs.

**Tech Stack:** React + TypeScript, Tailwind CSS, Supabase auth, Zod validation

---

### Task 1: Add auth CSS variables

**Files:**
- Modify: `src/index.css` (add at end of `:root` block, line 78 before the closing brace)

- [ ] **Step 1: Add auth color variables**

Insert before the closing `}` of `:root` (after line 78):

```css
/* ── Auth page tokens ─────────────────────────────────── */
--auth-bg: #F8F6EF;
--auth-text: #17231A;
--auth-muted: #6B756A;
--auth-green: #173A27;
--auth-olive: #8A9A5B;
--auth-orange: #F97316;
--auth-orange-hover: #EA580C;
--auth-border: #E5E2D8;
--auth-input-bg: #FFFFFF;
```

Also add to the `.dark` block (same position, after line 132):

```css
/* ── Auth page tokens (dark) ──────────────────────────── */
--auth-bg: #F8F6EF;
--auth-text: #17231A;
--auth-muted: #6B756A;
--auth-green: #173A27;
--auth-olive: #8A9A5B;
--auth-orange: #F97316;
--auth-orange-hover: #EA580C;
--auth-border: #E5E2D8;
--auth-input-bg: #FFFFFF;
```

(The dark theme auth keeps same colors since auth page should always look clean/light.)

- [ ] **Step 2: Verify no conflicts**

Run: `npm run build` (or `npx tsc --noEmit`)
Expected: No errors

- [ ] **Step 3: Git commit**

```bash
git add src/index.css
git commit -m "feat(auth): add auth color CSS variables"
```

---

### Task 2: Rewrite Auth.tsx — Layout & Brand

**Files:**
- Modify: `src/pages/Auth.tsx` (full rewrite)

- [ ] **Step 1: Replace imports**

Keep these existing imports:
```tsx
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthProvider";
import { useI18n } from "@/lib/i18n";
import { z } from "zod";
```

Remove these (no longer needed):
- `{ Card, CardContent, CardHeader, CardTitle, CardDescription }`
- `{ Tabs, TabsList, TabsTrigger, TabsContent }`
- `{ Citrus, ShieldCheck }` from `lucide-react`

- [ ] **Step 2: Keep existing logic (unchanged)**

Preserve all functions exactly as they are:
- `emailSchema`, `passwordSchema`, `nameSchema`
- `getErrorMessage`
- `handleSignIn`
- `handleSignUp`
- `handleGoogle`
- `useEffect` redirect

- [ ] **Step 3: Replace the return JSX**

Full new JSX structure:

```tsx
return (
  <div
    className="grid min-h-screen lg:grid-cols-[1fr_480px]"
    style={{ backgroundColor: "var(--auth-bg)" }}
  >
    {/* ── Left column: Form ── */}
    <div className="flex min-h-screen flex-col justify-center px-6 py-12 sm:px-12 lg:px-16">
      {/* Brand */}
      <div className="mb-12 flex items-center gap-3">
        <img
          src="/logo.jpg"
          alt="Lasarte SAT"
          className="h-11 w-11 rounded-[10px] object-cover"
        />
        <div>
          <p style={{ color: "var(--auth-text)", fontSize: "16px", fontWeight: 600, lineHeight: 1.2 }}>
            Lasarte SAT
          </p>
          <p style={{ color: "var(--auth-muted)", fontSize: "12px" }}>
            Control de producción citrícola
          </p>
        </div>
      </div>

      {/* Form content */}
      <div className="w-full max-w-[400px]">
        <h1
          style={{
            fontSize: "28px", fontWeight: 600, color: "var(--auth-text)",
            letterSpacing: "-0.3px", marginBottom: "6px",
          }}
        >
          Bienvenido
        </h1>
        <p
          style={{
            fontSize: "14px", color: "var(--auth-muted)", marginBottom: "32px",
          }}
        >
          Accede al panel de control de producción
        </p>

        {!isSignUp ? (
          /* ── Sign In Form ── */
          <form onSubmit={handleSignIn} className="space-y-5">
            <div className="space-y-2">
              <Label style={{ fontSize: "13px", fontWeight: 500, color: "var(--auth-text)" }}>
                Correo electrónico
              </Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="h-12"
                style={{
                  border: "1.5px solid var(--auth-border)", borderRadius: "10px",
                  backgroundColor: "var(--auth-input-bg)", color: "var(--auth-text)",
                  fontSize: "14px", padding: "12px 16px",
                }}
              />
            </div>
            <div className="space-y-2">
              <Label style={{ fontSize: "13px", fontWeight: 500, color: "var(--auth-text)" }}>
                Contraseña
              </Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="h-12"
                style={{
                  border: "1.5px solid var(--auth-border)", borderRadius: "10px",
                  backgroundColor: "var(--auth-input-bg)", color: "var(--auth-text)",
                  fontSize: "14px", padding: "12px 16px",
                }}
              />
            </div>

            {/* Row: remember + forgot */}
            <div className="flex items-center justify-between">
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded"
                  style={{ accentColor: "var(--auth-orange)" }}
                />
                <span style={{ fontSize: "13px", color: "var(--auth-muted)" }}>
                  Recordarme
                </span>
              </label>
              <a
                href="#"
                style={{
                  fontSize: "13px", color: "var(--auth-orange)",
                  fontWeight: 500, textDecoration: "none",
                }}
                onClick={(e) => { e.preventDefault(); toast({ title: "Restablecer contraseña", description: "Funcionalidad próximamente." }); }}
              >
                ¿Has olvidado tu contraseña?
              </a>
            </div>

            <Button
              type="submit"
              disabled={loading}
              className="h-12 w-full border-none text-base font-semibold"
              style={{
                backgroundColor: "var(--auth-orange)", color: "#fff",
                borderRadius: "10px",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "var(--auth-orange-hover)")}
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "var(--auth-orange)")}
            >
              {loading ? "..." : "Iniciar sesión"}
            </Button>

            {/* Divider */}
            <div className="flex items-center gap-4">
              <span className="flex-1" style={{ height: "1px", backgroundColor: "var(--auth-border)" }} />
              <span style={{ fontSize: "12px", color: "var(--auth-muted)", fontWeight: 500 }}>o</span>
              <span className="flex-1" style={{ height: "1px", backgroundColor: "var(--auth-border)" }} />
            </div>

            {/* Google button */}
            <Button
              type="button"
              variant="outline"
              className="h-12 w-full text-base font-medium"
              style={{
                border: "1.5px solid var(--auth-border)", borderRadius: "10px",
                color: "var(--auth-text)", backgroundColor: "#fff",
              }}
              onClick={handleGoogle}
            >
              <span className="mr-2 font-bold" style={{ color: "var(--auth-orange)" }}>G</span>
              Continuar con Google
            </Button>

            {/* Signup link */}
            <p className="text-center" style={{ fontSize: "13px", color: "var(--auth-muted)" }}>
              ¿Nuevo en Lasarte SAT?{" "}
              <button
                type="button"
                style={{
                  color: "var(--auth-orange)", fontWeight: 500,
                  background: "none", border: "none", cursor: "pointer",
                  fontSize: "13px",
                }}
                onClick={() => setIsSignUp(true)}
              >
                Crear cuenta
              </button>
            </p>
          </form>
        ) : (
          /* ── Sign Up Form ── */
          <form onSubmit={handleSignUp} className="space-y-5">
            <div className="space-y-2">
              <Label style={{ fontSize: "13px", fontWeight: 500, color: "var(--auth-text)" }}>
                Nombre completo
              </Label>
              <Input
                id="name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                required
                maxLength={100}
                className="h-12"
                style={{
                  border: "1.5px solid var(--auth-border)", borderRadius: "10px",
                  backgroundColor: "var(--auth-input-bg)", color: "var(--auth-text)",
                  fontSize: "14px", padding: "12px 16px",
                }}
              />
            </div>
            <div className="space-y-2">
              <Label style={{ fontSize: "13px", fontWeight: 500, color: "var(--auth-text)" }}>
                Correo electrónico
              </Label>
              <Input
                id="email2"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="h-12"
                style={{
                  border: "1.5px solid var(--auth-border)", borderRadius: "10px",
                  backgroundColor: "var(--auth-input-bg)", color: "var(--auth-text)",
                  fontSize: "14px", padding: "12px 16px",
                }}
              />
            </div>
            <div className="space-y-2">
              <Label style={{ fontSize: "13px", fontWeight: 500, color: "var(--auth-text)" }}>
                Contraseña
              </Label>
              <Input
                id="password2"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                className="h-12"
                style={{
                  border: "1.5px solid var(--auth-border)", borderRadius: "10px",
                  backgroundColor: "var(--auth-input-bg)", color: "var(--auth-text)",
                  fontSize: "14px", padding: "12px 16px",
                }}
              />
            </div>
            <Button
              type="submit"
              disabled={loading}
              className="h-12 w-full border-none text-base font-semibold"
              style={{
                backgroundColor: "var(--auth-orange)", color: "#fff",
                borderRadius: "10px",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "var(--auth-orange-hover)")}
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "var(--auth-orange)")}
            >
              {loading ? "..." : "Crear cuenta"}
            </Button>
            <p className="text-center" style={{ fontSize: "13px", color: "var(--auth-muted)" }}>
              ¿Ya tienes cuenta?{" "}
              <button
                type="button"
                style={{
                  color: "var(--auth-orange)", fontWeight: 500,
                  background: "none", border: "none", cursor: "pointer",
                  fontSize: "13px",
                }}
                onClick={() => setIsSignUp(false)}
              >
                Iniciar sesión
              </button>
            </p>
          </form>
        )}
      </div>
    </div>

    {/* ── Right column: Image ── */}
    <div
      className="relative hidden overflow-hidden lg:block"
      style={{
        margin: "16px 16px 16px 0",
        borderRadius: "16px",
        backgroundColor: "var(--auth-green)",
      }}
    >
      <img
        src="/login-bg.jpg"
        alt="Lasarte SAT — Producción citrícola"
        className="h-full w-full object-cover"
        onError={(e) => {
          (e.currentTarget as HTMLImageElement).style.display = "none";
        }}
      />
      {/* Gradient overlay for text */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background: "linear-gradient(transparent 60%, rgba(23, 35, 26, 0.6))",
        }}
      />
      {/* Support text */}
      <div
        className="absolute bottom-0 left-0 right-0 p-8"
        style={{ pointerEvents: "none" }}
      >
        <p
          style={{
            color: "#fff", fontSize: "14px", lineHeight: "1.6",
            opacity: 0.9, maxWidth: "320px", marginBottom: "24px",
          }}
        >
          Producción diaria, DJPMN, stock, consumos y asistencia en una sola herramienta de control para planta.
        </p>
        <div className="flex items-center justify-between">
          <span style={{ color: "rgba(255,255,255,0.5)", fontSize: "12px" }}>
            &copy; 2026 Lasarte SAT
          </span>
          <span style={{ color: "rgba(255,255,255,0.5)", fontSize: "12px" }}>
            Contacto &middot; Documentación
          </span>
        </div>
      </div>
    </div>
  </div>
);
```

- [ ] **Step 4: Add `isSignUp` state**

Add this state variable with the other state declarations (after line 30):

```tsx
const [isSignUp, setIsSignUp] = useState(false);
```

- [ ] **Step 5: Run type check**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 6: Run lint**

Run: `npm run lint` (or whatever lint command is configured)
Expected: No errors

- [ ] **Step 7: Git commit**

```bash
git add src/pages/Auth.tsx
git commit -m "feat(auth): redesign login page with two-column layout"
```

---

### Task 3: Add login background image

**Files:**
- Add: `public/login-bg.jpg`

- [ ] **Step 1: User provides image**

The user needs to place a citrus/farm image at `public/login-bg.jpg`.

If unavailable, the fallback green background (`--auth-green`) will show instead.

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: Build succeeds
