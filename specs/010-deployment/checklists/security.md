# Security Requirements Checklist: Despliegue (F9)

**Purpose**: Comprobar que los requisitos de seguridad y operación de la spec son completos, claros y
medibles antes de implementar (pruebas de los requisitos, no de la implementación).
**Created**: 2026-11-09
**Feature**: [spec.md](../spec.md)

## Cierre de lo diferido desde F7 y F8

- [x] CHK001 Cada fila `deferred:F9` de ADR-0088 tiene un requisito y una prueba prevista (FR-001 a FR-013, FR-019 a FR-034)
- [x] CHK002 La condición "producción no sale sin autenticación, TLS y cabeceras" está escrita como requisito y como prueba que falla sola (FR-012, FR-013, `deploy-config.test.ts`)
- [x] CHK003 Las cinco alertas de ZAP (10038, 10020, 10021, 10063, 90004) tienen su cabecera y su criterio de cierre (FR-002, SC-001)
- [x] CHK004 La redacción de `/api/v1/hooks/*` y TLS del webhook tienen prueba (FR-003, SC-003)
- [x] CHK005 Cada issue #61 a #68 tiene un desenlace posible y una decisión del autor que lo fija (FR-035, D18 a D21)

## Secretos y supply chain

- [x] CHK006 Ningún valor secreto, ni de ejemplo, entra al repositorio ni a las imágenes; gitleaks sigue sobre todo el historial (FR-014, SC-007)
- [x] CHK007 El origen, la copia y la rotación de cada secreto están enumerados (contracts/production-env.md)
- [x] CHK008 La copia de la llave maestra de credenciales es distinta de la de los backups y su pérdida está descrita (US3 escenario 3)
- [x] CHK009 SBOM, escaneo, excepciones con dueño y fecha, y permisos de publicación mínimos están definidos (FR-022, FR-023)
- [x] CHK010 Las imágenes y acciones nuevas se fijan por digest o SHA (FR-018, T018, T019)

## Datos y recuperación

- [x] CHK011 Backups cifrados fuera de la VM, retención automatizada y alerta de copia vieja (FR-019, FR-021)
- [x] CHK012 La restauración se prueba de extremo a extremo con RLS y roles, con RTO y RPO medidos (FR-020, SC-004)
- [x] CHK013 El almacén de Temporal entra en el respaldo por contener entradas y salidas sin cifrar (ADR-0050; US4 escenario 5)
- [x] CHK014 El rollback no depende de migraciones inversas y la regla expand/contract está pedida (FR-025)

## Operación y detección

- [x] CHK015 Eventos de seguridad con retención, redacción verificada con un canario y alertas de autenticación y costo (FR-027, FR-028)
- [x] CHK016 El tope de gasto externo de Gemini existe como prerrequisito y la alerta lo respalda (FR-031, P4)
- [x] CHK017 SPF, DKIM, DMARC y TLS del SMTP tienen criterio de aceptación (FR-030, SC-009)
- [x] CHK018 Staging no puede usar la clave de pago ni el SMTP de producción, y ZAP activo no puede apuntar a producción (FR-031, FR-033)
- [x] CHK019 El acceso del operador queda en el registro de SSH y la UI de Temporal no se publica (FR-007, D15)

## Decisiones y trazabilidad

- [x] CHK020 Las 22 decisiones tienen opciones con ventajas y riesgos y una recomendación (research R1–R22)
- [x] CHK021 Lo que cambia en las tareas si el autor responde distinto está tabulado (tasks.md)
- [x] CHK022 Las cifras de planes de terceros están marcadas **(verificar)** y hay una tarea que las confirma (T002)
- [ ] CHK023 Las respuestas del autor están registradas en la spec (Clarifications) y los ADR 0089 a 0098 las citan. **Pendiente de la respuesta del autor**
