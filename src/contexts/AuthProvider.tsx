import { createContext, useContext, useEffect, useReducer, ReactNode } from "react";
import { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

type Role = "admin" | "operario" | null;

interface AuthContextValue {
  user: User | null;
  session: Session | null;
  role: Role;
  loading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

interface AuthState {
  session: Session | null;
  user: User | null;
  role: Role;
  loading: boolean;
}

type AuthAction =
  | { type: "SET_AUTH"; session: Session | null; user: User | null }
  | { type: "SET_ROLE"; role: Role }
  | { type: "SET_LOADING"; loading: boolean }
  | { type: "RESET" };

function authReducer(state: AuthState, action: AuthAction): AuthState {
  switch (action.type) {
    case "SET_AUTH":
      return { ...state, session: action.session, user: action.user };
    case "SET_ROLE":
      return { ...state, role: action.role };
    case "SET_LOADING":
      return { ...state, loading: action.loading };
    case "RESET":
      return { session: null, user: null, role: null, loading: false };
  }
}

const initialState: AuthState = { session: null, user: null, role: null, loading: true };

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(authReducer, initialState);

  useEffect(() => {
    let active = true;

    const applyRole = async (userId: string) => {
      const { data } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", userId)
        .maybeSingle();
      // Evita escribir un rol obsoleto si el componente se desmontó o cambió el usuario.
      if (active) dispatch({ type: "SET_ROLE", role: (data?.role as Role) ?? "operario" });
    };

    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      dispatch({ type: "SET_AUTH", session: newSession, user: newSession?.user ?? null });
      if (newSession?.user) {
        // Diferido: Supabase desaconseja llamar a su cliente dentro del callback de auth.
        setTimeout(() => { if (active) applyRole(newSession.user!.id); }, 0);
      } else {
        dispatch({ type: "SET_ROLE", role: null });
      }
      dispatch({ type: "SET_LOADING", loading: false });
    });

    supabase.auth.getSession().then(({ data: { session: s } }) => {
      if (!active) return;
      dispatch({ type: "SET_AUTH", session: s, user: s?.user ?? null });
      if (s?.user) setTimeout(() => { if (active) applyRole(s.user!.id); }, 0);
      dispatch({ type: "SET_LOADING", loading: false });
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  async function signOut() {
    // scope "local": cierra solo la sesión de ESTE navegador. El scope global
    // (por defecto) revocaba los tokens de todos los dispositivos de la cuenta
    // compartida y obligaba al resto a volver a iniciar sesión.
    await supabase.auth.signOut({ scope: "local" });
    dispatch({ type: "RESET" });
  }

  return (
    <AuthContext.Provider value={{ user: state.user, session: state.session, role: state.role, loading: state.loading, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
