---
status: accepted
date: 2026-11-04
decision-makers: autor
---

# Rate limit con token bucket sin ocupar el worker

## Contexto y problema

Los nodos con efecto deben respetar un límite de peticiones por organización y tipo de nodo para proteger a los servicios externos y a las demás organizaciones. Si el límite se aplica dentro de la activity con un `sleep`, cada espera ocupa un slot del worker y bloquea a otras ejecuciones. Además, las esperas por límite no deberían gastar los intentos del nodo, porque un nodo que solo esperó turno no ha fallado.

## Opciones consideradas

- Dormir dentro de la activity hasta que haya capacidad.
- Un semáforo o cola en memoria del worker.
- Un token bucket en Valkey que, sin capacidad, reprograma la activity con `nextRetryDelay` y libera el worker.
- Un límite fijo por ventana de tiempo (contador por segundo).

## Decisión

Antes de ejecutar su efecto, la activity pide un token a un token bucket en Valkey, por la clave `rl:<organizationId>:<nodeType>`. La operación es un script Lua atómico con reposición continua y TTL para limpiar claves inactivas. La capacidad y la tasa de reposición son configuración de la plataforma, por variable de entorno del worker (`RATE_LIMIT_<NODE_TYPE>=capacity:N,refillPerSecond:M`); sin variable, no hay límite.

Si no hay token, la activity:

1. Marca el paso con `waiting_reason = 'rate_limited'` y publica el evento en vivo.
2. Lanza `rate_limited` con `nextRetryDelay` igual al tiempo hasta el siguiente token. No duerme dentro de la activity, así que el worker queda libre.

Las esperas no gastan intentos: la activity corre con `maximumAttempts` ilimitado en Temporal y lleva su propio contador de intentos en los heartbeat details, que pasan de un intento al siguiente. Solo cuentan los fallos que no son `rate_limited`. Al superar `maxAttempts`, lanza el último error como no reintentable. El tope total lo pone `scheduleToCloseTimeout`. Si Valkey no responde, el fallo es `transient` y nunca se ejecuta el efecto sin token.

## Consecuencias

- Bueno: ninguna espera ocupa el worker; otras ejecuciones y nodos siguen avanzando.
- Bueno: la persona ve en el paso que espera por el límite.
- Bueno: un límite agotado en una organización no afecta a otra, porque la clave incluye la organización.
- Malo: el contador propio de intentos es lógica que el motor no ofrece de serie; hay que probar que se conserva entre reintentos.
- Malo: Valkey pasa a estar en la ruta de los nodos con efecto; su caída se trata como transitoria y reintenta, pero añade latencia.
- Malo: el token bucket es por organización y tipo de nodo; no protege a un servicio concreto si varios nodos del mismo tipo lo usan. Eso se decide con el circuit breaker ([ADR-0060](0060-decisiones-diferidas-de-resiliencia.md)).

## Confirmación

`apps/worker/test/integration/rate-limiter.test.ts` (token bucket atómico, reposición, aislamiento por organización y tipo, Valkey caído como transitorio, esperas que no gastan `maxAttempts`, y `waiting_reason` puesto y limpiado) y la prueba de caos de Valkey pausado (`apps/worker/test/chaos/`).

## Enlaces

- [Especificación F4](../../specs/005-resilience/spec.md) (US3, FR-008 a FR-010, SC-002).
- `specs/005-resilience/research.md` (R3).
- [ADR-0055](0055-taxonomia-de-errores-y-clasificacion-por-nodo.md) (clase `rate_limited`).
- [ADR-0056](0056-politicas-de-reintento-por-tipo-de-nodo.md) (`scheduleToCloseTimeout` con margen para las esperas).
- [ADR-0033](0033-rate-limiter-flexible.md) (límites de abuso en F1, sobre Valkey).
