# Implementation Plan: Despliegue (F9)

**Branch**: `010-deployment` | **Date**: 2026-11-09 | **Spec**: [spec.md](./spec.md)

> **Borrador.** Está escrito sobre las **recomendaciones** de [research.md](./research.md) (D1A … D22A).
> Cuando lleguen las respuestas del autor se reescriben las partes marcadas **[Dn]** y se cierra
> `tasks.md`. Nada de esto se despliega en la tarea de especificación.

## Summary

F9 convierte un sistema que solo corre en local en uno que corre en una VM, con TLS y credenciales en
todos los servicios, y lo hace repetible y reversible. Añade cuatro imágenes publicadas (api, worker,
migrator, borde con la web), un Compose de producción con límites de memoria, Caddy como único punto de
entrada, Temporal con mTLS y almacén en PostgreSQL, PostgreSQL y Valkey con TLS y ACL, secretos fuera del
repositorio, backups cifrados externos con restauración probada, un workflow de publicación y de
despliegue con reversa, escaneo y SBOM de imágenes, observabilidad con alertas de autenticación y de
costo, correo con SPF/DKIM/DMARC, Gemini de pago y un staging para ZAP con sesión y activo. El código de
aplicación cambia poco: `trust proxy`, TLS de los clientes de Temporal y del correo, validación de
producción al arrancar, métricas y, según D21, un mínimo de frecuencia de la cron. Sin cambio de esquema
salvo que D10 sea B. Decisiones en [research.md](./research.md);
[data-model.md](./data-model.md) confirma el esquema.

## Technical Context

**Language/Version**: TypeScript 6.0.3 sobre Node.js 24 (aplicación); Bash POSIX con `shellcheck` para los
scripts de operación; YAML (Compose, workflows); Caddyfile.

**Primary Dependencies**: las existentes en la aplicación. Posibles nuevas, cada una con ADR (principio
VII): una librería de métricas (D9) y, si hace falta, un helper de TLS para `iovalkey`/`pg`. En
infraestructura, solo imágenes oficiales fijadas por digest: Caddy, Temporal server y UI, PostgreSQL,
Valkey, restic, el agente de observabilidad (D9), el escáner y el generador de SBOM (D11). Ninguna entra
al árbol de pnpm.

**Storage**: PostgreSQL 18 (aplicación y almacén de Temporal en bases separadas) y Valkey; volúmenes de
Docker en la VM; copia cifrada en el destino de D5. Sin cambios de esquema (ver data-model).

**Testing**: Vitest para el código de aplicación (TLS de clientes, `trust proxy`, validación de
producción, redacción de métricas, cron mínima si D21A); pruebas de contrato de configuración sobre los
archivos de despliegue (cabeceras de Caddy, redacción del token, límites de memoria presentes, ningún
puerto publicado salvo 80/443, imágenes por digest); `shellcheck`; pruebas de integración del Compose de
producción en CI con certificados efímeros (PostgreSQL, Valkey y Temporal rechazan sin credenciales);
prueba de humo y de restauración sobre un entorno limpio; ZAP manual contra staging. Ninguna prueba de CI
llama a internet más allá de lo que ya hace.

**Target Platform**: Linux arm64 (Oracle Ampere A1, 2 OCPU y 12 GB) con Docker; el mismo Compose en Linux
x64.

**Performance Goals**: sin degradación de F7 (webhook 202 p95 < 500 ms medido a través de Caddy en
staging); SSE sin retraso por búfer; consumo medido por debajo del 60 % de los límites (SC-010).

**Constraints**: nada de secretos en el repositorio ni en las imágenes; ningún puerto publicado salvo 80 y
443 (y 22 para SSH); Debian `bookworm-slim` y nunca Alpine; imágenes por digest; los 6 checks de CI no
cambian; sin cambio de autorización; migraciones expand/contract; staging nunca usa la clave de Gemini de
pago.

**Scale/Scope**: una VM, un operador; demo pública con tráfico bajo; 4 imágenes propias, 8 contenedores en
producción.

## Constitution Check

