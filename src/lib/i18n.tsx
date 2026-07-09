import { createContext, useContext, ReactNode } from "react";

const dict = {
  app_name: "Lasarte Cítricos S.L.",
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
} as const;

type Key = keyof typeof dict;

interface I18nCtx {
  t: (k: Key) => string;
}

const Ctx = createContext<I18nCtx | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const t = (k: Key) => dict[k] ?? k;
  return <Ctx.Provider value={{ t }}>{children}</Ctx.Provider>;
}

export function useI18n() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useI18n must be inside I18nProvider");
  return c;
}
