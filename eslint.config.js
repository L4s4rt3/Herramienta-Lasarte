import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

// Qué se linta aquí: la APP (src/). Lo demás tiene su propio comprobador o no
// es código del navegador:
// - supabase/functions/**: Deno. Lo compila `deno check` en CI (.github/workflows/ci.yml);
//   con las globals del navegador este eslint daba falsos positivos.
// - scripts/**: Node (vite-node / .mjs) del portátil de la oficina.
// - .claude/worktrees/**: copias de trabajo de agentes; no son el código.
export default tseslint.config(
  { ignores: ["dist", ".claude/**", "supabase/functions/**", "scripts/**", "outputs/**", "tmp/**"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-unused-vars": "off",
      // Deuda conocida y aceptada (≈60 `any` en src/hooks y src/lib, sobre todo en
      // los parsers de Excel/OCR). Se ve como aviso para que no crezca sin
      // querer, pero no tumba el CI: el typecheck estricto es el que manda.
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
);
