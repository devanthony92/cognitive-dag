---
status: accepted
date: 2026-10-28
decision-makers: autor
---

# Integraciones externas diferidas; MVP con conectores genéricos y simulado (D7)

## Contexto y problema

Las integraciones reales (Gmail, Slack) exigen OAuth por tenant, cuotas y revisión de seguridad
propia. Distraen del objetivo central, que es el motor.

## Opciones consideradas

- Integraciones reales desde el MVP.
- Conectores genéricos (`http.request`) más un conector simulado con fallos configurables.

## Decisión

El MVP incluye `http.request` (con allowlist anti-SSRF) y `mock.service` (latencia, 429, 5xx y
timeouts inyectables). Las integraciones reales quedan para la fase F10.

## Consecuencias

- Bueno: las pruebas de resiliencia y caos pueden provocar fallos reproducibles.
- Malo: la demo no toca servicios reales.

## Enlaces

- `docs/PLAN.md` §2 (D7) y §5.6.
