# Login Redesign — Lasarte SAT

## Objective

Redesign the login/authentication page (`Auth.tsx`) of controlproduccion.vercel.app to a modern, clean, premium SaaS aesthetic tailored for an agricultural/citrus company (Lasarte SAT). Replace the current dark citrus photo with glass-effect form into a professional two-column layout.

## Layout

- **Two columns** — full viewport height split
- **Left column** (flex-1, max 580px form width): Form centered vertically on `#F8F6EF` background
- **Right column** (480px fixed): Image of citrus farm/orchard/warehouse with `border-radius: 16px` on the right side (margin 16px top/right/bottom)
- **Responsive** (<768px): Image column hidden, form takes full width

## Branding (top-left of form column)

- Logo image (`/logo.jpg`) — 44×44px, rounded corners 10px
- Text: "Lasarte SAT" (16px, weight 600, `#17231A`)
- Subtitle: "Control de producción citrícola" (12px, `#6B756A`)

## Form Content (in order)

1. **Title**: "Bienvenido" (28px, weight 600, `#17231A`, letter-spacing -0.3px)
2. **Subtitle**: "Accede al panel de control de producción" (14px, `#6B756A`)
3. **Email field**: label "Correo electrónico", input with 12px 16px padding, border 1.5px `#E5E2D8`, border-radius 10px, white background, focus ring orange (#F97316 at 8% opacity)
4. **Password field**: label "Contraseña", same input style
5. **Row**: checkbox "Recordarme" (left) + link "¿Has olvidado tu contraseña?" (right, `#F97316`)
6. **Primary button**: "Iniciar sesión" — full width, 14px padding, bg `#F97316`, hover `#EA580C`, border-radius 10px, weight 600, white text
7. **Divider**: `────── o ──────` with `#E5E2D8` lines
8. **Google button**: outline style with border `#E5E2D8`, "G" icon + "Continuar con Google"
9. **Signup link**: "¿Nuevo en Lasarte SAT? Crear cuenta" (centered, link in `#F97316`)

## Color Palette

| Token | Hex | Usage |
|-------|-----|-------|
| `--auth-bg` | `#F8F6EF` | Form column background |
| `--auth-text` | `#17231A` | Primary text |
| `--auth-muted` | `#6B756A` | Secondary/muted text |
| `--auth-green` | `#173A27` | Dark green (image column fallback bg) |
| `--auth-olive` | `#8A9A5B` | Olive green accent |
| `--auth-orange` | `#F97316` | Primary CTA, links, focus ring |
| `--auth-orange-hover` | `#EA580C` | Button hover state |
| `--auth-border` | `#E5E2D8` | Borders, divider lines |
| `--auth-input-bg` | `#FFFFFF` | Input background |

## Typography

- Font: Inter (system fallback) — already used in project
- No font-face changes needed

## Image Column (right)

- Uses `public/login-bg.jpg` — a real photo of citrus orchard/farm/warehouse
- Fallback: gradient `#173A27` → `#2D5A3E` if image not loaded
- Subtle gradient overlay at bottom for text readability
- Footer text: "© 2026 Lasarte SAT" (left) + "Contacto · Documentación" (right) — 12px, white at 50% opacity
- Support text: "Producción diaria, DJPMN, stock, consumos y asistencia en una sola herramienta de control para planta."

## Code Changes

### Files to modify
- `src/pages/Auth.tsx` — complete JSX rewrite
- `src/index.css` — add auth-specific CSS custom properties (scoped, not affecting dashboard)
- `public/logo.jpg` — Lasarte SAT logo (already copied)
- `public/login-bg.jpg` — citrus farm image (needs to be provided)

### Files NOT to modify
- Dashboard pages, components, contexts, hooks, lib, integrations
- Tailwind config, other CSS

## Constraints

- No glass effects on form
- No dark overlays on image (only subtle bottom gradient)
- No blue colors in inputs
- No hard shadows
- Keep existing auth logic (Supabase sign-in/sign-up, Google OAuth, error handling, toast notifications)
- Keep existing Zod validation schemas
- Keep existing `useI18n` translations
- **Remove tabs** — single signin form with "¿Nuevo en Lasarte SAT? Crear cuenta" link below
- Signup form shown on a separate `/registro` route or inline state toggle
