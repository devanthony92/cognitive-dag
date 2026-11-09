---
status: accepted
date: 2026-11-09
decision-makers: autor
---

# Riesgos aceptados y diferidos a F9

## Contexto y problema

Al cerrar F8, algunos riesgos del modelo de amenazas no se pueden eliminar en esta fase. Unos
dependen del despliegue (F9), porque no hay VM, TLS ni proxy todavía. Otros son decisiones de
producto tomadas por el autor (sin MFA, auditoría como eventos de log) o límites que el coste de
corregirlos no justifica en F8. Hace falta una lista única con razón, dueño y fase de revisión
para cada uno, para que ninguno quede disperso y para que F9 sepa qué debe cerrar.

**Producción no debe salir sin los puntos de la tabla marcados con F9 que afectan a
autenticación, TLS y cabeceras.** Hasta F9 el sistema solo corre en local.

## Opciones consideradas

- Dejar cada riesgo en el modelo de amenazas y en `docs/PLAN.md`: sin fecha de revisión y difícil
  de auditar.
- Corregir todo en F8: fuera de alcance según las decisiones 4A, 5A, 8C y 9C, y varios puntos
  solo tienen sentido con el despliegue real.
- Un único ADR con una tabla de riesgos aceptados y diferidos, enlazado desde la matriz y el
  modelo (elegida).

## Decisión

Todos los riesgos tienen como dueño al autor. La fase de revisión es la indicada en la tabla.

| Riesgo                                        | Estado        | Revisión       | Issue |
| --------------------------------------------- | ------------- | -------------- | ----- |
| Sin MFA ni TOTP (A07)                         | `accepted`    | Posterior a F9 | #61   |
| Auditoría como eventos de log (A09)           | `accepted`    | F9             | #62   |
| Temporal, PostgreSQL y Valkey sin auth ni TLS | `deferred:F9` | F9             | #63   |
| Sin SBOM ni escaneo de imágenes (A03)         | `accepted`    | F9             | #64   |
| ZAP activo, con sesión y contra staging       | `deferred:F9` | F9             | #65   |
| Ejecución `failed` tras fallo de Temporal     | `accepted`    | Posterior a F9 | #66   |
| Disparos fuera del catch-up sin métrica       | `accepted`    | F9             | #67   |
| Sin frecuencia mínima de la cron              | `accepted`    | F9             | #68   |
| Capa gratuita de Gemini (LLM02)               | `accepted`    | F9             | —     |
| Webhook con token en la URL, sin HMAC (A08)   | `accepted`    | F9             | —     |
| Cabeceras de la web (ZAP 10038, 10020, etc.)  | `accepted`    | F9             | —     |

Razón y requisito de cada fila:

- **Sin MFA ni TOTP (A07).** Decisión 4A. Siguen vigentes las sesiones opacas, el bloqueo
  progresivo y la política de 8 a 25 caracteres ([ADR-0026](0026-politica-de-contrasenas-8-25.md)).
  La revisión de la política y de MFA se hace después de F9.
- **Auditoría como eventos de log (A09).** Decisión 5A. Los eventos de seguridad son líneas de
  log con tipo estable ([ADR-0038](0038-eventos-de-seguridad-en-logs.md)), sin tabla de auditoría
  por tenant. F9 define la retención de esos eventos y las alertas de fallos de autenticación y
  de coste. Prueba prevista: la retención y la alerta existen en el despliegue.
- **Temporal, PostgreSQL y Valkey sin autenticación fuerte ni TLS.** Decisión 8C. No hay
  despliegue y la configuración depende del entorno. Requisitos para F9: mTLS en Temporal y su UI
  tras túnel; contraseñas propias y TLS en PostgreSQL; `requirepass` o ACL, `maxmemory` y TLS en
  Valkey. Prueba prevista: un intento de conexión sin credenciales falla.
