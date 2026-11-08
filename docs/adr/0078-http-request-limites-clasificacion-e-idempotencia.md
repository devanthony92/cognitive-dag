---
status: accepted
date: 2026-11-07
decision-makers: autor
---

# http.request con límites de respuesta, clasificación e Idempotency-Key

## Contexto y problema

`http.request` escribe en servicios externos y lee respuestas que no son de confianza. Una respuesta
sin límite puede agotar la memoria del worker. Un reintento tras un fallo ambiguo puede repetir un
efecto, como un cobro o un alta. Hay que decidir qué se acepta, cómo se clasifica cada respuesta y
cómo se evita la repetición.

## Opciones consideradas

- Leer la respuesta completa sin límite, y decidir después.
- Límite duro de 1 MiB leído en flujo, con tipos de contenido acotados (elegida, decisión 11A).
- Guardar la respuesta en PostgreSQL para reanudarla.
- Idempotencia: `Idempotency-Key` con `runId:nodeId` en cada método con efecto (elegida, 12A) frente
  a no enviar ninguna clave.

## Decisión

- **Tamaño**: una respuesta 2xx se lee en flujo y se corta al pasar 1 MiB (1 048 576 bytes). No se
  confía en `Content-Length`. El fallo es `HTTP_RESPONSE_TOO_LARGE`, permanente.
- **Tipo**: solo `application/json`, `application/*+json` y `text/*`, decodificados como UTF-8. Otro
  tipo en una 2xx es `HTTP_CONTENT_TYPE_UNSUPPORTED`, permanente. La salida es `{ status, body }`,
  con `body` como texto.
- **Clasificación** (ADR-0055): 2xx es éxito. 5xx, error de red y timeout son transitorios y se
  reintentan con backoff exponencial y jitter. 429 espera `Retry-After` (segundos o fecha HTTP) y no
  gasta intentos. El resto de 4xx, incluido 408, es permanente. Un 3xx sin `Location` válido es
  permanente.
- **Política por defecto**: 3 intentos, 30 s por intento y 1 s inicial, dentro de los límites de F4
  (ADR-0056).
- **Cabeceras**: `User-Agent: CognitiveDAG/1` fijo. Las cabeceras gestionadas por el sistema
  (`Idempotency-Key`, la de la credencial y `Host`) no se pueden definir en el nodo.
- **Idempotencia**: `Idempotency-Key: <runId>:<nodeId>` en `POST`, `PUT`, `PATCH` y `DELETE`, igual
  en todos los reintentos. El efecto se registra en `node_effects` (begin y commit de F4, ADR-0058).
  La respuesta no se guarda en `node_effects`.
- **Errores del paso**: sin URL ni cuerpo, solo código y clase.

Desviación: para un estado no 2xx, el cliente no falla por tamaño ni por tipo. Trunca el cuerpo y lo
devuelve, para que un 5xx transitorio no se convierta en permanente (PR #56). La regla estricta de
R11 aplica solo a 2xx.

Desviación: `HTTP_STEP_ERROR_CODES` añade `HTTP_SERVER_ERROR`, `HTTP_RATE_LIMITED`,
`HTTP_CLIENT_ERROR`, `HTTP_CIRCUIT_UNAVAILABLE` y `CREDENTIALS_NOT_CONFIGURED` (PR #57).

## Consecuencias

- Bueno: los límites y la clasificación son verificables y no dependen del destino.
- Bueno: con destinos que respetan `Idempotency-Key`, un reintento no repite el efecto.
- Malo: un destino que ignora la clave puede repetir el efecto tras un fallo ambiguo. Es un riesgo
  aceptado y ya anotado en el modelo de amenazas de F4.
- Malo: una respuesta 2xx de más de 1 MiB falla, aunque sea legítima.
- Malo: no hay análisis de JSON. El siguiente nodo debe extraer lo que necesite (fuera de F7).
- Malo: el `body` vive solo en Temporal, así que el historial de la ejecución depende de su
  retención.

## Confirmación

`packages/connectors/test/http-client.test.ts`, `apps/worker/test/http/http-activity.test.ts`,
`packages/dag-schema/test/catalog/http-request-credential.test.ts` y
`apps/worker/test/no-content.test.ts`.

## Enlaces

- [Research F7](../../specs/008-triggers-human-control/research.md) (R11 y R12).
- [ADR-0050](0050-contenido-de-entradas-y-salidas-solo-en-temporal.md),
  [ADR-0055](0055-taxonomia-de-errores-y-clasificacion-por-nodo.md),
  [ADR-0056](0056-politicas-de-reintento-por-tipo-de-nodo.md),
  [ADR-0058](0058-efectos-idempotentes-con-clave-runid-nodeid.md),
  [ADR-0077](0077-credenciales-con-cifrado-de-sobre.md),
  [ADR-0079](0079-circuit-breaker-por-organizacion-y-host.md).
