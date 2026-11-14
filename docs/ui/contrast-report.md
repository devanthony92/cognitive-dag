# Informe de contraste final (F10, T079 / SC-004)

Generado con `node scripts/ui/contrast.ts` (lee `apps/web/src/styles/tokens.css`, convierte cada color OKLCH a sRGB
y mide la razón de contraste WCAG 2.x de cada par declarado en modo claro y oscuro). La misma comprobación corre
en CI desde `scripts/test/unit/ui-contrast.test.ts` y falla si un par baja de su umbral.

Resultado: **82 comprobaciones, 82 correctas, 0 por debajo del umbral** (18 de texto con mínimo 4,5:1 y 64 de glifos, pictogramas, bordes de control y foco con mínimo 3:1), en claro y en oscuro. SC-004 cumplido.

El par más justo es el borde de control `line-strong` sobre `ground` en claro (3,38:1, mínimo 3) y el mismo borde sobre `surface` en claro (3,63:1).

```text
ok   light 16.17:1 (min 4.5) texto ink sobre ground
ok   dark  16.48:1 (min 4.5) texto ink sobre ground
ok   light  7.28:1 (min 4.5) texto ink-muted sobre ground
ok   dark   9.27:1 (min 4.5) texto ink-muted sobre ground
ok   light 17.37:1 (min 4.5) texto ink sobre surface
ok   dark  14.93:1 (min 4.5) texto ink sobre surface
ok   light  7.82:1 (min 4.5) texto ink-muted sobre surface
ok   dark   8.39:1 (min 4.5) texto ink-muted sobre surface
ok   light 15.30:1 (min 4.5) texto ink sobre raised
ok   dark  12.88:1 (min 4.5) texto ink sobre raised
ok   light  6.88:1 (min 4.5) texto ink-muted sobre raised
ok   dark   7.24:1 (min 4.5) texto ink-muted sobre raised
ok   light 16.61:1 (min 4.5) texto on-action sobre action
ok   dark  16.48:1 (min 4.5) texto on-action sobre action
ok   light  6.18:1 (min 4.5) texto state-failed sobre ground
ok   dark   6.62:1 (min 4.5) texto state-failed sobre ground
ok   light  6.64:1 (min 4.5) texto state-failed sobre surface
ok   dark   6.00:1 (min 4.5) texto state-failed sobre surface
ok   light  6.34:1 (min 3) glifo state-running sobre ground
ok   dark   9.83:1 (min 3) glifo state-running sobre ground
ok   light  6.81:1 (min 3) glifo state-running sobre surface
ok   dark   8.91:1 (min 3) glifo state-running sobre surface
ok   light  6.04:1 (min 3) glifo state-succeeded sobre ground
ok   dark  10.53:1 (min 3) glifo state-succeeded sobre ground
ok   light  6.49:1 (min 3) glifo state-succeeded sobre surface
ok   dark   9.53:1 (min 3) glifo state-succeeded sobre surface
ok   light  6.18:1 (min 3) glifo state-failed sobre ground
ok   dark   6.62:1 (min 3) glifo state-failed sobre ground
ok   light  6.64:1 (min 3) glifo state-failed sobre surface
ok   dark   6.00:1 (min 3) glifo state-failed sobre surface
ok   light  6.26:1 (min 3) glifo state-waiting sobre ground
ok   dark  11.60:1 (min 3) glifo state-waiting sobre ground
ok   light  6.73:1 (min 3) glifo state-waiting sobre surface
ok   dark  10.51:1 (min 3) glifo state-waiting sobre surface
ok   light  6.89:1 (min 3) glifo state-cancelled sobre ground
ok   dark   7.48:1 (min 3) glifo state-cancelled sobre ground
ok   light  7.40:1 (min 3) glifo state-cancelled sobre surface
ok   dark   6.78:1 (min 3) glifo state-cancelled sobre surface
ok   light  5.56:1 (min 3) glifo state-skipped sobre ground
ok   dark   5.10:1 (min 3) glifo state-skipped sobre ground
ok   light  5.98:1 (min 3) glifo state-skipped sobre surface
ok   dark   4.62:1 (min 3) glifo state-skipped sobre surface
ok   light  6.31:1 (min 3) glifo state-reused sobre ground
ok   dark  10.32:1 (min 3) glifo state-reused sobre ground
ok   light  6.78:1 (min 3) glifo state-reused sobre surface
ok   dark   9.34:1 (min 3) glifo state-reused sobre surface
ok   light  6.17:1 (min 3) pictograma node-trigger sobre ground
ok   dark   7.49:1 (min 3) pictograma node-trigger sobre ground
ok   light  6.63:1 (min 3) pictograma node-trigger sobre surface
ok   dark   6.78:1 (min 3) pictograma node-trigger sobre surface
ok   light  6.24:1 (min 3) pictograma node-logic sobre ground
ok   dark   8.00:1 (min 3) pictograma node-logic sobre ground
ok   light  6.71:1 (min 3) pictograma node-logic sobre surface
ok   dark   7.24:1 (min 3) pictograma node-logic sobre surface
ok   light  6.61:1 (min 3) pictograma node-llm sobre ground
ok   dark   8.22:1 (min 3) pictograma node-llm sobre ground
ok   light  7.11:1 (min 3) pictograma node-llm sobre surface
ok   dark   7.44:1 (min 3) pictograma node-llm sobre surface
ok   light  5.86:1 (min 3) pictograma node-http sobre ground
ok   dark   8.95:1 (min 3) pictograma node-http sobre ground
ok   light  6.30:1 (min 3) pictograma node-http sobre surface
ok   dark   8.11:1 (min 3) pictograma node-http sobre surface
ok   light  6.68:1 (min 3) pictograma node-approval sobre ground
ok   dark  10.83:1 (min 3) pictograma node-approval sobre ground
ok   light  7.18:1 (min 3) pictograma node-approval sobre surface
ok   dark   9.81:1 (min 3) pictograma node-approval sobre surface
ok   light  6.66:1 (min 3) pictograma node-mock sobre ground
ok   dark   7.46:1 (min 3) pictograma node-mock sobre ground
ok   light  7.16:1 (min 3) pictograma node-mock sobre surface
ok   dark   6.75:1 (min 3) pictograma node-mock sobre surface
ok   light  3.38:1 (min 3) borde de control line-strong sobre ground
ok   dark   4.68:1 (min 3) borde de control line-strong sobre ground
ok   light  3.63:1 (min 3) borde de control line-strong sobre surface
ok   dark   4.24:1 (min 3) borde de control line-strong sobre surface
ok   light 16.17:1 (min 3) anillo de foco sobre ground
ok   dark  16.48:1 (min 3) anillo de foco sobre ground
ok   light 17.37:1 (min 3) anillo de foco sobre surface
ok   dark  14.93:1 (min 3) anillo de foco sobre surface
ok   light 15.30:1 (min 3) anillo de foco sobre raised
ok   dark  12.88:1 (min 3) anillo de foco sobre raised
ok   light  5.85:1 (min 3) glifo state-failed sobre raised
ok   dark   5.18:1 (min 3) glifo state-failed sobre raised
```
