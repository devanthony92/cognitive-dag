---
status: accepted
date: 2026-10-28
decision-makers: autor
---

# Override de `multer` a 2.5.0 (GHSA-q7qp-rjg7-q26m)

## Contexto y problema

`@nestjs/platform-express` 11.2.8 depende de `multer` 2.4.0, afectado por el aviso
GHSA-q7qp-rjg7-q26m. El job `security` ejecuta `pnpm audit --audit-level high` y bloquea el merge
mientras exista la vulnerabilidad. F0 no recibe cargas de archivos, pero la dependencia está
instalada.

## Opciones consideradas

- Ignorar el aviso en la auditoría: debilita el control de CI.
- Esperar a que NestJS actualice la dependencia: deja el CI bloqueado.
- Forzar `multer` 2.5.0 con un `override` de pnpm.

## Decisión

`overrides: { multer: 2.5.0 }` en `pnpm-workspace.yaml`, con un comentario que enlaza el aviso. El
override se retira cuando `@nestjs/platform-express` publique una versión con `multer >= 2.5.0`.

## Consecuencias

- Bueno: la auditoría vuelve a ser un bloqueo real, sin excepciones.
- Malo: se fuerza una versión no probada por el equipo de NestJS; el API no usa cargas de
  archivos en F0 y se retira en cuanto sea posible.
- Seguimiento: issue [Remove multer override](https://github.com/devanthony92/cognitive-dag/issues/11).

## Enlaces

- https://github.com/advisories/GHSA-q7qp-rjg7-q26m
- Issue de seguimiento: https://github.com/devanthony92/cognitive-dag/issues/11
