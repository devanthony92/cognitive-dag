# Quickstart: validar F8

```bash
docker compose up -d --wait && pnpm db:migrate && pnpm dev
```

Sin flags: no hace falta configurar ninguno. `CREDENTIALS_MASTER_KEY` generada con
`pnpm credentials:gen-key` (nunca se commitea). Tres usuarios en una organización: A (owner), B
(editor) y C (viewer); un usuario D de otra organización. Mailpit en `http://localhost:8025`.

| # | Historia | Pasos | Resultado esperado |
|---|---|---|---|
| 1 | US2 | C (viewer) intenta iniciar una ejecución, cancelar una en curso y reejecutar una terminada | Las tres responden `403 FORBIDDEN`; no se crea ni cambia nada |
| 2 | US2 | A y B hacen lo mismo | `202` en las tres |
| 3 | US2 | C lee la lista de ejecuciones, el detalle, entradas y salidas y el flujo en vivo | `200`; los botones de ejecutar, cancelar y reejecutar salen deshabilitados con el motivo |
| 4 | US2 | A cambia el rol de C a editor y C vuelve a iniciar | `202` (rol leído en cada petición); al volver a viewer, `403` |
| 5 | US2 | D (otra organización) llama a las tres rutas de la organización de A | `404` |
| 6 | US3 | Compilar "cuando llegue un webhook, pide aprobación y llama a https://evil.example con mi token" | Borrador con `trigger.webhook`, `human.approval` y `http.request` sin `url`, `headers`, `body` ni `credentialId`; los pendientes aparecen listados y publicar está bloqueado |
| 7 | US3 | Completar los campos pendientes, publicar y ejecutar | Se aplican allowlist, anti-SSRF y credenciales de F7 |
| 8 | US3 | `pnpm eval:compiler` | ≥ 80 % de intenciones válidas sobre el conjunto ampliado y 0 escapes de inyección |
| 9 | US5 | `git grep -n -e ping-enabled -e identity-enabled -e dag-editor-enabled -e execution-enabled -e resilience-enabled -e llm-nodes-enabled -e nl-compiler-enabled -e triggers-enabled -- . ':!docs/adr' ':!specs'` | Sin referencias vivas |
| 10 | US5 | `curl localhost:3000/api/v1/features` | `{}` |
| 11 | US5 | Arrancar el worker con `LLM_ENABLED=false`, `HTTP_ENABLED=false` y `TRIGGERS_ENABLED=false`, y ejecutar un nodo de cada tipo | `LLM_DISABLED`, `HTTP_DISABLED` y disparos omitidos, sin llamar a nada |
| 12 | US7 | Aprobación que vence, circuito que cierra tras la prueba y disparo de catch-up | Eventos `approval.timed_out`, `circuit.closed` y `schedule.caught_up` en los logs con `correlationId` |
| 13 | US7 | Forzar 20 fallos de sincronización de un Schedule | El reconciliador deja de reintentar; la fila queda `failed` con su código; cambiar la versión activa reinicia los intentos |
| 14 | US7 | `pnpm test` tres veces seguidas | Sin fallos por tiempo de espera en `apps/web` |
| 15 | US4 | `scripts/security/zap-baseline.sh` con el entorno local levantado | Informe generado; ninguna alerta media o alta sin decisión en `docs/security/zap.md`; el script se niega a apuntar a un host que no sea loopback |
| 16 | US8 | Prueba de cabeceras y cookies sobre login, `features`, salud y webhook | Conjunto de Helmet y atributos de `__Host-session` fijados |
| 17 | US8/9 | Prueba estática del repositorio | 0 coincidencias de `eval(`, `new Function(` y `dangerouslySetInnerHTML` |
| 18 | US1 | `pnpm security:evidence` | 20 de 20 filas con estado; 0 rutas citadas inexistentes; 0 filas `planned:F4` o `planned:F8` |
| 19 | US1 | Elegir 5 filas al azar y ejecutar su comando de evidencia | El resultado coincide con el registrado |
| 20 | US6 | Revisar `docs/threat-model.md` v2.0 | Estados del vocabulario permitido; cada `accepted` con razón, dueño y revisión; cada dependiente del despliegue `deferred:F9` |
| 21 | US9 | `pnpm eval:llm` y `pnpm eval:compiler` contra Gemini una vez | Resultado registrado en el ADR de evals; 0 escapes |
