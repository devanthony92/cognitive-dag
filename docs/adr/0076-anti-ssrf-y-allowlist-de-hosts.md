---
status: accepted
date: 2026-11-07
decision-makers: autor
---

# Anti-SSRF con validación de IP y allowlist opcional de hosts

## Contexto y problema

`http.request` llama a destinos que definen personas en un workflow. Sin control, el worker podría
alcanzar la red interna, el servicio de metadatos de la nube o direcciones de loopback, o ser
redirigido hacia ellas. Validar solo el nombre antes de conectar no basta, porque el DNS puede
responder con otra dirección en el segundo lookup (DNS rebinding). El control debe funcionar en cada
resolución y en cada redirección (OWASP A10, LLM03 cuando el destino proviene de la entrada).

## Opciones consideradas

- Validar el nombre antes de resolverlo y confiar en el cliente HTTP por defecto.
- Un proxy de salida con allowlist obligatoria.
- Validación de cada dirección, conexión a la IP validada y allowlist opcional por organización
  (elegida, decisión 9C).
- Bloquear el nodo HTTP por completo hasta una fase posterior.

## Decisión

Módulo `packages/connectors`, puro y con TDD, con `assertPublicAddress`, `createGuardedLookup` y
`guardedRequest`:

1. La URL pasa por el parser WHATWG. Solo se acepta `https:`, sin credenciales en la URL, y una IP
   literal debe ser pública.
2. El nombre se resuelve una sola vez con `dns.lookup(host, { all: true, verbatim: true })`. Si
   alguna dirección no es pública, se rechaza todo (fail-closed).
3. La conexión abre el socket contra la IP validada, mediante un `lookup` propio de `node:https`.
   `servername` y la cabecera `Host` conservan el nombre original para verificar el certificado.
4. Clasificación con una lista cerrada. IPv4 bloquea `0/8`, `10/8`, `100.64/10`, `127/8`,
   `169.254/16` (metadatos), `172.16/12`, `192.168/16`, documentación, benchmarking, multicast y
   reservadas. IPv6 solo acepta `2000::/3`, con excepciones (Teredo, documentación, 6to4). Los IPv4
   embebidos (`::ffff:0:0/96`, `64:ff9b::/96`, `2002::/16`) se validan con las mismas reglas.
5. Redirecciones manuales, como máximo 3. Cada salto pasa otra vez por 1 a 4 y por la allowlist. Un
   salto a otro origen descarta la cabecera de la credencial y `Idempotency-Key`.
6. Sin proxy: se ignoran `HTTP_PROXY`, `HTTPS_PROXY` y `NO_PROXY`, y el agente no se comparte.
7. Allowlist opcional `http_allowed_hosts`: entradas `host` exacto o `*.dominio` (solo subdominios),
   máximo 100. Lista vacía significa que solo rigen las reglas de IP. Lista no vacía significa que
   el host de cada salto debe coincidir. La administra el owner, y owner y editor pueden leerla.
8. Errores permanentes `SSRF_BLOCKED_ADDRESS`, `HTTP_HOST_NOT_ALLOWED`, `HTTP_REDIRECT_NOT_ALLOWED`
   y `HTTP_TOO_MANY_REDIRECTS`. El mensaje no revela la IP resuelta.
9. `HTTP_TEST_ALLOW_LOOPBACK` solo permite loopback en pruebas. El worker no arranca en producción
   si la variable existe.

## Consecuencias

- Bueno: el rebinding queda cerrado porque la conexión usa la dirección ya validada. Ningún error
  sirve de oráculo sobre la red interna.
- Bueno: sin dependencias nuevas. `node:https` y `node:dns` bastan.
- Malo: destinos detrás de un proxy corporativo o con DNS dividido no funcionan.
- Malo: la lista de rangos hay que mantenerla. Lo que no es unicast global claro se bloquea, y eso
  puede dar falsos positivos.
- Malo: sin allowlist configurada, una organización puede llamar a cualquier host público. El riesgo
  queda acotado por la validación de IP, no eliminado.
- Nota: para IPv4 el código aplica una lista de bloqueo sobre todo el espacio, con las excepciones
  de R9.3. Para los rangos listados el resultado es el mismo que la lista cerrada del research.

## Confirmación

`packages/connectors/test/ssrf-battery.test.ts`, `address.test.ts`, `dns-lookup.test.ts`,
`redirect.test.ts`, `http-client.test.ts` y `allowlist.test.ts`. La prueba TLS usa un certificado
efímero generado en el directorio temporal, sin material de claves en el repositorio.

## Enlaces

- [Research F7](../../specs/008-triggers-human-control/research.md) (R9).
- [ADR-0038](0038-eventos-de-seguridad-en-logs.md),
  [ADR-0055](0055-taxonomia-de-errores-y-clasificacion-por-nodo.md),
  [ADR-0078](0078-http-request-limites-clasificacion-e-idempotencia.md),
  [ADR-0079](0079-circuit-breaker-por-organizacion-y-host.md).
