---
status: accepted
date: 2026-11-12
decision-makers: autor
---

# Sistema visual «Línea Nocturna»: tokens semánticos, fuentes autoalojadas y selector de tema

## Contexto y problema

`apps/web` usa los valores por defecto de shadcn: un azul genérico, colores de Tailwind fijos en 9 archivos, sin modo oscuro propio ni forma de elegirlo, y fuentes del sistema. La auditoría de impeccable dio 10/20 (`docs/ui/audit-baseline.md`). `DESIGN.md` define el objetivo («Línea Nocturna»). Producción sirve una CSP estricta (`default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:`) con COEP `require-corp`, así que el rediseño no puede usar CDN, scripts en línea ni estilos en línea, y no se cambia la CSP.

## Opciones consideradas

- Fuentes desde Google Fonts: viola `font-src` y COEP.
- Copiar archivos WOFF2 a `public/`: binarios en el repositorio y sin actualizaciones.
- **`@fontsource-variable/*` empaquetado por Vite (elegida).**
- Aplicar el tema en `main.tsx`: parpadeo del tema equivocado.
- Script de tema en línea con hash: obliga a cambiar la CSP.
- **Script externo `public/theme-init.js` (elegida).**
- Un solo tema que siga el sistema: descartado por el autor; hay que poder elegir.

## Decisión

- **Tokens** en `apps/web/src/styles/tokens.css`: cada color es `light-dark(<día>, <noche>)` en OKLCH, por lo que sigue `prefers-color-scheme` sin JavaScript y `:root[data-theme='light'|'dark']` solo fija `color-scheme`. Tailwind 4 los expone con `@theme inline` (`bg-surface`, `text-state-failed`…); los nombres antiguos (`--background`, `--primary`…) quedan como alias hasta que cada pantalla use los nuevos. Valores no cromáticos (escala tipográfica, radios, anchos `page-narrow` 640 y `page-default` 1120, sombra flotante, curva) en `@theme static`.
- **Tema con selector** Sistema (por defecto) / Claro / Oscuro en el menú de usuario y, sin sesión, en la cabecera. La elección vive en `localStorage` (clave `cdag-theme`) dentro de `try/catch`: si el almacenamiento está bloqueado degrada a Sistema y la elección vale para la página. `public/theme-init.js` es un archivo externo bloqueante en `<head>` que pone `data-theme` antes del primer pintado.
- **Fuentes** `@fontsource-variable/atkinson-hyperlegible-next` y `…-mono`, versión exacta 5.3.0, licencia **OFL 1.1** (verificada en `package.json` de cada paquete), solo los subconjuntos `latin` y `latin-ext` que el paquete publica (suficientes para español) con `font-display: swap`. Peso medido: Next 33 996 B + 19 092 B, Mono 17 752 B + 10 740 B; **81 580 B en total** (el navegador descarga solo el subconjunto que usa). `build.assetsInlineLimit: 0` obliga a Vite a emitirlas como archivos: sin él las inlinearía como `data:` y `font-src 'self'` las bloquearía. Caras de reserva con `size-adjust` para limitar el salto de maquetación.
- **Contraste verificado** por `scripts/ui/contrast.ts` (también `ui-contrast.test.ts` en CI): ≥ 4,5:1 para texto y ≥ 3:1 para glifos, pictogramas, bordes de control y foco, en claro y oscuro. Dos tokens nuevos respecto a `DESIGN.md`: `line-strong` (borde de campos; el filete decorativo `line` no llega a 3:1) y `focus`. «Pendiente» se añade a los estados de servicio.
- **Marca** propia en SVG (anillo y cruz de registro): `Logo.tsx` y `public/favicon.svg`.
- `pnpm audit` no se agrava: el único aviso (bajo, `deepmerge` vía `nestjs-zod` en `apps/api`) ya existía; los paquetes de fuentes no tienen dependencias.

## Consecuencias

- Bueno: sin parpadeo de tema, sin tocar la CSP ni `deploy/caddy/*`; los colores viven en un solo archivo y el contraste se comprueba en cada PR.
- Bueno: dos dependencias de fuentes sin código ejecutable.
- Malo: `light-dark()` lo reescribe lightningcss con una técnica de variables para los navegadores sin soporte nativo; añade peso al CSS y obliga a escribir las reglas de `data-theme` con `color-scheme`.
- Malo: el selector duplica la preferencia del sistema en un valor de `localStorage` que hay que mantener sincronizado con `theme-init.js` (una prueba lo fija).

## Confirmación

`apps/web/test/theme.test.ts` (preferencia, degradación sin `localStorage`, script externo sin inline), `scripts/test/unit/ui-contrast.test.ts` (pares de tokens), y en cada despliegue `deploy/ops/check-headers.sh`, consola sin violaciones de CSP y fuentes `.woff2` servidas desde el propio origen (T022).

## Enlaces

[DESIGN.md](../../DESIGN.md), [spec de F10](../../specs/011-frontend-redesign/spec.md), research R1 a R3, [ADR-0102](0102-redisenio-sin-flag-por-incrementos-coherentes.md).
