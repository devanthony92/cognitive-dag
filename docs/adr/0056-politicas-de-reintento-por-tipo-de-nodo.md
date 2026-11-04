---
status: accepted
date: 2026-11-04
decision-makers: autor
---

# Políticas de reintento por tipo de nodo

## Contexto y problema

Cada servicio tolera fallos distintos: un servicio lento necesita más tiempo por intento y uno inestable necesita más intentos. Hace falta un valor razonable por defecto para cada tipo de nodo y una forma acotada de ajustarlo en un nodo concreto, sin que la configuración pueda dejar un nodo sin reintentos o con esperas de horas.

## Opciones consideradas

- Una política única para todo el motor.
- Políticas por tipo de nodo, sin ajustes por nodo.
- Políticas por tipo de nodo con ajustes por nodo dentro de límites fijos, guardados en la definición del DAG.
- Ajustes libres por nodo, sin límites.

## Decisión

Cada tipo de nodo con efecto declara sus valores por defecto en el catálogo: intentos máximos, tiempo máximo por intento y espera inicial. Para `mock.service` son 3 intentos, 30 s y 1 s. Un nodo puede sobrescribirlos con un campo opcional `retry` en su definición:

- `maxAttempts`: 1 a 10.
- `timeoutSeconds`: 1 a 120.
- `initialIntervalMs`: 100 a 30 000.

El ajuste vive en el JSON de la versión, así que no requiere tablas nuevas y la versión publicada conserva lo que se ejecutó. `validate.ts` rechaza valores fuera de rango con un mensaje en español en el campo, y los nodos de lógica y los disparadores no admiten `retry`. Antes de publicar, el editor muestra los valores por defecto como marcador.

El workflow crea un `proxyActivities` por política efectiva. El tiempo total máximo (`scheduleToCloseTimeout`) es `maxAttempts × timeoutSeconds` más cinco minutos de margen para las esperas por límite de tasa ([ADR-0057](0057-rate-limit-con-token-bucket-sin-ocupar-el-worker.md)).

## Consecuencias

- Bueno: los valores por defecto cubren el caso común y el ajuste fino es posible sin tocar el código del motor.
- Bueno: los límites impiden un nodo sin reintentos o con esperas desmedidas; el tiempo total queda siempre acotado.
- Malo: `proxyActivities` por política aumenta el número de activities registradas; el coste es despreciable en el número de políticas actual.
- Malo: cambiar un valor por defecto del catálogo afecta a las versiones nuevas, no a las ya publicadas; eso es lo deseado, pero debe documentarse al editar el catálogo.

## Confirmación

`packages/dag-schema/test/catalog/retry-policy.test.ts` (límites, mensajes en español y `retry` solo en nodos con efecto) y `apps/worker/test/unit/execute-dag.workflow.test.ts` (política efectiva y tiempo total, con tiempo simulado).

## Enlaces

- [Especificación F4](../../specs/005-resilience/spec.md) (US2, FR-005 a FR-007).
- `specs/005-resilience/research.md` (R2).
- [ADR-0055](0055-taxonomia-de-errores-y-clasificacion-por-nodo.md) (clases que la política interpreta).
- [ADR-0045](0045-limites-gestionados-por-el-operador.md) (límites fijados por la plataforma, no por la organización).
