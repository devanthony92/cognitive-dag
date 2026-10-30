# Implementation Plan: Modelo DAG y editor visual (F2)

**Branch**: `003-dag-model-editor` | **Date**: 2026-10-30 | **Spec**: [spec.md](./spec.md)

## Summary

Nuevo paquete `packages/dag-schema` con el modelo completo del DAG (11 tipos de nodo), sistema de tipos
para referencias, plantillas, AST de condiciones y validación semántica compartida entre navegador y
servidor. Cuatro tablas nuevas (aprobadas por el autor) con RLS por organización y versiones
inmutables. API de workflows con bloqueo optimista, publicación y activación. Editor visual con React
Flow. Todo detrás de `dag-editor-enabled`. Decisiones en [research.md](./research.md).

## Technical Context

**Language/Version**: TypeScript 6.0.3 sobre Node.js 24.22.1 LTS

**Primary Dependencies**: las de F1 más `@xyflow/react` 12.12 y `@dagrejs/dagre` 3.1 en la web

**Storage**: PostgreSQL 18 (4 tablas nuevas, JSONB, RLS forzado); sin cambios en Valkey

**Testing**: Vitest; TDD obligatorio en `packages/dag-schema`; pruebas de RLS como `app_runtime`;
pruebas de componentes del editor

**Target Platform / Project Type**: igual que F1

**Performance Goals**: validación de 50 nodos < 100 ms en el navegador (SC-003); editor fluido con 50
nodos y 100 conexiones (SC-004)

**Constraints**: sin `eval` ni motores de plantillas; versiones sin `UPDATE`/`DELETE` para
`app_runtime`; validación idéntica en navegador y servidor

**Scale/Scope**: 1 paquete nuevo, 4 tablas, 12 endpoints, ~6 pantallas o paneles

## Constitution Check

| Principio | Cumplimiento | Estado |
|---|---|---|
| I. Seguridad | Tabla OWASP de la spec; sin secretos en definiciones; sin `eval` | PASS |
| II. Resiliencia | Transacción con bloqueo de fila al publicar; bloqueo optimista del borrador | PASS |
| III. Pruebas | TDD obligatorio en `dag-schema` y en autorización | PASS |
| IV. Contratos tipados | El esquema del DAG es Zod compartido | PASS |
| V. Errores RFC 9457 | Códigos nuevos y extensión `dagErrors[]` | PASS |
| VI. Correlation-ID | Igual que F1 | PASS |
| VII. Simplicidad | ADR por dependencia y por cada decisión del autor | PASS |
| VIII. Feature flags | `dag-editor-enabled` | PASS |
| IX. Idioma | UI y mensajes de validación en español | PASS |

## Project Structure

```text
packages/dag-schema/src/
├── definition.ts        # nodos, conexiones, schemaVersion
├── types.ts             # sistema de tipos de referencias
├── catalog/             # un archivo por tipo de nodo (config, output, handles, executableFrom)
├── references.ts        # rutas nodes.<id>.output.<campo>
├── templates.ts         # tokenizador de {{...}}
├── conditions.ts        # AST y validación de tipos
├── validate.ts          # validación semántica determinista
└── limits.ts
packages/db/src/schema/  # workflows, workflow_versions, workflow_active_versions, organization_limits
packages/db/migrations/  # 0003 tablas, 0004 RLS, triggers y privilegios
apps/api/src/workflows/  # controladores, servicio, publicación, límites
scripts/ops/set-limits.ts  # script del operador (como app_migrator)
apps/web/src/features/workflows/  # lista, editor, paleta, panel, historial
```

## Complexity Tracking

| Decisión | Motivo |
|---|---|
| Tabla puente `workflow_active_versions` | Decisión del autor: evitar la referencia circular y mantener versiones inmutables |
| Script de operador fuera de la app | Decisión del autor: ningún miembro cambia límites |
