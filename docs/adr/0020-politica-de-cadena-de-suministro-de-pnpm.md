---
status: accepted
date: 2026-10-28
decision-makers: autor
---

# Política de cadena de suministro: versiones exactas, edad mínima de publicación y scripts denegados

## Contexto y problema

Los ataques a la cadena de suministro de npm (OWASP A03) se ejecutan sobre todo mediante scripts
de instalación y versiones recién publicadas comprometidas. El repositorio es público y la
constitución exige que ningún secreto entre en él.

## Opciones consideradas

- Rangos semver con instalación libre de scripts.
- Versiones exactas, antigüedad mínima para actualizaciones y scripts de instalación denegados por
  defecto.

## Decisión

- Versiones exactas: `save-exact=true` en `.npmrc` y `rangeStrategy: "pin"` en Renovate.
- Edad mínima: `minimumReleaseAge: "3 days"` en `.github/renovate.json`; Renovate no propone
  versiones publicadas hace menos de tres días.
- Scripts de dependencias denegados: `allowBuilds` en `pnpm-workspace.yaml` lista `@swc/core`,
  `esbuild`, `lefthook` y `protobufjs` con valor `false`; ninguna dependencia ejecuta scripts de
  instalación. Los Dockerfiles instalan con `--ignore-scripts`.
- `pnpm install --frozen-lockfile` en CI y en las imágenes.
- Imágenes base y servicios de Compose fijados por digest; acciones de GitHub fijadas por SHA.

## Consecuencias

- Bueno: una versión maliciosa recién publicada no entra sola, y ningún paquete ejecuta código al
  instalarse.
- Malo: los binarios nativos que necesitan un script de instalación deben revisarse a mano antes
  de pasar a `true`; hoy las dependencias nativas (`@swc/core`, `esbuild`) funcionan con sus
  paquetes binarios por plataforma.
- Malo: las actualizaciones de seguridad se retrasan hasta tres días salvo intervención manual.

## Enlaces

- `.npmrc`, `pnpm-workspace.yaml`, `.github/renovate.json`, `apps/*/Dockerfile`.
