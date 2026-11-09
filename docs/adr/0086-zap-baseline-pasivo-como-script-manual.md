---
status: accepted
date: 2026-11-08
decision-makers: autor
---

# ZAP baseline pasivo como script manual y su alcance

## Contexto y problema

`docs/PLAN.md` §6.3 exige pasar OWASP ZAP contra la plataforma y dejar la evidencia. No existe
staging hasta F9, y un workflow de CI para ZAP añadiría un check requerido, minutos de pipeline y una
imagen pesada para una herramienta que hoy solo tiene local que escanear.

## Opciones consideradas

- Workflow de CI con ZAP baseline en cada PR.
- Script manual con ZAP baseline pasivo y el informe versionado como evidencia (elegida).
- ZAP activo o con sesión iniciada ya en F8.

## Decisión

`scripts/security/zap-baseline.sh` ejecuta `zap-baseline.py` desde el contenedor oficial
`zaproxy/zap-stable`, fijado por digest, con `--network host`. Solo acepta destinos loopback (sale con
código 2 si no), nunca llama a Gemini ni a terceros, y siembra la araña de la web con las rutas
públicas de la API mediante `.zap/seed-hook.py`. Las decisiones por regla viven en `.zap/rules.tsv`;
las alertas medias o altas, en `docs/security/zap.md` con razón, dueño y revisión.

Las alertas aceptadas quedan en `WARN`, no en `IGNORE`, para que reaparezcan en la corrida de F9. Solo
el falso positivo (10096) se ignora.

El script no relaja límites de tasa: los de login y webhook son constantes (`RATE_RULES`), la araña
solo emite GET y la semilla envía 5 peticiones, por debajo de cualquier límite.

**Resultado de F8.** La API no tiene alertas medias ni altas. La web, servida como estática por
`vite preview`, tiene dos medias (CSP y anti-clickjacking) que se aceptan hasta F9, cuando Caddy sirve
la web y debe fijar las cabeceras. No hubo cambios de código, así que no hubo pruebas de regresión
nuevas; la superficie de la API sigue fijada por `security-surface.test.ts`.

## Consecuencias

- Bueno: evidencia reproducible sin check nuevo ni coste de CI; el destino no puede apartarse de
  loopback sin que falle una prueba.
- Bueno: una alerta aceptada no se oculta; vuelve a verse en staging.
- Malo: no hay análisis activo ni con sesión; la superficie autenticada solo la cubren las pruebas de
  integración. Se valora en F9 (issue #65).
- Malo: en Docker Desktop para Windows el modo `host` apunta a la VM; hace falta un relé `socat`
  documentado en `docs/security/zap.md`.

## Confirmación

`scripts/test/unit/zap-script.test.ts`: rechazo de hosts no loopback, imagen fijada por digest, ningún
destino de Gemini o de terceros, ausencia de `zap.yml`, y que todo alerta media o alta del informe
versionado tenga regla y decisión.

## Enlaces

- [ADR-0085](0085-tope-del-reconciliador-y-eventos-de-seguridad-nuevos.md)
- [Research F8](../../specs/009-hardening/research.md) (R5), [procedimiento](../security/zap.md).
