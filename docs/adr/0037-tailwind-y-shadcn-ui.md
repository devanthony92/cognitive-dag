---
status: accepted
date: 2026-10-29
decision-makers: autor
---

# Tailwind CSS y componentes shadcn/ui

## Contexto y problema

F1 agrega formularios, tablas, diálogos y menús; hacen falta componentes accesibles y consistentes.

## Opciones consideradas

- Tailwind CSS 4.3 (`@tailwindcss/vite`) y componentes de shadcn/ui copiados a `apps/web/src/components/ui` (sobre `radix-ui` y `lucide-react`).
- Una librería de componentes cerrada (MUI): estilos y peso difíciles de controlar.

## Decisión

Tailwind y shadcn/ui. Los componentes se copian al repositorio (se pueden revisar y ajustar). Los iconos vienen de `lucide-react`; el botón de mostrar u ocultar contraseña lo reutiliza, sin agregar otra librería.

## Consecuencias

- Bueno: Accesibilidad de Radix.
- Bueno: Código de los componentes bajo control.
- Malo: Hay que mantener los componentes copiados.

## Confirmación

`pnpm build` de `apps/web` y las pruebas de componentes.

## Enlaces

- `specs/002-identity-tenancy/research.md` R13.
