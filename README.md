# Herramienta de produccion Lasarte

Aplicacion operativa para centralizar informacion de produccion, consumos, asistencia y calidad. El objetivo principal es convertir datos diarios de fabrica en indicadores utiles para seguimiento, eficiencia y calculo de forfait.

## Modulos principales

- Produccion: permite entender que entra, que se procesa y como se reparte el producto.
- Consumos: calcula consumos fisicos y coste por kg de fabrica.
- Asistencia: controla presencia, faltas y eficiencia por kg/persona.
- Calidad: registra observaciones por jornada, lote y productor/finca.

## Puesta en marcha

1. Instalar dependencias:

```bash
npm install
```

2. Crear variables de entorno locales copiando `.env.example` a `.env`.

3. Arrancar desarrollo:

```bash
npm run dev
```

## Verificacion

```bash
npm run lint
npm test
npm run build
```

## Higiene de configuracion

- `.env` no debe versionarse. Usa `.env.example` como plantilla.
- Las claves privadas como `SUPABASE_SERVICE_ROLE_KEY` solo deben vivir en entorno local seguro o secrets de Supabase/Vercel.
- Los ficheros exportados, zips de capturas y logs no deben entrar al repositorio salvo que formen parte de una prueba documentada.
