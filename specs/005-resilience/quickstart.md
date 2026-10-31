# Quickstart: validar F4

```bash
docker compose up -d --wait && pnpm db:migrate && pnpm dev
```

Con `RATE_LIMIT_MOCK_SERVICE=capacity:2,refillPerSecond:1` en el `.env` del worker para el escenario 5.

| # | Historia | Pasos | Resultado esperado |
|---|---|---|---|
| 1 | US1 | Servicio simulado `failureKind=transient`, `failFirstAttempts=2` | Completado en el intento 3; esperas crecientes |
| 2 | US1 | Servicio simulado `failureKind=permanent`, `failureRate=1` | Fallido en el intento 1, clase `permanent`, sin reintentos |
| 3 | US1 | Servicio simulado `failureKind=rate_limited`, `retryAfterMs=3000`, `failFirstAttempts=1` | El intento 2 empieza ≥ 3 s después; completado |
| 4 | US2 | Ajustar un nodo a 5 intentos y espera inicial 2 s; probar 11 intentos | 11 rechazado en el campo; con 5, cinco intentos con espera inicial 2 s |
| 5 | US3 | Seis servicios simulados en paralelo con el límite 2 + 1/s | Ejecución escalonada; pasos "esperando por el límite"; todos completados |
| 6 | US3 | Otra organización ejecuta a la vez | No espera por el límite de la primera |
| 7 | US4 | Matar el worker justo después de confirmar un efecto; reiniciar | Paso completado; `node_effects` con un solo `committed`; destino simulado con un solo registro |
| 8 | US5 | Cadena de 4 servicios; el 3.º con `failureKind=permanent`, `failureRate=1`; reejecutar desde el 3.º | Nueva ejecución sobre la misma versión: pasos 1 y 2 "reutilizado" sin intentos; el 3.º se ejecuta de nuevo (y vuelve a fallar); `rerunFromNodeId` = el 3.º |
| 9 | US5 | Reejecutar desde un nodo inexistente; desde una ejecución en curso | 422 `RERUN_NODE_INVALID`; 409 `RUN_NOT_FINISHED` |
| 10 | US6 | Página "Ejecuciones" de la organización, filtro "Fallidas" y por workflow | Solo fallidas con nodo y clase; solo el workflow elegido |
| 11 | US7 | `pnpm demo:recovery` | Ejecución que sobrevive a la caída del worker, sin efectos repetidos |
| 12 | US7 | `pnpm test:chaos` | Todas las pruebas pasan (worker, Temporal, Valkey, PostgreSQL) |
| 13 | FR-023 | `resilience-enabled=false` | Sin ajustes de reintento, sin "reejecutar desde aquí", sin página de la organización; endpoints nuevos 404 |
