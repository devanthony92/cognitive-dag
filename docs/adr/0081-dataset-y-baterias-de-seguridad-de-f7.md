---
status: accepted
date: 2026-11-07
decision-makers: autor
---

# Dataset y baterías de seguridad de F7 como evidencia de cierre

## Contexto y problema

F7 abre una superficie pública (el webhook), salidas a Internet (`http.request`), secretos
(credenciales) y decisiones humanas (aprobaciones). Las pruebas unitarias de cada módulo no bastan
para demostrar que los controles se cumplen en conjunto. La fase necesita una evidencia reproducible
de los criterios SC-001 a SC-007 de la especificación antes de darse por cerrada.

## Opciones consideradas

- Confiar en las pruebas unitarias y de integración de cada PR.
- Baterías de seguridad dedicadas, una por control, con un conjunto de casos compartido, y esta
  evidencia registrada en un ADR (elegida).
- Una auditoría externa. Se difiere a una fase posterior.

## Decisión

La evidencia de cierre tiene tres partes:

1. **Batería de SSRF y DNS**: `packages/connectors/test/ssrf-battery.test.ts` recorre un conjunto de
   destinos IPv4 e IPv6, DNS que cambia de respuesta, y redirecciones. Comprueba que ninguna
   conexión sale hacia una dirección no pública (SC-002).
2. **Batería de cierre de la API**: `apps/api/test/integration/f7-closure-security.test.ts`.
   Comprueba que token inválido, regenerado, desconocido, marca de tiempo fuera de ventana, falta de
   `X-Event-Id` y repetición no crean ejecuciones extra (SC-001). Siembra canarios (cuerpo del
   webhook, secreto de credencial, mensaje resuelto y comentario de una aprobación) y busca su texto,
   su hexadecimal y su base64 en todas las filas de las tablas de la organización y en las
   respuestas de la API (SC-003 y SC-007). Verifica que quien inició la ejecución no puede aprobarla.
   La definición del workflow guarda solo la plantilla del mensaje; el mensaje resuelto no se
   guarda.
3. **Pruebas de comportamiento**: la prueba de caos `triggers.chaos.test.ts` ejercita el reinicio
   del worker con ejecuciones de F7 (SC-004). Los historiales de replay `f7-*.json` cubren la
   compatibilidad de los workflows. `no-content.test.ts` verifica que los contenidos no llegan a
   logs ni a eventos. `circuit-breaker-valkey.test.ts` cubre el breaker (SC-006).

SC-005 (respuesta `202` del webhook en menos de 500 ms, p95) lo mide
`apps/api/test/integration/f7-closure-latency.test.ts` sin worker en el proceso: con el worker en el
mismo proceso la medida refleja la carga del propio arnés (p95 de 760 ms a 1 s en la máquina de
cierre), no la del endpoint.

Desviación: el tiempo de los workflows de prueba corre en tiempo real con `createLocal()`, porque el
servidor con salto de tiempo necesita Java y no arranca en este entorno. La prueba del plazo de
aprobación espera los 60 s mínimos reales (PR #57). Las pruebas TLS usan un certificado efímero en
el directorio temporal, sin material de claves en el repositorio (PR #56).

## Consecuencias

- Bueno: cada criterio de éxito tiene una prueba automática que se puede repetir.
- Bueno: la batería de SSRF es la misma para el cliente HTTP y para el guardia de direcciones.
- Malo: la medida de SC-005 es local y sin worker; no sustituye una prueba de carga en producción.
- Malo: las pruebas de tiempo real alargan la suite, y algunas pruebas de componentes web son
  sensibles a la carga (PR #58).
- Malo: no hay pruebas contra Caddy ni contra un proxy real (F9). Tampoco hay fuzzing.

## Confirmación

La revisión de cierre de F7 ejecuta las baterías en CI y registra el resultado en la PR de cierre.
Un criterio no se da por cumplido sin una prueba que lo demuestre.

## Enlaces

- [Especificación F7](../../specs/008-triggers-human-control/spec.md) (SC-001 a SC-007).
- [Research F7](../../specs/008-triggers-human-control/research.md) (R15).
- [ADR-0072](0072-webhook-con-token-en-la-url-sin-hmac.md),
  [ADR-0076](0076-anti-ssrf-y-allowlist-de-hosts.md),
  [ADR-0077](0077-credenciales-con-cifrado-de-sobre.md),
  [ADR-0079](0079-circuit-breaker-por-organizacion-y-host.md).
