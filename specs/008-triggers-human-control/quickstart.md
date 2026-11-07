# Quickstart: validar F7

```bash
docker compose up -d --wait && pnpm db:migrate && pnpm dev
```

`.env` con `triggers-enabled` encendido, `HTTP_TEST_ALLOW_LOOPBACK` solo para los escenarios 14–16 que
apuntan a un servidor de pruebas local, y `CREDENTIALS_MASTER_KEY` generada con
`pnpm credentials:gen-key` (nunca se commitea). Mailpit en `http://localhost:8025`. Dos usuarios en la
organización: A (owner) y B (editor); C (viewer). Los escenarios se prueban con `curl` y con la UI.

| # | Historia | Pasos | Resultado esperado |
|---|---|---|---|
| 1 | US1 | A publica y activa un workflow con `trigger.webhook`; "Generar token" y copia la URL | La URL con token se muestra una sola vez; al recargar solo hay URL base y fecha |
| 2 | US1 | `curl -X POST <url> -H 'X-Event-Id: e1' -H "X-Event-Timestamp: $(date -u +%FT%TZ)" -H 'Content-Type: application/json' -d '{...}'` | `202` con `runId`; la ejecución aparece con origen "Webhook" y se ve en vivo |
| 3 | US2 | Repetir el mismo `curl` con `X-Event-Id: e1` | `200` con el mismo `runId` y `duplicate: true`; sin ejecución nueva |
| 4 | US2 | Alterar un carácter del token; usar un `triggerId` inexistente | Ambos `401 WEBHOOK_TOKEN_INVALID`, con la misma respuesta |
| 5 | US2 | A regenera el token; llamar con el token anterior y con el nuevo | El anterior `401`; el nuevo `202` |
| 6 | US2 | Marca de tiempo 10 minutos atrás; sin `X-Event-Id` | `400 WEBHOOK_TIMESTAMP_INVALID`; `400 WEBHOOK_EVENT_ID_INVALID` |
| 7 | US2 | 61 llamadas en un minuto al mismo trigger | La 61 da `429 WEBHOOK_RATE_LIMITED` con `Retry-After` |
| 8 | US2 | Revisar los logs de api y worker tras los escenarios 2–7 | El token no aparece; la ruta sale como `/api/v1/hooks/<id>/[REDACTED]` |
| 9 | US1 | Cuerpo que no cumple `bodySchema`; cuerpo de 70 KiB; sin `Content-Type` JSON | `422` con errores; `413`; `415`; sin ejecución |
| 10 | US3 | Workflow con `trigger.schedule` `* * * * *`; activar la versión | Existe el Schedule `sched-<id>` (Temporal UI); ejecuciones con origen "Programación" cada minuto |
| 11 | US3 | Con una ejecución lenta en curso, esperar el siguiente minuto; desactivar la versión | El disparo se salta y se registra; al desactivar el Schedule desaparece |
| 12 | US3 | Parar el worker 2 minutos y volver a arrancarlo; luego pararlo 2 horas (tiempo simulado en la prueba) | Con 2 min: una ejecución de catch-up; con 2 h: se descartan los de fuera de la ventana de 1 h y se cuentan |
| 13 | US3 | Activar con la zona `Mars/Olympus`; activar una 11.ª programación | La publicación se bloquea con el error de zona; `SCHEDULE_LIMIT_REACHED` |
| 14 | US5 | Nodo `http.request` hacia un servidor local de pruebas con éxito, 429 + `Retry-After`, 503, 404 y respuesta de 2 MB | `{status, body}`; espera lo indicado; reintenta y falla transitorio; falla permanente; `HTTP_RESPONSE_TOO_LARGE` |
| 15 | US5 | Un `POST` que falla una vez y reintenta | Ambas peticiones llevan el mismo `Idempotency-Key: <runId>:<nodeId>` |
| 16 | US8/US5 | A crea una credencial `bearer`; B intenta crear, rotar y archivar; el nodo la usa por `credentialId` | A: `201` sin secreto; B: `403`; el destino recibe `Authorization: Bearer ...`; el secreto no está en la definición, la ejecución ni los logs |
| 17 | US8 | Inspeccionar la tabla `credentials` con `psql` | Solo `bytea` cifrados; ninguna cadena legible del secreto |
| 18 | US6 | Nodos hacia `https://127.0.0.1`, `https://10.0.0.5`, `https://169.254.169.254`, `https://[::1]`, `https://[::ffff:7f00:1]`, `https://2130706433`, un host que resuelve a `127.0.0.1` | Todos `SSRF_BLOCKED_ADDRESS` sin abrir conexión (sin `HTTP_TEST_ALLOW_LOOPBACK`) |
| 19 | US6 | DNS de pruebas que responde IP pública y luego `10.0.0.5`; redirección a `169.254.169.254`; cuatro redirecciones; redirección a `http` | Se conecta solo a la IP validada; `SSRF_BLOCKED_ADDRESS`; `HTTP_TOO_MANY_REDIRECTS`; `HTTP_REDIRECT_NOT_ALLOWED` |
| 20 | US9 | A agrega `api.example.com` y `*.partner.com`; el nodo llama a `x.partner.com`, a `partner.com` y a `other.com`; B intenta agregar | Permitido; `HTTP_HOST_NOT_ALLOWED` los otros dos; `403` para B |
| 21 | US7 | Servidor de pruebas que devuelve 503 ocho veces seguidas | Tras 5 fallos en 60 s el circuito se abre y las siguientes no llegan al destino; a los 30 s pasa una de prueba; con 120 s abierto el nodo falla `HTTP_CIRCUIT_OPEN`; otra organización no se afecta |
| 22 | US4 | Workflow con `human.approval` iniciado por A | El paso queda "Esperando aprobación"; el contador de B sube a 1 y el de A no; llega un correo a B en Mailpit sin el texto del mensaje |
| 23 | US4 | B aprueba con comentario; repetir con rechazo; repetir con plazo de 60 s sin decidir | Sigue por `approved`; por `rejected` sin fallar la ejecución; por `timeout`; el comentario solo se ve en el detalle (Temporal) |
| 24 | US4 | A (quien inició) intenta decidir; C (viewer) intenta decidir y abrir la bandeja; B decide una ya resuelta | `403 APPROVAL_SELF_DECISION_FORBIDDEN`; `403`; `409 APPROVAL_ALREADY_RESOLVED` |
| 25 | US4 | Ejecución de webhook con aprobación; A decide | Permitido (no hay iniciador) |
| 26 | US4 | Cancelar una ejecución que espera; llenar el límite con 5 ejecuciones esperando | La solicitud queda `cancelled` y sale de la bandeja; una sexta ejecución arranca (las que esperan no cuentan) |
| 27 | US4/SC-004 | Pausar la aprobación y matar el worker; reiniciarlo; decidir | La ejecución continúa (prueba de caos `chaos.yml`) |
| 28 | US10 | `triggers-enabled=false`; llamar al webhook y a los endpoints nuevos; abrir la UI | `404 FEATURE_NOT_AVAILABLE`; sin nodos F7 ni bandeja; una versión con nodos F7 falla `UNSUPPORTED_NODES` |
| 29 | US10 | Miembro de otra organización pide una aprobación y una credencial por id | `404` |
| 30 | US10 | `triggers-enabled` y `nl-compiler-enabled` encendidos; compilar "cada día a las 9 llama a una API" | El DAG no contiene nodos de F7 (el compilador no los ofrece) |
| 31 | SC-003/007 | Buscar token, secreto, mensaje y comentario en logs y en todas las tablas | Ninguna coincidencia |
