import { createContext, useContext, useState, ReactNode } from "react";

type Lang = "es" | "en";

const dict = {
  es: {
    app_name: "Lasarte SAT",
    login: "Iniciar sesión",
    logout: "Cerrar sesión",
    signup: "Crear cuenta",
    email: "Correo electrónico",
    password: "Contraseña",
    full_name: "Nombre completo",
    dashboard: "Dashboard",
    partes: "Partes diarios",
    parte: "Parte diario",
    new_parte: "Nuevo parte",
    date: "Fecha",
    state: "Estado",
    draft: "Borrador",
    closed: "Cerrado",
    reviewed: "Revisado",
    save: "Guardar",
    close: "Cerrar parte",
    reopen: "Reabrir",
    delete: "Eliminar",
    cancel: "Cancelar",
    actions: "Acciones",
    summary: "Resumen",
    cascade: "Cascada de masa",
    inputs: "Entradas",
    packed: "Palets packed",
    women: "Mujeres",
    recycled: "Reciclado",
    rotten: "Podrido",
    loss: "Merma",
    yield: "Rendimiento",
    pending_prev: "Palets pendientes anterior",
    final_inventory: "Inventario final",
    manual_kg: "Kg manuales",
    malla_z1: "Malla Z1",
    malla_z2: "Malla Z2",
    calibrator_rotten: "Podrido calibrador",
    general_notes: "Notas generales",
    inventory_notes: "Notas inventario",
    balanced: "Balanceado",
    unbalanced: "Desbalanceado",
    loading: "Cargando…",
    no_data: "Sin datos",
    total: "Total",
    today: "Hoy",
    last_30_days: "Últimos 30 días",
  },
  en: {
    app_name: "Lasarte SAT",
    login: "Sign in",
    logout: "Sign out",
    signup: "Create account",
    email: "Email",
    password: "Password",
    full_name: "Full name",
    dashboard: "Production control",
    partes: "Daily reports",
    parte: "Daily report",
    new_parte: "New report",
    date: "Date",
    state: "Status",
    draft: "Draft",
    closed: "Closed",
    reviewed: "Reviewed",
    save: "Save",
    close: "Close report",
    reopen: "Reopen",
    delete: "Delete",
    cancel: "Cancel",
    actions: "Actions",
    summary: "Summary",
    cascade: "Mass cascade",
    inputs: "Inputs",
    packed: "Packed pallets",
    women: "Women sort",
    recycled: "Recycled",
    rotten: "Rotten",
    loss: "Loss",
    yield: "Yield",
    pending_prev: "Pending pallets (prev)",
    final_inventory: "Final inventory",
    manual_kg: "Manual kg",
    malla_z1: "Mesh Z1",
    malla_z2: "Mesh Z2",
    calibrator_rotten: "Calibrator rotten",
    general_notes: "General notes",
    inventory_notes: "Inventory notes",
    balanced: "Balanced",
    unbalanced: "Unbalanced",
    loading: "Loading…",
    no_data: "No data",
    total: "Total",
    today: "Today",
    last_30_days: "Last 30 days",
  },
} as const;

type Key = keyof typeof dict.es;

interface I18nCtx {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (k: Key) => string;
}

const Ctx = createContext<I18nCtx | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<Lang>(
    (typeof localStorage !== "undefined" && (localStorage.getItem("lang") as Lang)) || "es"
  );
  const update = (l: Lang) => {
    setLang(l);
    localStorage.setItem("lang", l);
  };
  const t = (k: Key) => dict[lang][k] ?? k;
  return <Ctx.Provider value={{ lang, setLang: update, t }}>{children}</Ctx.Provider>;
}

export function useI18n() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useI18n must be inside I18nProvider");
  return c;
}
