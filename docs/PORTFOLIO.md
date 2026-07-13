# Portafolio — ERP interno para planta citrícola

> Documento profesional que describe el proyecto, su alcance y las competencias demostradas. No contiene datos de negocio, credenciales ni información de clientes. Apto para compartir en entrevistas o evaluaciones profesionales.

## Resumen ejecutivo

Diseñé, desarrollé y desplegué en solitario un **ERP interno completo** para una empresa citrícola (planta de clasificación y confección), partiendo de cero y sin experiencia previa en programación, apoyándome en herramientas de desarrollo asistido por IA. El sistema está **en producción y en uso diario** por distintos perfiles de la empresa (dirección, comercial, RRHH y operarios).

**Cifras del proyecto:**
- ~80.000 líneas de código TypeScript/React en ~314 archivos fuente
- 34 páginas funcionales organizadas en más de 15 módulos de negocio
- 8 funciones serverless (Supabase Edge Functions, Deno)
- Base de datos Postgres con esquema migrado y seguridad a nivel de fila (RLS)
- Sistema de 4 roles con control de acceso en cliente y servidor
- Tests unitarios sobre la lógica de negocio; typecheck estricto en verde

## Qué resuelve

Antes del proyecto, la gestión se hacía con hojas de cálculo dispersas y documentos manuales. El ERP centraliza:

- **Producción**: KPIs semanales con semáforos (producción real, kg dados de alta, diferencias sin justificar, velocidad de línea)
- **Calidad**: control por jornada e importación automática de informes diarios en Word
- **Consumos y costes**: lecturas de contadores de agua con desglose por subcontadores y validación, coste de materiales
- **Comercial y ventas**: dashboards por cliente, importador mensual de ventas con reparto automático por categorías
- **Cliente principal (gran distribución)**: aprovechamiento, lotes, expediciones, previsiones y precios
- **Logística**: generación de documentos de transporte CMR en PDF
- **RRHH**: personas, ausencias, vacaciones, nóminas y comunicaciones, con acceso restringido
- **Económico**: facturación, costes y márgenes (solo dirección)

## Decisiones técnicas destacables

**Arquitectura por capas.** La lógica de negocio vive en funciones puras y testeables (`src/lib/`, ~90 archivos), separada de los hooks de datos (React Query) y de la UI. Esto permitió añadir tests unitarios a los cálculos críticos (calidad, consumos, asistencia) sin depender del backend.

**Seguridad en profundidad.** El control de acceso por rol se aplica dos veces: guardas de ruta en el cliente y políticas Row Level Security en Postgres, de forma que un usuario no puede acceder a datos fuera de su rol ni siquiera llamando a la API directamente.

**Importación de datos del mundo real.** Parsers propios para los formatos que la empresa ya usaba: Excel con estructuras irregulares, informes Word en tres formatos distintos (HTML UTF-16/UTF-8 y .docx con casillas de verificación), y facturas PDF. Cada importador incluye previsualización y validación antes de escribir en la base de datos.

**Motor de exportación con marca.** Kit unificado de exportación a Excel y PDF con la identidad corporativa, reutilizado por todos los módulos (partes, consumos, eficiencia, nóminas, CMR).

**Asistente IA integrado.** Chatbot con RAG (búsqueda semántica por embeddings sobre los datos de la planta), memoria de conversación persistente y una cascada de proveedores de IA con fallback automático para garantizar disponibilidad sin coste fijo.

**Experiencia de usuario.** Modo claro/oscuro, paleta de comandos con búsqueda global, tour de onboarding, skeletons de carga, lazy-loading de rutas con precarga y warmup de datos.

## Stack

React 18 · TypeScript · Vite · Tailwind CSS · shadcn/ui (Radix) · TanStack Query · React Hook Form + Zod · Recharts · Supabase (Postgres, Auth, Storage, Edge Functions/Deno) · ExcelJS · jsPDF / pdf-lib · Vitest · Vercel

## Contexto profesional

Este proyecto lo construí como empleado recién incorporado, sin formación previa en desarrollo de software, usando IA como herramienta de programación asistida y aprendiendo sobre la marcha: control de versiones (git con historial de commits descriptivos), migraciones de base de datos, despliegue continuo, testing y diseño de interfaces. La herramienta pasó de experimento a sistema de uso diario en la empresa, con roles diferenciados para dirección, comercial, RRHH y planta.

Lo que demuestra:
- Capacidad de **traducir procesos de negocio reales a software** (el valor no está en el código, sino en entender la operativa de la planta)
- **Autonomía y aprendizaje acelerado** con herramientas modernas de IA
- Criterio para **estructurar un proyecto grande** de forma mantenible (capas, tests, migraciones, documentación)
- **Iteración con usuarios reales**: el historial de git refleja ciclos continuos de feedback y mejora

---

*La documentación técnica completa está en [ARQUITECTURA.md](./ARQUITECTURA.md). El código fuente es propiedad de la empresa y no se distribuye; este documento describe únicamente el trabajo realizado y las capacidades técnicas.*
