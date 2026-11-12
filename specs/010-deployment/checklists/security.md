# Security Requirements Checklist: Despliegue (F9)

**Purpose**: Comprobar que los requisitos de seguridad y operación de la spec son completos, claros y
medibles antes de implementar (pruebas de los requisitos, no de la implementación).
**Created**: 2026-11-09
**Feature**: [spec.md](../spec.md)

## Cierre de lo diferido desde F7 y F8

- [x] CHK001 Cada fila `deferred:F9` de ADR-0088 tiene un requisito y una prueba prevista, o pasa a `accepted` con razón, dueño y revisión (FR-001 a FR-018, FR-022 a FR-028, FR-033 a FR-035)
- [x] CHK002 La condición «producción no sale sin autenticación, TLS y cabeceras» es un requisito y una prueba que falla sola (FR-012, FR-013, `deploy-config.test.ts`)
- [x] CHK003 Las cinco alertas de ZAP (10038, 10020, 10021, 10063, 90004) tienen su cabecera y su criterio de cierre, verificado en local y con `curl` tras cada despliegue (FR-002, FR-034, SC-001)
- [x] CHK004 La redacción de `/api/v1/hooks/*` y TLS del webhook tienen prueba (FR-003, SC-003)
- [x] CHK005 Cada issue #61 a #68 tiene un desenlace decidido por el autor (D12, D18 a D21; FR-035)

## Riesgos aceptados por las respuestas del autor (deben constar en el modelo de amenazas)

- [x] CHK006 Sin backups (D5): pérdida total de datos y de `CREDENTIALS_MASTER_KEY` si se pierde la VM; `accepted`, dueño autor, revisión antes de admitir datos reales (US4)
- [x] CHK007 Sin staging y despliegue automático (D2C, D3C): un cambio defectuoso llega a producción; mitigado con CI, escaneo al publicar, `migrator`, salud, cabeceras y reversa automática (FR-024)
- [x] CHK008 ZAP sin activo, sin sesión y sin TLS real (D12, #65): `accepted` (US7)
- [x] CHK009 Capa gratuita de Gemini en demo cerrada (D13C): LLM02 `accepted` con la condición de reapertura (US8)
- [x] CHK010 Sin métricas, sin alerta de costo y sin métrica de disparos descartados (D9C, D20): `accepted` (FR-028, US6)
- [x] CHK011 Registro, secretos y correo concentrados en la cuenta de Oracle (D1B, D4B, D14A): consta como riesgo de concentración (spec, consecuencias)
- [x] CHK012 Sin frecuencia mínima de la cron (D21B): `accepted`, acotada por el tope de 10 programaciones, `overlap = SKIP` y `max_concurrent_runs`

## Secretos y supply chain

- [x] CHK013 Ningún valor secreto, ni de ejemplo, entra al repositorio ni a las imágenes; gitleaks sigue sobre todo el historial (FR-014, SC-007)
- [x] CHK014 El origen y la rotación de cada secreto están enumerados y la VM solo lee del Vault (contracts/production-env.md, FR-015)
- [x] CHK015 Escaneo, SBOM, excepciones con dueño y fecha y permisos de publicación mínimos están definidos (FR-022, FR-023)
- [x] CHK016 Las imágenes y acciones nuevas se fijan por digest o SHA (FR-018, T019, T020)

## Operación y detección

- [x] CHK017 Eventos de seguridad con retención de 90 días, redacción verificada con un canario y alertas por correo (FR-027, FR-028)
- [x] CHK018 SPF, DKIM, DMARC y TLS del SMTP tienen criterio de aceptación (FR-030, SC-009)
- [x] CHK019 El registro de cuentas está cerrado en la demo y la forma de cerrarlo está propuesta (D23, T051)
- [x] CHK020 El acceso del operador queda en el registro de SSH y la UI de Temporal no se publica (FR-007, D15)
- [x] CHK021 El rollback no depende de migraciones inversas y la regla expand/contract está pedida (FR-025)

## Decisiones y trazabilidad

- [x] CHK022 Las 22 decisiones tienen opciones con ventajas y riesgos, y la respuesta del autor con su efecto (research R1–R22, spec)
- [x] CHK023 Las cifras de planes de terceros están marcadas **(verificar)** y hay una tarea que las confirma (T002)
- [x] CHK024 D23 respondida (A: Caddy 404) y registrada
- [x] CHK025 Constitución enmendada a 1.1.0: backups externos obligatorios solo antes de admitir datos reales

## Revisión al cierre de F9 (2026-11-12)

Las 25 casillas anteriores eran pruebas de los requisitos y siguen cumplidas. Al cerrar F9 se revisó que cada una tenga su implementación y su evidencia; lo que no se pudo comprobar consta aquí.

- CHK001, CHK005: [ADR-0088](../../../docs/adr/0088-riesgos-aceptados-y-diferidos-a-f9.md) fila por fila en [ADR-0099](../../../docs/adr/0099-cierre-de-f9-despliegue.md); `pnpm security:evidence` rechaza cualquier fila diferida.
- CHK002 a CHK004: `deploy-config.test.ts`, `deploy-security.test.ts` y `deploy/ops/check-headers.sh`; cabeceras y 404 verificados con `curl` en producción.
- CHK006 a CHK012: los siete riesgos constan como `accepted` con dueño y revisión en el [modelo de amenazas v3.0](../../../docs/threat-model.md) (sección 3.7).
- CHK013 a CHK016: gitleaks, Vault, escaneo, SBOM y fijación por digest o SHA en CI y `release.yml`.
- CHK017 y CHK018: retención y alertas verificadas (alerta de disco recibida); SPF, DKIM y DMARC configurados y correo entregado. **Falta anotar** el resultado `pass` de las tres comprobaciones en las cabeceras de un mensaje recibido (SC-009).
- CHK019 a CHK021: registro cerrado en producción (404); acceso solo por SSH con llave; reversa por digests sin migraciones inversas.
- **No medido:** consumo de memoria (T052, SC-010), reconstrucción en una VM limpia (T055) y las cifras de planes de terceros (T002, CHK023 sigue siendo una tarea abierta).

