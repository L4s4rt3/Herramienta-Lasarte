# Fix: Error "removeChild on Node" en navegación

## Contexto

Los usuarios reportan el error `"Failed to execute 'removeChild' on 'Node': The node to be removed is not a child of this node"` al navegar entre páginas en producción. El error ocurre en 3 dispositivos de otros usuarios pero no en incógnito, lo que indica que extensiones del navegador (Google Translate, Grammarly, etc.) son un factor contribuyente. Sin embargo, también existen problemas de **HTML inválido** en el código que pueden causar el mismo error independientemente de las extensiones.

El error ocurre cuando el DOM real diverge del DOM virtual de React: el navegador auto-corrige HTML inválido o extensiones inyectan nodos, y cuando React intenta desmontar/actualizar componentes, llama a `removeChild` sobre un nodo que ya no es hijo del padre esperado.

---

## Cambios

### 1. Fix `<button>` conteniendo `<a>` (CRÍTICO)

**Archivo:** `src/pages/Productores.tsx:274-290`

**Problema:** Un `<button>` nativo envuelve un `<Link>` (que renderiza como `<a>`). Esto es HTML inválido (`<button>` no puede contener `<a>`). El navegador auto-corrige la estructura, causando divergencia con el DOM virtual de React.

**Solución:** Convertir el `<button>` en un `<div>` con `role="button"` y `tabIndex={0}`, manteniendo la misma funcionalidad y estilos. El `<Link>` queda como hijo válido. Agregar `onKeyDown` para accesibilidad.

### 2. Fix `<table>` sin `<tbody>` en dangerouslySetInnerHTML (ALTO)

**Archivo:** `src/components/ReporteOperativo.tsx:28-58` (función `flushTable`)

**Problema:** El renderer Markdown genera `<table><tr>...</tr></table>` sin `<thead>` ni `<tbody>`. El navegador auto-inserta `<tbody>`, creando una estructura DOM diferente a la que React espera.

**Solución:** Separar la primera fila (header) en `<thead>` y las filas de datos en `<tbody>`.

### 3. Fix `<li>` sin `<ul>` padre en dangerouslySetInnerHTML (ALTO)

**Archivo:** `src/components/ReporteOperativo.tsx:86-93`

**Problema:** Los items de lista se emiten como `<li>` huérfanos sin `<ul>` padre. El navegador auto-inserta `<ul>`, causando divergencia con React.

**Solución:** Agregar lógica de tracking de listas (similar a la de tablas): cuando se detecta un `- `, abrir `<ul>` si no está abierto; cuando se detecta una línea que no es lista, cerrar `</ul>` antes de procesarla. Al final del loop, cerrar cualquier `<ul>` pendiente.

### 4. Fix import de `next-themes` en Sonner (MEDIO)

**Archivo:** `src/components/ui/sonner.tsx:1`

**Problema:** Importa `useTheme` de `next-themes`, pero la app usa un `ThemeProvider` personalizado. `next-themes` está diseñado para Next.js y no funciona en Vite+React SPA.

**Solución:** Cambiar el import a `@/contexts/ThemeProvider` y adaptar el valor del tema (devuelve `"light" | "dark"` directamente).

### 5. Protección contra extensiones del navegador (DEFENSIVO)

**Archivo:** `index.html`

**Problema:** Extensiones como Google Translate inyectan/modifican nodos en el DOM que React no conoce. Cuando React intenta desmontar un componente, `removeChild` falla porque el nodo fue movido o envuelto por la extensión.

**Solución:** Agregar un script inline defensivo antes del bundle de React que parchee `Node.prototype.removeChild` e `insertBefore` para verificar que el nodo es realmente hijo antes de operar. Si no lo es, retorna gracefully en vez de lanzar excepción.

---

## Verificación

1. `npm run build` — confirmar que compila sin errores
2. `npm run lint` — confirmar que no hay errores de lint
3. `npm run test` — confirmar que los tests pasan
4. Desplegar a producción y verificar en los 3 dispositivos donde ocurría el error
5. Verificar con Google Translate activo que el error ya no aparece
