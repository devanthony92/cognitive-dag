---
status: accepted
date: 2026-11-09
decision-makers: autor
---

# OCIR como registro de imágenes, publicación desde `main` y referencia por digest

## Contexto y problema

F9 despliega cuatro imágenes propias (`api`, `worker`, `edge` y `migrator`) en una VM ARM de Oracle. Hace falta un registro, una forma de publicar sin dar a la integración continua más permisos de los necesarios y una referencia inmutable que el despliegue pueda fijar y revertir. La recomendación inicial era GHCR; el autor eligió OCIR (D1B) y aceptó que CI guarde un token de Oracle de larga vida y que registro, VM, secretos y correo dependan de la misma cuenta.

## Opciones consideradas

- GHCR: sin secreto extra, pero la VM necesita un token de lectura y el autor prefirió Oracle.
- OCIR: mismo proveedor que la VM (elegida).
- Construir en la VM: gasta las 2 OCPU y no deja digest verificable.

## Decisión

- **Registro:** OCIR, región Bogotá. El registro y el espacio de nombres se leen de las variables `OCIR_REGISTRY` y `OCIR_NAMESPACE` del entorno `production` de GitHub; el flujo de trabajo no escribe esos valores. Las credenciales son los secretos `OCIR_USERNAME` y `OCIR_TOKEN` del mismo entorno.
- **Repositorios privados**, creados a mano por el autor (OCIR no los crea al publicar). Cuatro, bajo `<registro>/<espacio de nombres>/`:
  - `cognitive-dag/api`
  - `cognitive-dag/worker`
  - `cognitive-dag/edge`
  - `cognitive-dag/migrator`
- **Cuándo:** `release.yml` corre solo en push a `main` (D3C, sin staging). Un pull request nunca publica ni ve los secretos; `ci.yml` conserva `contents: read` y sus 6 checks.
- **Cómo:** el trabajo `build` compila cada imagen por arquitectura en su ejecutor nativo (`ubuntu-24.04` para amd64, `ubuntu-24.04-arm` para arm64, sin QEMU) y la guarda como diseño OCI en un artefacto, sin secretos. El trabajo `publish`, con `environment: production`, es el único que ve las credenciales: escanea, genera el SBOM (ADR-0096), sube cada arquitectura y crea el manifiesto combinado con `crane index append`.
- **Etiqueta y digest:** el manifiesto combinado lleva como etiqueta el SHA completo del commit; cada arquitectura, `<sha>-amd64` y `<sha>-arm64`. Lo que se despliega y se revierte es siempre `repositorio@sha256:…` (el digest del manifiesto combinado), que queda en el artefacto `published-<imagen>` y en el resumen de la ejecución. No se usa `latest`.
- **Mínimos permisos:** `permissions: {}` en el flujo y `contents: read` por trabajo; todas las acciones fijadas por SHA; las herramientas (Grype, Syft, crane, ORAS) como imágenes fijadas por digest.

## Consecuencias

- Bueno: un solo proveedor y tráfico interno con la VM; el digest es inmutable y la reversa es volver a uno anterior; los secretos del registro solo existen en un trabajo.
- Malo: token de larga vida en GitHub; si Oracle reclama la cuenta se pierden VM y registro a la vez (riesgo aceptado por el autor); la primera publicación fallará hasta que existan los cuatro repositorios.
- Malo: `release.yml` no se puede probar en un pull request; se valida con `actionlint`, con la prueba `workflows-permissions` y con la primera ejecución en `main`.

## Confirmación

`scripts/test/unit/workflows-permissions.test.ts` falla si `release.yml` corre fuera de `main`, si los secretos aparecen fuera del trabajo de publicación o sin `environment: production`, si una acción no está fijada por SHA, si se escribe el registro como literal o si `ci.yml` pierde `contents: read` o alguno de sus 6 checks.

## Enlaces

- Decisiones D1B y D3C en `specs/010-deployment/research.md`; ADR-0090 y ADR-0096.
