# Evidencia de controles de CI (T058)

Cada control se verificó con una PR descartable desde `ci-check/<control>`, creada sobre `main`
con una única violación evidente. Todas quedaron en estado `BLOCKED` (no fusionables) con la
protección de rama de `main`, y se cerraron sin fusionar; sus ramas fueron eliminadas.

| Control   | PR                                                              | Job que falla | Línea clave del error                                                                  |
| --------- | --------------------------------------------------------------- | ------------- | -------------------------------------------------------------------------------------- |
| `style`   | [#5](https://github.com/devanthony92/cognitive-dag/pull/5)     | `quality`     | `[warn] Code style issues found in the above file` (paso `pnpm format:check`)          |
| `types`   | [#6](https://github.com/devanthony92/cognitive-dag/pull/6)     | `quality`     | `src/ci-check-types.ts(1,14): error TS2322: Type 'string' is not assignable to type 'number'` (paso `pnpm typecheck`) |
| `test`    | [#7](https://github.com/devanthony92/cognitive-dag/pull/7)     | `quality`     | `AssertionError: expected 2 to be 3` en `fails on purpose` (paso `pnpm test`)          |
| `audit`   | [#9](https://github.com/devanthony92/cognitive-dag/pull/9)     | `security`    | `high │ Command Injection in lodash │ Vulnerable versions <4.17.21` (paso `pnpm audit --audit-level high`) |
| `secret`  | [#8](https://github.com/devanthony92/cognitive-dag/pull/8)     | `security`    | `RuleID: generic-api-key` / `leaks found: 1` en `packages/contracts/src/ci-check-secret.ts` (paso gitleaks) |

## Notas

- `style` y `types` y `test` fallan primero en `quality`. `types` además rompe `images` e
  `integration`, porque la compilación de `contracts` falla antes de construir las imágenes.
- `secret` falla también `quality` (`format:check`) porque el archivo de prueba usa comillas
  dobles; el control que corresponde al secreto es `security` (gitleaks).
- Las PR #6 y #7 muestran además `security` en rojo: gitleaks recorre el historial de todas las
  ramas remotas (`fetch-depth: 0`), de modo que veía la rama `ci-check/secret` que existía en ese
  momento. Es ruido de la prueba, no un fallo de esas PR; desaparece al borrar la rama.
- El valor del secreto de prueba era una cadena hexadecimal aleatoria de 40 caracteres, sin formato
  de ningún proveedor real.
