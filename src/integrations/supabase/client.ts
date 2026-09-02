import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error("Variables de entorno de Supabase no configuradas.");
}

export const supabase = createClient<Database>(
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  {
    auth: {
      storage: localStorage,
      persistSession: true,
      autoRefreshToken: true,
    }
  }
);

/**
 * El MISMO cliente (misma sesión, misma conexión) visto sin el tipo `Database`.
 *
 * SOLO para consultas cuyo nombre de tabla o de columna es una VARIABLE (la
 * conciliación de productores recorre una lista de tablas; el estado de las
 * fuentes pregunta a cada tabla por su última fecha). Ahí el tipado generado no
 * puede ayudar y antes cada hook se fabricaba su propio
 * `supabase as unknown as SupabaseClient<any>` — 48 copias que, de paso,
 * anulaban el tipado también en las consultas normales del fichero. Desde el
 * 02-09-2026 esas consultas usan `supabase` (tipado) y las dinámicas, esto.
 */
export const supabaseLibre = supabase as unknown as import("@supabase/supabase-js").SupabaseClient;
