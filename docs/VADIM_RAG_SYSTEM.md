# Vadim - Sistema RAG (Retrieval Augmented Generation)

Vadim es el asistente inteligente de Herramienta Lasarte con capacidades avanzadas de debugging, memoria persistente y aprendizaje continuo.

## Características

### 1. **Experto Técnico Completo**
- Conocimiento profundo de la arquitectura del proyecto
- Stack: React 18 + TypeScript + Vite + Supabase
- Capacidad de analizar y debuggear código en tiempo real

### 2. **Sistema RAG (Retrieval Augmented Generation)**
- Búsqueda semántica en todo el código fuente del proyecto
- Recuperación de conversaciones anteriores relevantes
- Base de conocimiento aprendido con feedback del usuario

### 3. **Memoria Persistente**
- Guarda todas las conversaciones en Supabase
- Genera embeddings para búsqueda semántica
- Aprende de correcciones y feedback

### 4. **Capacidades de Debugging**
- Diagnóstico sistemático de errores
- Soluciones concretas con código corregido
- Explicación de causas raíz
- Prevención de errores futuros

## Arquitectura del Sistema

### Tablas en Supabase

```sql
-- Embeddings del código fuente
code_embeddings (
  id, file_path, content, embedding VECTOR(1536), metadata
)

-- Conversaciones del chatbot
chat_conversations (
  id, user_id, role, content, embedding VECTOR(1536), metadata
)

-- Conocimiento aprendido (feedback, correcciones)
chat_knowledge (
  id, user_id, question, answer, embedding VECTOR(1536), feedback_score
)
```

### Flujo de Datos

```
Usuario pregunta
    ↓
Generar embedding de la pregunta
    ↓
Búsqueda RAG en paralelo:
  - Código relevante (code_embeddings)
  - Conversaciones anteriores (chat_conversations)
  - Conocimiento aprendido (chat_knowledge)
    ↓
Construir system prompt con contexto RAG
    ↓
Llamar a OpenCode API (Ring 2.6)
    ↓
Guardar conversación en BD
    ↓
Responder al usuario
```

## Instalación y Configuración

### 1. Ejecutar la Migración de Supabase

```bash
# La migración se ejecutará automáticamente al hacer deploy
# O manualmente con Supabase CLI:
supabase db push
```

Esto creará:
- Tablas: `code_embeddings`, `chat_conversations`, `chat_knowledge`
- Funciones: `search_code`, `search_conversations`, `search_knowledge`
- Índices vectoriales para búsqueda eficiente
- Políticas RLS (Row Level Security)

### 2. Indexar el Código Fuente

```bash
# Desde la raíz del proyecto
npx tsx supabase/scripts/index-code.ts
```

Este script:
- Lee todos los archivos `.ts`, `.tsx`, `.js`, `.jsx` de `src/`
- Lee archivos `.ts` y `.sql` de `supabase/`
- Divide archivos grandes en chunks de 1000 líneas
- Genera embeddings usando OpenCode API
- Almacena todo en `code_embeddings`

**Tiempo estimado:** 5-10 minutos dependiendo del tamaño del proyecto

### 3. Verificar que Funciona

Abre el chatbot en la app y pregunta:
- "¿Cómo funciona el cálculo de DSJ?"
- "¿Dónde está implementado el visor de Excel?"
- "Explícame el error removeChild que teníamos"

Vadim debería responder con contexto específico del código del proyecto.

## Uso del Sistema

### Para Usuarios Finales

Vadim está disponible en el panel lateral derecho de la app. Puedes:

1. **Hacer preguntas sobre la herramienta:**
   - "¿Cómo calculo el DJPMN?"
   - "¿Qué significa el semáforo verde?"
   - "¿Cómo exporto los partes a Excel?"

2. **Reportar errores:**
   - "El visor de Excel muestra caracteres raros"
   - "No se copia el inventario del día anterior"
   - "Me sale un error removeChild al navegar"

