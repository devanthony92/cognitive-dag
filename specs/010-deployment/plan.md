# Implementation Plan: Despliegue (F9)

**Branch**: `010-deployment` | **Date**: 2026-11-09 | **Spec**: [spec.md](./spec.md)

> Escrito con las respuestas del autor del 2026-11-09 (`1B 2C 3C 4B 5 sin backup, 6A 7A 8A 9C 10A 11C 12A 13C
> 14A 15A 16A 17A 18A 19A 20 sin métricas 21B 22A`). Queda abierta **D23** (cierre del registro de la demo).
> Nada de esto se despliega en la tarea de especificación.

## Summary

F9 lleva un sistema que solo corre en local a una VM de Oracle, con TLS y credenciales en todos los
servicios, repetible y reversible, **sin staging, sin backups y sin métricas** por decisión del autor. Añade
cuatro imágenes publicadas en OCIR (api, worker, migrator, borde con la web), un Compose de producción con
límites de memoria, Caddy como único punto de entrada, Temporal con mTLS y almacén en PostgreSQL, PostgreSQL y
Valkey con TLS y ACL, secretos en OCI Vault, un despliegue automático con reversa automática, escaneo y SBOM
al publicar, registros con retención de 90 días y alertas por correo desde un script, correo con
SPF/DKIM/DMARC y una demo cerrada con la capa gratuita de Gemini. El código de aplicación cambia poco:
`trust proxy`, TLS de los clientes de Temporal y del correo, validación de producción al arrancar, URL de API
relativa y un aviso de demo sin copias. Sin cambio de esquema. Decisiones en [research.md](./research.md);
[data-model.md](./data-model.md) confirma el esquema.

## Technical Context

**Language/Version**: TypeScript 6.0.3 sobre Node.js 24 (aplicación); Bash POSIX con `shellcheck` para los
scripts de operación; YAML (Compose, workflows); Caddyfile.

**Primary Dependencies**: las existentes en la aplicación; sin métricas ni OpenTelemetry (D9C). En
infraestructura, solo imágenes oficiales fijadas por digest: Caddy, Temporal server y UI, PostgreSQL, Valkey, el
escáner y el generador de SBOM (D11C, a evaluar). Ninguna entra al árbol de pnpm. Un helper de TLS para los
clientes solo si hace falta, con ADR.

**Storage**: PostgreSQL 18 (aplicación y almacén de Temporal en bases separadas) y Valkey en volúmenes de
Docker de la VM. **Sin copias externas (D5)**; volcado previo a cada migración en la VM. Sin cambios de
esquema.

**Testing**: Vitest para el código de aplicación (TLS de clientes, `trust proxy`, validación de producción,
transporte SMTP, aviso de demo); pruebas de contrato sobre los archivos de despliegue (cabeceras de Caddy,
redacción del token, límites de memoria, ningún puerto publicado salvo 80/443, imágenes por digest);
`shellcheck`; pruebas de integración del Compose de producción en CI con certificados efímeros (PostgreSQL,
Valkey y Temporal rechazan sin credenciales); pruebas de los scripts de despliegue, reversa y alertas; ZAP
baseline pasivo y local contra la imagen de borde. Ninguna prueba de CI llama a internet más allá de lo que ya
hace.

**Target Platform**: Linux arm64 (Oracle Ampere A1, 2 OCPU y 12 GB) con Docker; el mismo Compose en Linux x64.

**Performance Goals**: sin degradación de F7 (webhook 202 p95 < 500 ms medido a través de Caddy); SSE sin
retraso por búfer; consumo medido por debajo del 60 % de los límites (SC-010).

**Constraints**: nada de secretos en el repositorio ni en las imágenes; ningún puerto publicado salvo 80 y 443
(y 22 para SSH); Debian `bookworm-slim` y nunca Alpine; imágenes por digest; los 6 checks de CI no cambian; sin
cambio de autorización; migraciones expand/contract; registro de cuentas cerrado.

**Scale/Scope**: una VM, un operador; demo cerrada de tráfico bajo; 4 imágenes propias y 7 contenedores en
producción.

## Constitution Check

