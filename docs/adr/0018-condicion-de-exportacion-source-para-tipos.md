---
status: accepted
date: 2026-10-28
decision-makers: autor
---

# Condición de exportación `@cognitive-dag/source` para resolver tipos desde el código fuente

## Contexto y problema

Los paquetes del workspace (`packages/contracts`, `packages/logger`) exponen `dist/` en tiempo de
ejecución. En CI, el lint con tipos corre antes de cualquier compilación, así que
`@cognitive-dag/contracts` apuntaba a un `dist/index.d.ts` inexistente y cada import se convertía
en un tipo de error.

## Opciones consideradas

- Ejecutar `build` antes del lint: alarga el CI y acopla el lint a la compilación.
- `paths` en `tsconfig`: duplica la ubicación de cada paquete y no lo ve ESLint.
- Una condición de exportación personalizada: TypeScript y ESLint resuelven a `src`, Node sigue
  cargando `dist`.

## Decisión

Cada paquete declara en su `package.json`:

```json
"exports": { ".": { "@cognitive-dag/source": "./src/index.ts", "types": "./dist/index.d.ts", "default": "./dist/index.js" } }
```

y `packages/config/tsconfig.base.json` activa `"customConditions": ["@cognitive-dag/source"]`.

## Consecuencias

- Bueno: `typecheck` y lint con tipos funcionan sin compilar antes; el runtime de Node no cambia.
- Malo: todo paquete nuevo del workspace debe declarar la misma condición, antes de la condición
  `types`.
- Malo: herramientas que no leen `customConditions` ven `dist`; las apps se ejecutan siempre tras
  `build` o con `pnpm dev`, que compila los paquetes en modo watch.

## Confirmación

El job `quality` del CI corre `pnpm lint` y `pnpm typecheck` sin compilar antes.

## Enlaces

- Commit `2f04a37` (`fix(ci): resolve workspace package types from source`).
