# MK Prompt Editor

Editor de Markdown de doble panel para trabajar System Prompts avanzados con seguimiento visual entre código y vista enriquecida.

## Características principales

- Panel izquierdo: edición Markdown con CodeMirror.
- Panel derecho: vista enriquecida HTML renderizada con unified + remark + rehype.
- Sincronización bidireccional:
  - Cursor en Markdown resalta bloque equivalente en preview.
  - Click en preview posiciona cursor en la línea correspondiente del Markdown.
- Indicadores visuales:
  - Línea activa resaltada.
  - Bloque activo resaltado.
  - Flechas de orientación entre paneles.
- Persistencia:
  - Autosave local en navegador.
  - Importar y exportar archivos .md.

## Requisitos

- Node.js 20+
- npm 10+

## Ejecutar en local

### Opción rápida con batch

1. Ejecuta `start-local.bat`
2. Abre la URL mostrada por Vite (normalmente http://localhost:5173)
3. Para detener el servidor, ejecuta `stop-local.bat`

### Opción manual

```bash
npm install
npm run dev
```

## Build de producción

```bash
npm run build
npm run preview
```

## Estructura

- `src/App.tsx`: lógica del editor, sincronización y mapeo Markdown↔Preview.
- `src/styles.css`: UI premium tipo dashboard.
- `start-local.bat` y `stop-local.bat`: utilidades Windows para pruebas locales.

## Flujo para GitHub + Qualify

1. Publicar este repositorio como público en GitHub.
2. Desde Qualify, importar el repositorio por URL pública.
3. Ejecutar instalación y arranque con scripts estándar (`npm install`, `npm run dev`) o usar build (`npm run build`).
