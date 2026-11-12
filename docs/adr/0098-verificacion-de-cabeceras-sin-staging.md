---
status: accepted
date: 2026-11-12
decision-makers: autor
---

# Verificación de las cabeceras de seguridad sin staging; ZAP activo queda como riesgo aceptado

## Contexto y problema

La fila «cabeceras de la web» de [ADR-0088](0088-riesgos-aceptados-y-diferidos-a-f9.md) pedía repetir el baseline de ZAP contra staging y comprobar que las alertas 10038, 10020, 10021, 10063 y 90004 desaparecían; el issue #65 pedía además ZAP activo y con sesión. El autor decidió no tener staging (D2C): cada cambio llega a producción. Sin un entorno donde atacar sin consecuencias, un análisis activo contra el sitio real sería peligroso (crea datos, dispara alertas y límites) y uno con sesión exigiría una cuenta de prueba en producción. Hace falta otra forma de comprobar que el borde envía las cabeceras, que no dependa de un entorno aparte.

## Opciones consideradas

- Crear un staging solo para ZAP: contradice D2C y ocupa la cuota Always Free (una sola VM).
- ZAP activo o con sesión contra producción: riesgo para los datos y para la disponibilidad de una demo con una sola VM.
- Dejar las cabeceras sin comprobar tras el despliegue: el siguiente cambio del Caddyfile podría quitarlas sin que nadie se entere.
- **ZAP pasivo, local y sobre loopback contra la imagen de borde real, más una comprobación con `curl` contra el dominio real en cada despliegue que revierte si falla (elegida).** El baseline activo y con sesión (#65) queda `accepted`.

## Decisión

- **Antes de publicar (ZAP):** `scripts/security/zap-baseline.sh` sigue pasivo, sin sesión y solo sobre loopback, sin ampliar sus hosts (`zap-script.test.ts` intacto). Se ejecuta contra la imagen de borde levantada en local con `deploy/caddy/local.Caddyfile`, que importa `deploy/caddy/site.caddy`, el mismo sitio que sirve producción. Las alertas 10038, 10020, 10021, 10063 y 90004 desaparecieron; la evidencia está en [zap.md](../security/zap.md).
- **Después de cada despliegue (`curl`):** `deploy/ops/check-headers.sh` pide `https://<dominio>/` y comprueba HSTS, CSP, `X-Frame-Options`, `nosniff`, `Permissions-Policy`, COEP, COOP y CORP, y que `http://` redirija a HTTPS. Lo llama `deploy/ops/deploy.sh`: si falta una cabecera, el despliegue **revierte solo** a los digests anteriores y termina con error. El contrato está en `specs/010-deployment/contracts/edge-headers.md` y lo fija `scripts/test/unit/deploy-config.test.ts` sobre el Caddyfile.
- **#65 (ZAP activo, con sesión y contra un entorno real):** `accepted`. Dueño: autor. Revisión: si se crea un entorno de pruebas (por ejemplo, otra VM al liberar cuota) o antes de abrir el registro. El issue sigue abierto con esa razón.
- La comprobación no sustituye a un análisis dinámico: no ve vulnerabilidades de la aplicación con sesión, solo que el borde conserva su contrato.

## Consecuencias

- Bueno: cada despliegue prueba el contrato de cabeceras en el dominio real, sin staging y sin tocar datos; una regresión del Caddyfile revierte sola.
- Bueno: el baseline de ZAP sigue siendo barato, local y reproducible, y no se amplía su alcance.
- Malo: no hay análisis activo ni con sesión; una vulnerabilidad de lógica detrás del login no la verá ZAP. Se mitiga con las baterías de seguridad de F7 y F8, pero es un riesgo aceptado, no cerrado.
- Malo: la comprobación se hace después de que la versión nueva ya sirve tráfico; la reversa limita la ventana, no la elimina.

## Confirmación

El 2026-11-12, `curl` contra `https://cognitive.devama.cloud` mostró: `http://` con 301 a `https://`, HSTS (`max-age=31536000; includeSubDomains`), CSP con `default-src 'self'` y `frame-ancestors 'none'`, `X-Frame-Options: DENY`, `nosniff`, `Permissions-Policy`, COEP `require-corp`, COOP `same-origin` y CORP `same-origin`. El despliegue automático de `deccebb` terminó con `check-headers` correcto. `pnpm security:evidence` cita este ADR desde la matriz y el modelo de amenazas.

## Enlaces

- [ADR-0086](0086-zap-baseline-pasivo-como-script-manual.md), [ADR-0088](0088-riesgos-aceptados-y-diferidos-a-f9.md), [ADR-0090](0090-imagen-de-borde-mismo-origen-y-url-relativa.md) y [ADR-0094](0094-despliegue-automatico-reversa-y-sin-backups.md).
- [Procedimiento de ZAP](../security/zap.md), [modelo de amenazas](../threat-model.md) (E12) y `specs/010-deployment/spec.md` (D2, D12; FR-033 y FR-034).
- Issue #65.
