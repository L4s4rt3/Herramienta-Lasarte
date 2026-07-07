// src/pages/VentasCategoriaPrimera.tsx
// Ventas de categoria primera: misma UI y comportamiento que Categoria
// segunda (VentasCategoriaSegunda.tsx), pero acotada a la categoria
// "Categoria primera" en Supabase.
import { VentasCategoriaPage } from "@/pages/VentasCategoriaSegunda";

export default function VentasCategoriaPrimera() {
  return (
    <VentasCategoriaPage
      categoriaNombre="Categoria primera"
      titulo="Categoria primera"
      subtitulo="Ventas del resto de productos y clientes (primera categoria)."
    />
  );
}