- **Sin SBOM ni escaneo de imágenes (A03).** Decisión 9C. El plan marca el SBOM como opcional y un
  escáner sobre imágenes que aún no se despliegan genera ruido. Lo cubren hoy `pnpm audit`,
  gitleaks, Renovate, los digests y `minimumReleaseAge`. Revisión en F9 con las imágenes finales.
- **ZAP activo, con sesión y contra staging.** Decisión 6A, según
  [ADR-0086](0086-zap-baseline-pasivo-como-script-manual.md). El baseline pasivo es local.
  Prueba prevista: repetir `scripts/security/zap-baseline.sh` contra staging y decidir si se
  añade análisis activo.
- **Ejecución `failed` tras fallo de Temporal (webhook).** Corregirlo exige una compensación
  transaccional con Temporal. El emisor reintenta con otro `X-Event-Id`. Revisión después de F9
  con datos reales.
- **Disparos fuera del catch-up sin métrica.** Temporal los descarta y el worker no los observa.
  Revisión en F9 con las métricas del servidor de Temporal.
- **Sin frecuencia mínima de la cron.** El coste queda acotado por el tope de 10 programaciones
  activas por organización, `overlap = SKIP` y `max_concurrent_runs`. Revisión en F9.
- **Capa gratuita de Gemini (LLM02).** El proveedor puede usar el contenido enviado. Hasta F9 solo
  se usan datos de prueba. Migrar a la capa de pago antes de la demo pública
  ([plan](../PLAN.md) §9).
- **Webhook sin HMAC (A08).** Decisión registrada en
  [ADR-0072](0072-webhook-con-token-en-la-url-sin-hmac.md). Antes de desplegar, TLS y la
  redacción del token en el proxy son obligatorios (F9).
- **Cabeceras de la web.** Hoy `vite preview` sirve la web sin cabeceras de seguridad (alertas
  ZAP 10038 y 10020, medias, y 10021, 10063 y 90004, bajas). Caddy debe enviarlas en F9: CSP con
  `default-src 'self'`, sin `unsafe-inline` en scripts y con `frame-ancestors 'none'`;
  `X-Frame-Options: DENY`; `X-Content-Type-Options: nosniff`; `Permissions-Policy`; y COEP, COOP
  y CORP. Prueba prevista: repetir el baseline contra staging y comprobar que esas alertas
  desaparecen. Detalle en [docs/security/zap.md](../security/zap.md).

## Consecuencias

- Bueno: una sola lista con el motivo, el dueño y la fase de cada excepción. Cada fila sale de
  la lista al cerrarse.
- Bueno: la matriz de evidencia y el modelo de amenazas enlazan aquí en lugar de repetir razones.
- Malo: F9 queda cargado. Incluye credenciales y TLS de Temporal, PostgreSQL y Valkey, cabeceras de
  Caddy, retención de logs de seguridad y migración de Gemini.
- Malo: son excepciones aceptadas por el autor, sin revisión independiente.

## Confirmación

Al cerrar F9, cada fila pasa a `verified` con su prueba o se reabre con una razón nueva. Las
rutas de la matriz y del modelo de amenazas, que enlazan a este ADR, las comprueba
`pnpm security:evidence` ([ADR-0087](0087-matriz-de-evidencia-owasp-comprobador-y-estados.md)).

## Enlaces

- [ADR-0087](0087-matriz-de-evidencia-owasp-comprobador-y-estados.md): matriz, comprobador y
  estados.
- [ADR-0072](0072-webhook-con-token-en-la-url-sin-hmac.md),
  [ADR-0026](0026-politica-de-contrasenas-8-25.md),
  [ADR-0038](0038-eventos-de-seguridad-en-logs.md) y
  [ADR-0086](0086-zap-baseline-pasivo-como-script-manual.md).
- [Modelo de amenazas](../threat-model.md) y [plan técnico](../PLAN.md) §9 (requisitos de F9).
- [Research F8](../../specs/009-hardening/research.md) (R6, R7, R9 y R10) y
  [spec](../../specs/009-hardening/spec.md).
- [Procedimiento de ZAP](../security/zap.md).
