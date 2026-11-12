---
status: accepted
date: 2026-11-12
decision-makers: autor
---

# Rediseño del frontend sin feature flag: entrega por incrementos coherentes y desplegables

## Contexto y problema

El principio VIII de la constitución pide que lo nuevo llegue tras un flag. F10 rehace la capa visual de `apps/web` y se despliega solo a producción con cada merge a `main`, sin _staging_. Un flag obligaría a mantener dos hojas de estilo, dos shells y dos juegos de pruebas durante cinco PR, para un cambio que no toca datos, contratos ni permisos.

## Opciones consideradas

- Flag de presentación (`VITE_NEW_UI` o similar): duplica estilos y pruebas dos veces; el flag acabaría eliminado como en [ADR-0084](0084-eliminacion-de-los-flags-de-producto.md).
- Rama larga con un merge final: un solo salto grande sin red de seguridad y sin comprobar la CSP real hasta el final.
- **Cinco PR pequeñas, cada una completa y coherente en claro y oscuro (elegida).**

## Decisión

No hay flag. El principio VIII se lee aquí como protección frente a **cambios de comportamiento** con riesgo para los datos o los usuarios; el rediseño es presentación y no cambia API, esquema, autorización ni despliegue. Para acotar el riesgo:

- Cada PR deja **toda** la aplicación usable: la PR 1 mantiene los componentes antiguos funcionando con alias de tokens (`--background` → `--ground`…) hasta que cada pantalla migra.
- Cada PR se prueba en claro y oscuro a 375, 768, 1024 y 1440 px, sin scroll horizontal, y adjunta capturas.
- Tras cada merge se comprueba en producción: consola sin violaciones de CSP, red solo al propio origen, `check-headers.sh` en verde; la reversa automática de F9 ([ADR-0094](0094-despliegue-automatico-reversa-y-sin-backups.md)) es la última defensa.
- Las pruebas existentes de `apps/web/test/` no se debilitan; si un selector cambia por el nuevo shell, se conserva la intención y se explica en la PR.
- Esto se registra como interpretación, no como enmienda de la constitución.

## Consecuencias

- Bueno: un solo camino de código, sin estilos ni pruebas duplicados.
- Bueno: cada incremento se puede revertir con el mecanismo de F9.
- Malo: una regresión visual llega a producción sin interruptor para apagarla; la mitigan las capturas, la revisión del autor y la reversa automática.

## Confirmación

La descripción de cada PR lista los principios aplicables y las comprobaciones anteriores; ADR-0103 (PR 5) cierra F10 con los resultados.

## Enlaces

[Constitución](../../.specify/memory/constitution.md), [plan de F10](../../specs/011-frontend-redesign/plan.md) (Complexity Tracking), [ADR-0101](0101-sistema-visual-linea-nocturna.md).
