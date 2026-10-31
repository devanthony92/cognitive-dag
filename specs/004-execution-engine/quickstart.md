# Quickstart: validar F3

```bash
docker compose up -d --wait && pnpm db:migrate && pnpm dev
```

| # | Historia | Pasos | Resultado esperado |
|---|---|---|---|
| 1 | US1 | Publicar un workflow: disparador manual (campo `monto` número) → condición `monto > 100` → rama sí: servicio simulado A; rama no: servicio simulado B → merge "todas" | Publicado |
| 2 | US1 | Ejecutar con `monto = 150` desde el formulario | Ejecución completada; B y su rama omitidas |
| 3 | US1 | Intentar ejecutar un workflow con un nodo `llm.classify` | Acción deshabilitada; API 409 `WORKFLOW_NOT_RUNNABLE` |
| 4 | US2 | Dos servicios simulados en paralelo con latencia de 3 s | Ambos en curso a la vez; duración total ~3 s |
| 5 | US2 | Servicio simulado con 100 % de fallos | Paso fallido tras 3 intentos; ejecución fallida; ramas en curso canceladas |
| 6 | US2 | Matar el worker durante un servicio simulado lento y reiniciarlo | La ejecución termina sin repetir pasos completados |
| 7 | US3 | Abrir el detalle de una ejecución en curso | Estados por nodo actualizándose en vivo sobre el grafo |
| 8 | US3 | Abrir la entrada y salida de un nodo | Contenido visible (desde Temporal) |
| 9 | US3 | Usuario de otra organización pide la ejecución o `/events` | 404 |
| 10 | US4 | Cancelar una ejecución lenta; reejecutar una terminada | Cancelada con nodos cancelados; nueva ejecución enlazada a la original |
| 11 | US5 | `pnpm ops:set-limits <orgId> --max-concurrent-runs 1`; iniciar dos ejecuciones lentas | La segunda 429 `RUN_LIMIT_REACHED` |
| 12 | FR-020 | `execution-enabled=false` | Endpoints 404 `FEATURE_NOT_AVAILABLE`; sin botón Ejecutar |