| Principio              | Cumplimiento                                                                                                                                                                                            | Estado         |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| I. Seguridad           | TLS y credenciales en todo; la aplicación falla cerrada al arrancar sin ellos en producción; sin secretos en repositorio ni imágenes; CSP sin `unsafe-inline` en scripts; la autorización no cambia   | PASS           |
| II. Resiliencia        | Reinicio automático, salud, `maxmemory` con fallo cerrado y reversa automática; sin llamadas externas nuevas en el flujo de ejecución. **Sin backups ni staging: riesgo aceptado, ver ADR-0094**       | PASS (con ADR) |
| III. Pruebas           | Cada requisito tiene su prueba prevista; las reglas de arranque y `trust proxy` van con TDD; las pruebas de configuración fallan si se retira un control                                              | PASS           |
| IV. Contratos          | Variables de producción validadas con Zod al arrancar; contrato de cabeceras por ruta ([contracts](./contracts/)); sin endpoints nuevos                                                                | PASS           |
| V. Errores             | Los errores de arranque nombran variables sin valores; no se añaden respuestas de error nuevas                                                                                                         | PASS           |
| VI. Correlation-ID     | Caddy reenvía `X-Correlation-Id` sin generar otro y lo registra; los registros lo conservan                                                                                                            | PASS           |
| VII. Desviaciones      | ADR-0089 a ADR-0098; el PLAN se corrige donde exigía backups, restauración y métricas                                                                                                                  | PASS (con ADR) |
| VIII. Flags            | Sin flags nuevos; los kill switches `LLM_ENABLED`, `TRIGGERS_ENABLED`, `HTTP_ENABLED` se documentan; si D23B, `REGISTRATION_ENABLED` es un kill switch de operación; migraciones expand/contract       | PASS           |
| IX. Idioma             | Documentos y guía de operación en español; scripts, variables y commits en inglés                                                                                                                      | PASS           |
| Restricciones técnicas | Debian `bookworm-slim`, multi-arch con runner arm64 nativo, aprovisionamiento por script. **Desviación:** «backups fuera de la VM» (Constitución, restricciones técnicas) no se cumple por D5; ADR-0094 | PASS (con ADR) |

OWASP tocado: A02 (configuración, TLS, cabeceras), A03 (SBOM y escaneo al publicar), A04 (cifrado en tránsito),
A05 (cabeceras y puertos), A07 (SMTP, correo falsificable), A08 (artefactos con digest), A09 (retención y
alertas por script), A10 (fallo cerrado al arrancar). LLM02 sigue `accepted` (demo cerrada, capa gratuita).

> **Enmienda pendiente de la constitución:** «Despliegue portable: Docker Compose, aprovisionamiento por
> script y backups fuera de la VM» contradice D5. Hay dos salidas: una enmienda de la constitución, o dejar la
> excepción justificada en Complexity Tracking y en ADR-0094. Este plan toma la segunda; la primera la decide
> el autor.

## Project Structure

```text
apps/web/Dockerfile                               # imagen de borde: build de la SPA + Caddy (D7)
packages/db/Dockerfile                            # imagen migrator (FR-026)
deploy/
  compose.prod.yaml                               # producción: límites, salud, redes, sin puertos salvo 80/443
  caddy/Caddyfile                                 # TLS, HSTS, CSP, redacción de hooks, SSE, /api
  postgres/{postgresql.conf,pg_hba.conf,init/}    # TLS, scram, roles desde secretos
  valkey/{valkey.conf,users.acl.tmpl}             # TLS, ACL, maxmemory
  temporal/{config.tmpl.yaml,dynamicconfig.yaml}  # mTLS, almacén PostgreSQL
  provision/{provision.sh,pki.sh,secrets.sh,harden.sh,cloud-init.yaml}
  ops/{deploy.sh,rollback.sh,doctor.sh,check-headers.sh,alerts.sh}
  env/*.example                                   # nombres de variables, sin valores
.github/workflows/release.yml                     # publica en OCIR, escanea y adjunta SBOM (D1, D11)
.github/workflows/deploy.yml                      # despliegue automático con reversa (D3)
docs/operations/*.md                              # guía de operación (FR-038)
docs/security/zap/                                # baseline contra la imagen de borde en local
docs/adr/0089..0098-*.md
scripts/test/unit/{deploy-config,images-config,workflows-permissions,provision,deploy-scripts,alerts}.test.ts
apps/api/src/{config,main.ts,...}                 # trust proxy, TLS de Temporal, SMTP, producción al arrancar
apps/worker/src/main.ts                           # TLS de Temporal
```

## PRs previstas

Respuestas del autor aplicadas (2026-11-09). Cinco PR, con un hito de **primer despliegue real** al terminar
la PR 4. Sin staging (D2C), la PR 4 despliega directamente a producción con el registro cerrado y datos de
prueba. Las columnas «Prerrequisitos» son del autor.

