import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';

// Forzamos la lectura exacta de las variables con VITE_
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error("ERROR: Variables de entorno de Supabase no cargadas.");
  console.log("VITE_SUPABASE_URL:", SUPABASE_URL);
  console.log("VITE_SUPABASE_ANON_KEY:", SUPABASE_ANON_KEY);
}

export const supabase = createClient<Database>(
  SUPABASE_URL || "", 
  SUPABASE_ANON_KEY || "", 
  {
    auth: {
      storage: localStorage,
      persistSession: true,
      autoRefreshToken: true,
    }
  }
);
