---
status: accepted
date: 2026-11-12
decision-makers: autor
---

# Cierre de F9: despliegue en Oracle Always Free, decisiones D1 a D23, riesgos aceptados y lecciones

## Contexto y problema

F9 llevó CognitiveDAG de «solo en local» a una demo cerrada en producción, sin staging, sin copias de seguridad externas y con despliegue automático. [ADR-0088](0088-riesgos-aceptados-y-diferidos-a-f9.md) dejó una lista de riesgos diferidos a esta fase y la condición de que producción no saliera sin autenticación, TLS y cabeceras. Hace falta un registro único de lo que se decidió, de lo que realmente quedó en producción, de cada riesgo aceptado con su dueño y su revisión, y de lo que enseñó el primer despliegue real.

## Opciones consideradas

- Cerrar F9 con el modelo de amenazas y la matriz, y dejar las decisiones repartidas en los ADR-0089 a 0098 y en la spec: sin una vista única, y los riesgos aceptados se pierden entre documentos.
- Reabrir cada fila de ADR-0088 con un ADR propio: ruido para once filas de una misma fase.
- **Un ADR de cierre con la tabla de decisiones, el estado real de producción, los riesgos aceptados y las lecciones, y ADR-0088 marcado fila por fila (elegida).**

## Decisión

F9 se da por completada con el criterio ajustado por D5 y D13: **demo cerrada con TLS, cabeceras verificadas y despliegue con reversa**. Se cumplió ese criterio; no se cumplió el original del plan («restauración de backup probada»), porque D5 retiró los backups. Lo que no se pudo medir queda dicho como tal, no como hecho.

### Estado real de producción