| Principio                 | Cumplimiento                                                                                                                                                                                                                       | Estado          |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| I. Seguridad              | TLS y credenciales en todo; la aplicación falla cerrada al arrancar sin ellos en producción; sin secretos en repositorio ni imágenes; CSP sin `unsafe-inline` en scripts; sin `eval`; la autorización no cambia                      | PASS            |
| II. Resiliencia           | Reinicio automático, comprobaciones de salud, `maxmemory` con fallo cerrado, backups y rollback; sin llamadas externas nuevas en el flujo de ejecución (las del agente de observabilidad y los backups están fuera de él)           | PASS            |
| III. Pruebas              | Cada requisito tiene su prueba prevista; las reglas de arranque en producción y `trust proxy` van con TDD; las pruebas de configuración del despliegue fallan si se retira un control; restauración probada                           | PASS            |
| IV. Contratos             | Variables de entorno de producción validadas con Zod al arrancar; contrato de cabeceras por ruta ([contracts](./contracts/)); sin endpoints nuevos salvo el 422 de D21A                                                            | PASS            |
| V. Errores                | El 422 de cron mínima usa `application/problem+json` con `code` estable; los errores de arranque nombran variables sin valores                                                                                                    | PASS            |
| VI. Correlation-ID        | Caddy reenvía `X-Correlation-Id` sin generar otro y lo registra; los registros enviados al almacén lo conservan; las alertas enlazan por `correlationId`                                                                            | PASS            |
| VII. Desviaciones         | ADR-0089 a ADR-0098 (ver abajo); las dependencias nuevas, si las hay, con ADR; el cambio de nombre de variables o de topología se registra                                                                                          | PASS (con ADR)  |
| VIII. Flags               | Sin flags nuevos (F8 los eliminó); los kill switches `LLM_ENABLED`, `TRIGGERS_ENABLED`, `HTTP_ENABLED` se documentan en la guía de operación; migraciones expand/contract                                                          | PASS            |
| IX. Idioma                | Documentos y guía de operación en español; scripts, variables y commits en inglés                                                                                                                                                  | PASS            |
| Restricciones técnicas    | Debian `bookworm-slim`, multi-arch con runner arm64 nativo, aprovisionamiento por script, backups fuera de la VM                                                                                                                   | PASS            |

OWASP tocado: A02 (configuración, TLS, cabeceras), A03 (SBOM y escaneo), A04 (cifrado en tránsito y en
reposo de las copias), A05 (cabeceras y puertos), A07 (SMTP, correo falsificable), A08 (artefactos con
digest y procedencia), A09 (retención y alertas), A10 (fallo cerrado al arrancar); LLM02 (capa de pago),
LLM10 (alerta y tope de costo).

## Project Structure

```text
apps/web/Dockerfile                               # imagen de borde: build de la SPA + Caddy (D7)
packages/db/Dockerfile                            # imagen migrator (FR-026)
deploy/
  compose.prod.yaml                               # producción: límites, salud, redes, sin puertos salvo 80/443
  compose.staging.yaml                            # diferencias de staging (límites, dominio, LLM apagado)
  caddy/Caddyfile                                 # TLS, HSTS, CSP, redacción de hooks, SSE, /api
  postgres/{postgresql.conf,pg_hba.conf,init/}    # TLS, scram, roles desde secretos
  valkey/{valkey.conf,users.acl.tmpl}             # TLS, ACL, maxmemory
  temporal/{config.tmpl.yaml,dynamicconfig.yaml}  # mTLS, almacén PostgreSQL
  observability/                                  # agente y reglas de alerta (D9)
  provision/{provision.sh,pki.sh,secrets.sh,harden.sh,cloud-init.yaml}
  backup/{backup.sh,restore.sh,smoke.sh,verify.sh}
  ops/{deploy.sh,rollback.sh,doctor.sh}
  env/*.example                                   # nombres de variables, sin valores
.github/workflows/release.yml                     # publica imágenes (D1), SBOM y escaneo
.github/workflows/deploy.yml                      # despliegue a staging y producción (D3)
docs/operations/*.md                              # guía de operación (FR-038)
docs/security/{deployment-evidence.md,restore-evidence.md,zap/}   # evidencia de F9
docs/adr/0089..0098-*.md
scripts/security/zap-baseline.sh                  # lista cerrada ampliada a staging (D12)
scripts/test/unit/{deploy-config.test.ts,zap-script.test.ts}      # contratos de configuración
apps/api/src/{config,main.ts,...}                 # trust proxy, TLS de Temporal, SMTP, producción al arrancar
apps/worker/src/main.ts                           # TLS de Temporal
```

## PRs previstas

El orden respeta las dependencias y deja un hito de **producción segura** al terminar la PR 4. Las
columnas "Depende de" cuentan también los prerrequisitos del autor.

