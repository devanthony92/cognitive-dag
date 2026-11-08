---
status: accepted
date: 2026-11-08
decision-makers: autor
---

# Solo owner y editor ejecutan, cancelan y reejecutan

## Contexto y problema

[ADR-0053](0053-cualquier-miembro-puede-ejecutar.md) dejó que cualquier miembro, viewer incluido,
iniciara, cancelara y reejecutara ejecuciones. Se aceptó porque en F3 ningún nodo tenía efectos
externos y se dejó para revisar en F7. Desde F7 existen `http.request` (llamadas salientes con las
credenciales de la organización), aprobaciones y disparos, así que un viewer podía provocar efectos
externos sin poder editar nada. Era una omisión de autorización en `RunsController` (A01, LLM03).

## Opciones consideradas

- Mantener ADR-0053 y aceptar el riesgo.
- Restringir solo las ejecuciones cuyo workflow contiene nodos con efectos externos.
- Solo owner y editor inician, cancelan y reejecutan (elegida, decisión 1A de F8).

## Decisión

`@RequiredRoles('owner', 'editor')` en las tres rutas de `RunsController` que inician efectos:
`POST workflows/:workflowId/runs`, `POST runs/:runId/cancel` y `POST runs/:runId/rerun` (la
reejecución desde un nodo es la misma ruta con `fromNodeId`). El viewer recibe `403 FORBIDDEN`
(`application/problem+json`) y no se inicia ni cambia nada. Las lecturas (listados, detalle, entrada
y salida ya redactadas, flujo en vivo) siguen abiertas a cualquier miembro; un no miembro o una
persona de otra organización recibe `404`, como antes. El rol se lee en cada petición, así que un
cambio de rol se aplica a la siguiente llamada. Cancelar o reejecutar una ejecución disparada por un
webhook o una programación exige el mismo rol a quien actúa.

La web deshabilita "Ejecutar", "Cancelar" y "Reejecutar" (también "desde aquí" y "desde el nodo
fallido") para el viewer y muestra el motivo («Tu rol no permite ejecutar workflows.»). La API
decide; la web solo lo explica.

Una prueba por reflexión recorre `RunsController` y falla si una ruta que cambia estado no declara
`REQUIRED_ROLES` o no está en una lista cerrada y comentada (vacía hoy). Añadir una ruta sin decidir
su rol rompe la prueba, que es la defensa contra repetir esta omisión.

Sin migración de datos: las ejecuciones antiguas iniciadas por un viewer se conservan.

## Consecuencias

- Bueno: un viewer no puede provocar llamadas salientes ni consumo de LLM.
- Bueno: la regla queda probada por ruta y rol, y por reflexión para las rutas futuras.
- Malo: quien solo observa ya no puede probar un workflow; debe pedir el rol de editor.
- Malo: el chequeo de rol de la web es solo de ayuda; si divergiera de la API, la API manda.

## Confirmación

`apps/api/test/integration/runs-roles.test.ts` (matriz rol × ruta, lecturas del viewer, cambio de rol
entre peticiones y reflexión), `apps/api/test/integration/runs-start.test.ts` y
`apps/web/test/runs-roles.test.tsx`.

## Enlaces

- Reemplaza a [ADR-0053](0053-cualquier-miembro-puede-ejecutar.md).
- [Research F8](../../specs/009-hardening/research.md) (R2).