- Sitio: `https://cognitive.devama.cloud`. VM Oracle Ampere A1 (2 OCPU, 12 GB, Ubuntu 24.04 aarch64) en `sa-bogota-1`.
- Primer despliegue: `4e0700b`, el 2026-11-12. Despliegue automático por push verificado con `deccebb` (#83): la publicación (`release.yml`) dispara `deploy.yml`, que entra por SSH restringida a `deploy/ops/ssh-deploy.sh`, que ejecuta `deploy.sh` y termina con `check-headers` correcto.
- Verificado: certificado TLS válido; `http://` responde 301 a HTTPS; cabeceras del contrato; `POST /api/v1/auth/register` y `/api/v1/metrics` responden 404; `/api/v1/auth/session` sin sesión responde 401; una cuenta creada con `deploy/ops/create-account.sh` recibió su correo de verificación por OCI Email Delivery; la alerta de disco llegó por correo; el temporizador de alertas corre cada 5 minutos; los contenedores no alcanzan `169.254.169.254`.

### Decisiones D1 a D23

| #   | Tema                 | Decisión                                               | ADR                                                                      | Estado en producción                                                     |
| --- | -------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| D1  | Registro de imágenes | B: OCIR, por digest                                    | [ADR-0089](0089-ocir-como-registro-y-etiquetado-por-digest.md)           | Hecho; resolución por SHA arreglada en #82                               |
| D2  | Staging              | C: sin staging                                         | [ADR-0098](0098-verificacion-de-cabeceras-sin-staging.md)                | Riesgo aceptado                                                          |
| D3  | Despliegue           | C: todo automático                                     | [ADR-0094](0094-despliegue-automatico-reversa-y-sin-backups.md)          | Hecho; push con SSH restringida, verificado con `deccebb`                |
| D4  | Secretos             | B: OCI Vault                                           | [ADR-0093](0093-secretos-en-oci-vault.md)                                | Hecho; a `tmpfs`, falla cerrado; IAM corregido tras el primer despliegue |
| D5  | Backups              | Sin backup                                             | [ADR-0094](0094-despliegue-automatico-reversa-y-sin-backups.md)          | Riesgo aceptado; constitución 1.1.0                                      |
| D6  | Origen               | A: mismo origen                                        | [ADR-0090](0090-imagen-de-borde-mismo-origen-y-url-relativa.md)          | Hecho                                                                    |
| D7  | Web estática         | A: imagen de borde única                               | [ADR-0090](0090-imagen-de-borde-mismo-origen-y-url-relativa.md)          | Hecho                                                                    |
| D8  | PKI interna          | A: CA con `openssl`                                    | [ADR-0092](0092-postgresql-y-valkey-con-tls-acl-y-pki-interna.md)        | Hecho; permisos de `ca.crt` arreglados en #83                            |
| D9  | Observabilidad       | C: registros y script de alertas                       | [ADR-0095](0095-registros-retencion-y-alertas-por-script.md)             | Hecho; sin métricas ni alerta de costo                                   |
| D10 | Retención (#62)      | A: 90 días en la VM                                    | [ADR-0095](0095-registros-retencion-y-alertas-por-script.md)             | Hecho; #62 se cierra                                                     |
| D11 | SBOM y escaneo (#64) | C: al publicar                                         | [ADR-0096](0096-sbom-y-escaneo-de-imagenes-al-publicar.md)               | Hecho; #64 se cierra                                                     |
| D12 | ZAP (#65)            | A: pasivo, local, loopback                             | [ADR-0098](0098-verificacion-de-cabeceras-sin-staging.md)                | `accepted`; #65 abierta                                                  |
| D13 | Gemini               | C: demo cerrada con la capa gratuita                   | [ADR-0066](0066-modelos-por-tipo-de-nodo-y-capa-gratuita-de-gemini.md)   | LLM02 `accepted`                                                         |
| D14 | Correo               | A: OCI Email Delivery                                  | [ADR-0093](0093-secretos-en-oci-vault.md), `docs/operations/oracle.md`   | Hecho; correo entregado; IAM corregido                                   |
| D15 | Acceso del operador  | A: SSH, `fail2ban` y `ssh -L`                          | [ADR-0091](0091-temporal-en-produccion.md)                               | Hecho                                                                    |
| D16 | Aprovisionamiento    | A: scripts y cloud-init                                | [ADR-0097](0097-reglas-de-cortafuegos-fuera-de-ufw.md)                   | Hecho; cortafuegos corregido en #81                                      |
| D17 | Reversa              | A: digests y volcado previo en la VM                   | [ADR-0094](0094-despliegue-automatico-reversa-y-sin-backups.md)          | Hecho                                                                    |
| D18 | #61 MFA              | A: fuera de F9                                         | [ADR-0088](0088-riesgos-aceptados-y-diferidos-a-f9.md)                   | Abierta; revisión posterior                                              |
| D19 | #66                  | A: fuera de F9                                         | [ADR-0088](0088-riesgos-aceptados-y-diferidos-a-f9.md)                   | Abierta; revisión posterior                                              |
| D20 | #67                  | Sin métricas                                           | [ADR-0095](0095-registros-retencion-y-alertas-por-script.md)             | `accepted`; #67 abierta                                                  |
| D21 | #68                  | B: sin frecuencia mínima                               | [ADR-0085](0085-tope-del-reconciliador-y-eventos-de-seguridad-nuevos.md) | `accepted`; #68 abierta                                                  |
| D22 | Alcance              | A: cinco PR                                            | `specs/010-deployment/plan.md`                                           | PR 1 a 5                                                                 |
| D23 | Registro cerrado     | A: Caddy responde 404 a `register`, cuentas por script | [ADR-0090](0090-imagen-de-borde-mismo-origen-y-url-relativa.md)          | Hecho; verificado en producción                                          |

### ADR-0088 fila por fila

| Fila de ADR-0088                                    | Desenlace al cerrar F9                                                                                    |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Sin MFA ni TOTP (A07, #61)                          | `accepted`, sin cambio; revisión posterior a F9. Issue abierta                                            |
| Auditoría como eventos de log (A09, #62)            | Cumplida: retención de 90 días y alertas por correo (D10A). Sin tabla de auditoría (`accepted`). Cerrada  |
| Temporal, PostgreSQL y Valkey sin auth ni TLS (#63) | Cumplida: mTLS, `hostssl` con `scram-sha-256`, TLS y ACL; prueba con certificados efímeros en CI. Cerrada |
| Sin SBOM ni escaneo de imágenes (A03, #64)          | Cumplida: escaneo y SBOM CycloneDX al publicar. Cerrada                                                   |
| ZAP activo, con sesión y contra staging (#65)       | `accepted` (D2, D12; [ADR-0098](0098-verificacion-de-cabeceras-sin-staging.md)). Issue abierta            |
| Ejecución `failed` tras fallo de Temporal (#66)     | `accepted`, sin cambio; revisión posterior. Issue abierta                                                 |
| Disparos fuera del catch-up sin métrica (#67)       | `accepted` (D20): no hay métricas. Issue abierta                                                          |
| Sin frecuencia mínima de la cron (#68)              | `accepted` (D21B). Issue abierta                                                                          |
| Capa gratuita de Gemini (LLM02)                     | `accepted` (D13C): demo cerrada, solo datos de prueba                                                     |
| Webhook con token en la URL, sin HMAC (A08)         | `accepted`; TLS y redacción del token en Caddy cumplidas                                                  |
| Cabeceras de la web                                 | Cumplida y verificada en local (ZAP) y en producción (`curl`)                                             |

ADR-0088 se marca como cumplido en lo que tenía de requisito para F9 y se conserva como histórico; lo que sigue vigente vive en la tabla anterior y en el modelo de amenazas v3.0.

### Riesgos aceptados al cerrar

Todos tienen como dueño al autor. La revisión «antes de admitir datos reales» es la condición de la constitución 1.1.0: los backups externos son obligatorios solo antes de admitir datos reales.

| Riesgo                                                                 | Revisión                                                       |
| ---------------------------------------------------------------------- | -------------------------------------------------------------- |
| Pérdida total de datos y de `CREDENTIALS_MASTER_KEY` sin copias (D5)   | Antes de admitir datos reales                                  |
| Despliegue automático sin staging (D2, D3)                             | Antes de admitir datos reales                                  |
| ZAP sin análisis activo ni sesión (D12, #65)                           | Si se crea un entorno de pruebas, o antes de abrir el registro |
| LLM02 con la capa gratuita de Gemini (D13)                             | Antes de abrir el registro o admitir datos reales              |
| Sin alerta de costo ni métricas (D9)                                   | Posterior a F9                                                 |
| Disparos descartados sin métrica (D20, #67)                            | Posterior a F9                                                 |
| Cron sin frecuencia mínima (D21, #68)                                  | Posterior a F9                                                 |
| Registro, secretos y correo en la misma cuenta de Oracle (D1, D4, D14) | Antes de admitir datos reales                                  |
| Sin copia externa de los registros (D10)                               | Antes de admitir datos reales                                  |
| Memoria de producción sin medir (T052)                                 | Al medirla con la prueba de humo                               |
| Reconstrucción en una VM limpia sin medir (T055)                       | Al liberar cuota Always Free o antes de datos reales           |

### Lo que no se midió

- **T052, memoria:** no se ha medido el consumo real. `docs/operations/memory.md` y [PLAN §9](../PLAN.md) llevan la tabla marcada «pendiente de medir», con el procedimiento (`docker stats --no-stream` y `free -m`). SC-010 queda sin comprobar en su parte de consumo; la suma de límites (3 328 MB de permanentes) sí cumple ≤ 6 GB y lo fija `deploy-config.test.ts`.
- **T055, reconstrucción en VM limpia:** no se hizo. La cuota Always Free está ocupada por la VM actual y no hay una segunda donde ensayar. El procedimiento está escrito en `docs/operations/rebuild.md`; el tiempo no está medido. Se acepta como riesgo, con revisión al liberar cuota.
- **SC-009, SPF, DKIM y DMARC:** el correo de verificación se entregó por OCI Email Delivery con los tres registros configurados; el resultado `pass` de las tres comprobaciones en las cabeceras de un mensaje recibido debe confirmarlo el autor y anotarlo en la PR.

### Lecciones del primer despliegue

Sin staging, la primera vez que algo llegó a una VM real fue el despliegue de producción, y falló en capas que ninguna prueba local ve. Cada incidente se corrigió y quedó una prueba o una guía:

1. **Cortafuegos (#81, [ADR-0097](0097-reglas-de-cortafuegos-fuera-de-ufw.md)):** instalar `ufw` desinstala `iptables-persistent`; las reglas de Oracle siguen en memoria con un `REJECT icmp-host-prohibited` que bloqueaba el 80 y el 443; la cadena `InstanceServices` ya no se cargaba tras un reinicio; y los contenedores alcanzaban `169.254.169.254` y, con él, el token del instance principal. Se resolvió con `deploy/provision/firewall.sh` y una unidad `systemd`.
2. **Resolución de digests (#82):** la resolución de los digests de las imágenes usaba `--format` y falló en la VM. Ahora se resuelve sin `--format` y el despliegue aborta si no obtiene un digest.
3. **Permisos y rutas por release (#83):** `ca.crt` no era legible por los contenedores y se verifica cada archivo montado tras obtenerlo; `deploy.sh` se ejecuta desde un export por SHA; el límite de pollers del namespace de Temporal estaba por debajo de los que abre el worker; y un archivo montado que cambiaba no recreaba el contenedor, lo que se resolvió con rutas por release.
4. **IAM de Oracle:** la regla del dynamic group, `read secret-family` para leer los secretos, el usuario del remitente fuera de su grupo y la línea `use approved-senders` para el correo. Quedaron en `docs/operations/oracle.md`.
5. **Red de Oracle:** una regla de la security list con 433 en lugar de 443.

Regla que queda: lo que solo existe en la VM (reglas del proveedor, IAM, red) se documenta como prerrequisito y se comprueba en el primer despliegue; lo demás se prueba en local y en CI.

## Consecuencias

- Bueno: demo cerrada con TLS, cabeceras verificadas en cada despliegue, despliegue automático con reversa, secretos fuera del repositorio y del disco, y alertas por correo, todo sobre la capa gratuita.
- Bueno: modelo de amenazas v3.0 y matriz OWASP sin filas diferidas; `pnpm security:evidence` rechaza cualquiera que reaparezca.
- Bueno: los incidentes del primer despliegue quedan como lecciones con su corrección.
- Malo: dos criterios de F9 sin medir (T052, T055) y una parte de SC-009 por confirmar.
- Malo: sin backups, una VM perdida es una base perdida; la demo solo admite datos de prueba y el aviso está en la web.
- Malo: un solo proveedor concentra imágenes, secretos, correo y VM.

## Confirmación

`pnpm security:evidence` (20 de 20 filas, sin filas diferidas ni rutas inexistentes) y `scripts/test/unit/check-evidence.test.ts`. Los escenarios del quickstart se registraron en la PR 5 (T062). Los 6 checks de CI siguen requeridos y pasan en cada PR de la fase.

## Enlaces

- [ADR-0088](0088-riesgos-aceptados-y-diferidos-a-f9.md), [ADR-0089](0089-ocir-como-registro-y-etiquetado-por-digest.md) a [ADR-0097](0097-reglas-de-cortafuegos-fuera-de-ufw.md) y [ADR-0098](0098-verificacion-de-cabeceras-sin-staging.md).
- [Modelo de amenazas v3.0](../threat-model.md), [matriz OWASP](../security/owasp-evidence.md) y [guía de operación](../operations/README.md).
- `specs/010-deployment/` (spec, plan, research, tasks y quickstart) y la constitución 1.1.0.
- Issues #61 a #68; PR de F9: #75 a #83.