| PR  | Contenido                                                                                                                                                                                                                              | Depende de                       | Prerrequisitos del autor |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- | ------------------------ |
| 1   | **Aplicación lista para producción** (Sonnet): `trust proxy`, TLS de Temporal, SMTP con auth y TLS, `VITE_API_URL` relativo, validación de producción al arrancar, política de expulsión de Valkey probada; cron mínima si D21A      | `main`                           | ninguno                  |
| 2   | **Imágenes y publicación** (Sonnet): Dockerfile de borde y de `migrator`, `release.yml`, escaneo y SBOM en `images` y en publicación, `shellcheck` en `quality`; ADR-0089 y ADR-0090                                                    | PR 1 (variables y arranque)      | P9, D1                   |
| 3   | **Compose de producción y seguridad de datos** (Sonnet): `deploy/compose.prod.yaml`, Caddy, PKI, Temporal mTLS con PostgreSQL, PostgreSQL y Valkey con TLS y ACL, límites de memoria; pruebas de configuración y de integración en CI; ADR-0091 y ADR-0092 | PR 1 y PR 2                      | ninguno (local/CI)       |
| 4   | **Aprovisionamiento, secretos, backups, despliegue y reversa** (Sonnet): `provision.sh`, secretos, `backup/*` con prueba de restauración, `ops/deploy.sh` y `rollback.sh`, `deploy.yml`, guía de operación; ADR-0093 y ADR-0094 | PR 3                             | P1, P2, P3, P7, P8       |
| 5   | **Observabilidad, correo y Gemini** (Sonnet; Haiku para docs): métricas, agente, retención, alertas con prueba, SPF/DKIM/DMARC, clave de pago, #67; ADR-0095                                                                         | PR 4 (hay un entorno)            | P4, P5, P6               |
| 6   | **Staging, ZAP y cierre** (Sonnet para ZAP y modelo; Haiku para PLAN, README y `tasks.md`): staging, `zap-baseline.sh` ampliado, informes con sesión y activo, matriz y modelo de amenazas v3.0, `docs/PLAN.md` §9 reescrito, quickstart; ADR-0096 a ADR-0098 | PR 4 y PR 5                      | P2 (staging), P1         |

**Hito de PR 4:** primer despliegue real a staging. **Hito de PR 6:** demo pública (TLS, restauración
probada) y cierre de ADR-0088.

### ADRs previstos

| ADR  | Tema                                                                           |
| ---- | ------------------------------------------------------------------------------ |
| 0089 | Registro de imágenes y política de etiquetado por digest (D1)                  |
| 0090 | Imagen de borde (web + Caddy), mismo origen y URL de API relativa (D6, D7)    |
| 0091 | Temporal en producción: mTLS, almacén PostgreSQL, UI solo por túnel (D15)      |
| 0092 | PostgreSQL y Valkey con TLS y ACL, y PKI interna (D8)                          |
| 0093 | Secretos de la VM y su copia fuera (D4)                                        |
| 0094 | Backups, retención y restauración (D5), y despliegue y rollback (D3, D17)      |
| 0095 | Observabilidad, alertas y retención de eventos de seguridad (D9, D10)          |
| 0096 | SBOM y escaneo de imágenes (D11)                                               |
| 0097 | ZAP contra staging, activo y con sesión (D2, D12)                              |
| 0098 | Cierre de F9: riesgos que pasan a `verified`, `accepted` y su revisión (D18–D22) |

## Complexity Tracking

| Decisión                                                                  | Motivo                                                                                                                                                              |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Carpeta nueva `deploy/` con scripts y Compose                              | La infraestructura de producción no cabe en `compose.yaml` (desarrollo); mantenerlos separados evita que un cambio de desarrollo afecte a producción               |
| Pruebas de contrato sobre archivos de despliegue                          | "Producción no sale sin esto" debe fallar sola en CI si alguien retira TLS, un límite de memoria o publica un puerto                                               |
| `release.yml` y `deploy.yml` separados de `ci.yml`                         | `ci.yml` conserva `contents: read` y los 6 checks; los permisos de escritura viven solo donde se publica                                                           |
| PKI interna propia                                                        | Evita un servicio permanente en una VM pequeña; solo existe dentro de la red de Compose                                                                             |
| Staging en la misma VM                                                    | Cabe en 12 GB y prueba la misma arquitectura; el coste es el aislamiento incompleto, mitigado con redes, volúmenes, secretos y límites propios                      |
| Temporal de producción con PostgreSQL (no `start-dev`)                    | Requisito de 8C: autenticación, TLS y almacén duradero; `start-dev` usa SQLite sin autenticación                                                                    |
| Despliegue pull o por SSH restringido (se elige con D3)                   | Evita dar a CI un acceso amplio a la VM                                                                                                                             |
