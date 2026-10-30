---
status: accepted
date: 2026-10-29
decision-makers: autor
---

# TanStack Router para la web

## Contexto y problema

La web pasa de una pantalla a varias rutas protegidas por sesión y por organización.

## Opciones consideradas

- TanStack Router 1.170 con plugin de Vite y rutas por archivo.
- React Router: tipado de rutas y parámetros más débil.

## Decisión

TanStack Router: rutas y parámetros tipados, `beforeLoad` para proteger rutas y redirigir ante 401 o ante una organización de la que ya no se es miembro.

## Consecuencias

- Bueno: Rutas tipadas de extremo a extremo.
- Bueno: Protección de rutas centralizada.
- Malo: Archivo `routeTree.gen.ts` generado que se versiona.

## Confirmación

`pnpm typecheck` y `pnpm build` de `apps/web`.

## Enlaces

- `specs/002-identity-tenancy/research.md` R13.
- [ADR-0010](0010-react-vite-react-flow-en-el-frontend.md).