3. **Pedir ayuda técnica:**
   - "¿Cómo funciona la función repairXlsx?"
   - "Explícame el flujo de datos de los partes"
   - "¿Qué hace el edge function analizar-parte?"

### Para Desarrolladores

#### Actualizar el Índice de Código

Después de hacer cambios significativos en el código:

```bash
npx tsx supabase/scripts/index-code.ts
```

#### Agregar Conocimiento Manual

Puedes agregar conocimiento específico a la base de datos:

```typescript
import { saveKnowledge } from '@/lib/rag';

await saveKnowledge(
  userId,
  "¿Cómo se calcula el DSJ?",
  "El DSJ se calcula así: Diferencia bruta - Mermas totales...",
  5 // feedback score (1-5)
);
```

#### Buscar en el Sistema RAG

```typescript
import { searchCode, searchConversations } from '@/lib/rag';

// Buscar código relevante
const codeResults = await searchCode("función repairXlsx", 0.5, 10);

// Buscar conversaciones anteriores
const conversations = await searchConversations("error removeChild", userId, 0.7, 5);
```

## Errores Comunes y Soluciones

### Error: "No se encontraron resultados en búsqueda RAG"

**Causa:** El índice de código está vacío o desactualizado.

**Solución:**
```bash
npx tsx supabase/scripts/index-code.ts
```

### Error: "Error generando embedding"

**Causa:** Problema con la API de OpenCode o rate limiting.

**Solución:**
- Verificar que la API key esté correcta en `rag.ts`
- Esperar unos minutos y reintentar
- El script tiene rate limiting automático (100ms cada 10 requests)

### Error: "Política RLS denegó el acceso"

**Causa:** El usuario no está autenticado o no tiene permisos.

**Solución:**
- Verificar que el usuario esté logueado
- Las políticas RLS permiten:
  - `code_embeddings`: SELECT para todos los autenticados
  - `chat_conversations`: Solo el propietario puede leer/escribir
  - `chat_knowledge`: SELECT para todos, INSERT/UPDATE solo propietario

## Mantenimiento

### Limpiar Conversaciones Antiguas

```sql
-- Eliminar conversaciones de más de 90 días
DELETE FROM chat_conversations
WHERE created_at < NOW() - INTERVAL '90 days';
```

### Re-indexar Código

Si haces cambios grandes en la arquitectura:

```bash
# Limpiar índice antiguo
supabase db execute "DELETE FROM code_embeddings;"

# Re-indexar
npx tsx supabase/scripts/index-code.ts
```

### Monitorear Uso

```sql
-- Ver conversaciones más recientes
SELECT role, content, created_at
FROM chat_conversations
ORDER BY created_at DESC
LIMIT 20;

-- Ver conocimiento con mejor feedback
SELECT question, answer, feedback_score
FROM chat_knowledge
WHERE feedback_score >= 4
ORDER BY created_at DESC;
```

## Roadmap Futuro

- [ ] **Feedback en UI:** Botones de 👍/👎 en respuestas de Vadim
- [ ] **Auto-aprendizaje:** Detectar correcciones automáticas del usuario
- [ ] **Multi-idioma:** Soporte para preguntas en inglés/español
- [ ] **Análisis de logs:** Integrar con Sentry o similar para debugging automático
- [ ] **Sugerencias proactivas:** Vadim sugiere mejoras basadas en patrones de uso

## Recursos

- **Documentación de Supabase Vector:** https://supabase.com/docs/guides/ai
- **OpenCode API:** https://opencode.ai/docs
- **Embeddings:** Modelo `text-embedding-3-small` (1536 dimensiones)
- **Chat Model:** `ring-2.6-1t-free` (streaming support)

## Soporte

Si encuentras problemas con Vadim:

1. Verifica que la migración se ejecutó correctamente
2. Ejecuta el script de indexación de código
3. Revisa los logs del navegador (F12 → Console)
4. Pregunta al mismo Vadim: "¿Cómo funciona tu sistema RAG?"

---

**Última actualización:** 2026-05-29  
**Versión:** 1.0.0  
**Autor:** Lasarte SAT
