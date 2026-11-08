---
status: accepted
date: 2026-11-07
decision-makers: autor
---

# Webhook con token secreto en la URL y sin HMAC

## Contexto y problema

Un sistema externo debe poder disparar un workflow sin tener cuenta ni firmar peticiones. El plan
(§4 y A08) pedía firma HMAC con marca de tiempo anti-replay. El autor decidió (2B) un token secreto
dentro de la URL, para que los emisores simples lo usen sin implementar firma. Esa decisión cambia
el mecanismo de autenticación del webhook y debe quedar registrada con sus riesgos.

## Opciones consideradas

- Firma HMAC del cuerpo con secreto compartido y marca de tiempo (PLAN §4 y A08).
- Token secreto en una cabecera `Authorization`, sin firma.
- Token secreto en la URL, sin firma (elegida).
- Los dos modos a la vez (token y HMAC) desde el inicio.

## Decisión

Ruta `POST /api/v1/hooks/{triggerId}/{token}`. `triggerId` es un UUID público que identifica el
trigger. `token` es `cdw_` seguido de 32 bytes aleatorios en base64url (256 bits). La base guarda
solo `SHA-256(token)` en `webhook_triggers.token_hash`, con comparación en tiempo constante. Un
trigger inexistente, un token mal formado y un token regenerado responden igual: 401
`WEBHOOK_TOKEN_INVALID`. El token se muestra una sola vez, al crear o regenerar. Regenerar invalida
el anterior de inmediato, sin periodo de gracia.

Anti-replay: la cabecera `X-Event-Id` es obligatoria (1 a 128 caracteres `[A-Za-z0-9._:-]`) y
`X-Event-Timestamp` va en ISO 8601 con una ventana de ±300 s. El id de Temporal y
`workflow_runs.temporal_workflow_id` valen `hook-<workflowId>-<eventId>`. Esa columna es `UNIQUE` y
Temporal arranca con `REJECT_DUPLICATE`. Un duplicado responde `200 { runId, status, duplicate: true
}` con el `runId` original, no un error.

La API responde `202 { runId, status }` sin esperar el resultado. Ejecuta la versión activa en el
momento del disparo (ADR-0075); sin versión activa con `trigger.webhook`, responde 409
`WEBHOOK_NOT_ACTIVE`. El cuerpo es JSON de hasta 64 KiB (`WEBHOOK_MAX_BODY_BYTES`). Los límites
viven en Valkey: 60 peticiones por trigger y minuto, y 20 intentos fallidos por IP cada 100 s. Si
Valkey no responde, el endpoint falla cerrado con 503.

Desviación de PLAN: el criterio de aceptación de F7 "firma inválida" pasa a "token inválido o
regenerado rechazado" (research R2).

## Consecuencias

- Bueno: el token nunca se guarda en claro. Un volcado de la base no permite disparar workflows.
- Bueno: un emisor sencillo solo necesita hacer una petición HTTP. El HMAC puede añadirse después
  como segundo modo sin cambiar la URL.
- Malo, y menos seguro que HMAC: el token viaja en la URL. Puede quedar en logs de acceso, proxies,
  CDN, historiales de herramientas y capturas, y quien lo obtenga puede disparar el workflow.
- Malo: no hay firma del cuerpo ni prueba de integridad. Un intermediario con acceso al TLS podría
  alterar el contenido. El TLS es obligatorio en producción (F9).
- Malo: la marca de tiempo no está autenticada. Quien conozca el token puede fabricarla. La garantía
  frente a reenvíos es la deduplicación por `X-Event-Id`, no el reloj.
- Malo: no hay periodo de gracia al regenerar. El emisor deja de funcionar hasta actualizar la URL.
- Malo: si Temporal falla al arrancar, la ejecución queda `failed` y un reintento con el mismo
  `X-Event-Id` recibe `200 duplicate` con ese estado. El emisor debe usar un id nuevo (PR #58).
- Mitigación: el serializador del log de acceso (`apps/api/src/logging/redact-hook-path.ts`)
  sustituye lo que sigue al `triggerId` por `[REDACTED]`. Los eventos de seguridad registran la IP y
  la razón, nunca la URL.
- Pendiente: la prueba de redacción no captura la salida real de pino ni las trazas (PR #58).
- Pendiente para F9: Caddy debe redactar `/api/v1/hooks/*` en sus logs. Criterio de cierre: ninguna
  cadena de logs conserva el token.
- Desviación: el rate limit usa ventanas fijas de `rate-limiter-flexible` y no el token bucket de R3
  (PR #58).

## Confirmación

`apps/api/test/integration/webhook-token.e2e.test.ts`, `webhook.e2e.test.ts` y
`webhook-redaction.test.ts`. La batería de cierre (ADR-0081) prevé repetir las comprobaciones de
token, replay y ausencia del token en logs.

## Enlaces

- [Research F7](../../specs/008-triggers-human-control/research.md) (R2 y R3).
- [ADR-0038](0038-eventos-de-seguridad-en-logs.md),
  [ADR-0075](0075-ejecuciones-disparadas-por-el-sistema.md),
  [ADR-0081](0081-dataset-y-baterias-de-seguridad-de-f7.md).