| PR  | Contenido                                                                                                                                                                                                                       | Depende de | Prerrequisitos del autor |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ------------------------ |
| 1   | **Aplicación lista para producción** (Sonnet): `trust proxy`, TLS de Temporal, SMTP con auth y TLS, URL de API relativa, validación de producción al arrancar, ACL de Valkey probada, aviso de demo sin copias; T003–T018      | `main`     | ninguno                  |
| 2   | **Imágenes y publicación** (Sonnet): Dockerfiles de borde y `migrator`, `release.yml` hacia OCIR con escaneo y SBOM, `shellcheck` en `quality`; ADR-0089, 0090 y 0096; T019–T027                                              | PR 1       | P7, P9                   |
| 3   | **Compose de producción y seguridad de datos** (Sonnet): Caddy, PKI, Temporal mTLS con PostgreSQL, PostgreSQL y Valkey con TLS y ACL, límites de memoria, pruebas de contrato y de integración, ZAP contra la imagen de borde en local; ADR-0091 y 0092; T028–T038 | PR 1, PR 2 | ninguno (local y CI)     |
| 4   | **Aprovisionamiento, secretos, despliegue, reversa y alertas** (Sonnet; Haiku para docs): `provision.sh`, OCI Vault, `deploy.yml` con reversa automática, comprobación de cabeceras, alertas por script, SPF/DKIM/DMARC, cierre del registro; ADR-0093 a 0095; T039–T055 | PR 3       | P1, P2, P5, P6, P7, P8, P10 |
| 5   | **Cierre** (Sonnet para modelo y matriz; Haiku para PLAN, README, ADR y `tasks.md`): modelo de amenazas v3.0, matriz, tratamiento de issues, PLAN §7, §9 y §10; ADR-0097 y 0098; T056–T063                                      | PR 4       | —                        |

**Hito de PR 4:** primer despliegue real. **Hito de PR 5:** demo cerrada con TLS y cierre de ADR-0088.

### ADRs previstos

| ADR  | Tema                                                                                 |
| ---- | ------------------------------------------------------------------------------------ |
| 0089 | OCIR como registro y etiquetado por digest (D1)                                      |
| 0090 | Imagen de borde (web + Caddy), mismo origen y URL de API relativa (D6, D7)           |
| 0091 | Temporal en producción: mTLS, almacén PostgreSQL, UI solo por túnel (D15)            |
| 0092 | PostgreSQL y Valkey con TLS y ACL, y PKI interna (D8)                                |
| 0093 | Secretos en OCI Vault (D4)                                                           |
| 0094 | Despliegue automático con reversa, y ausencia de backups como riesgo aceptado (D3, D5, D17) |
| 0095 | Registros, retención de 90 días y alertas por script (D9, D10)                       |
| 0096 | SBOM y escaneo de imágenes al publicar (D11)                                         |
| 0097 | Verificación de cabeceras sin staging; #65 `accepted` (D2, D12)                      |
| 0098 | Cierre de F9: D1 a D23, riesgos aceptados y su revisión                              |

## Complexity Tracking

| Decisión                                                                  | Motivo                                                                                                                                                              |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Carpeta nueva `deploy/` con scripts y Compose                              | La infraestructura de producción no cabe en `compose.yaml` (desarrollo); mantenerlos separados evita que un cambio de desarrollo afecte a producción               |
| Pruebas de contrato sobre archivos de despliegue                          | "Producción no sale sin esto" debe fallar sola en CI si alguien retira TLS, un límite de memoria o publica un puerto                                               |
| `release.yml` y `deploy.yml` separados de `ci.yml`                         | `ci.yml` conserva `contents: read` y los 6 checks; los permisos de escritura viven solo donde se publica                                                           |
| PKI interna propia                                                        | Evita un servicio permanente en una VM pequeña; solo existe dentro de la red de Compose                                                                             |
| Sin staging ni backups (D2C, D5)                                          | Decisión del autor: se acepta que un cambio defectuoso llegue a producción (reversa automática) y que perder la VM sea perder los datos; ADR-0094 y modelo de amenazas `accepted` |
| Constitución dice «backups fuera de la VM»                                | Excepción por D5; se deja en ADR-0094 y el autor decide si enmienda la constitución                                                                                  |
| Temporal de producción con PostgreSQL (no `start-dev`)                    | Requisito de 8C: autenticación, TLS y almacén duradero; `start-dev` usa SQLite sin autenticación                                                                    |
| Despliegue por empuje restringido o por extracción (se elige en T047)     | Evita dar a CI un acceso amplio a la VM                                                                                                                             |
