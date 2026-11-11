---
status: accepted
date: 2026-11-11
decision-makers: autor
---

# Registros con retención de 90 días y alertas por correo desde un script

## Contexto y problema

Sin métricas ni agente de observabilidad (D9C), la visibilidad de producción son los registros
estructurados y unas pocas alertas. Los eventos de seguridad (#62) deben poder consultarse por `event`,
`organizationId` y `correlationId` durante 90 días (D10A), sin enviar nada a terceros y sin copias externas (D5).

## Opciones consideradas

- Agente de observabilidad (Loki, Prometheus, Grafana) en la VM: 1,5 GB más y otra superficie.
- Servicio externo de registros: datos de usuarios en un tercero.
- **Registros en archivos de la VM y un temporizador `systemd` que cuenta y envía correo (elegida, D9C y D10A).**

## Decisión

- **Registros:** API, worker y Caddy escriben JSON a la salida del contenedor, rotada por el motor
  (`max-size`/`max-file`). `alerts.sh archive`, cada 5 minutos, añade las líneas nuevas de `api`, `worker` y
  `edge` a `/var/log/cognitive-dag/<servicio>.log` con un cursor `[desde, ahora)`, sin perder ni repetir
  líneas. `logrotate` rota a diario, comprime y conserva **90 días** como máximo (`/etc/logrotate.d/cognitive-dag`).
  Contienen IP; no hay envío a terceros. Una prueba de integración demuestra que un canario de contenido de
  usuario no llega a los registros de la API y que los eventos de seguridad conservan `event`,
  `organizationId` y `correlationId` (`log-redaction.test.ts`, FR-027).
- **Alertas:** `cognitive-dag-alerts.timer` (cada 5 minutos) ejecuta `alerts.sh check`, que mira: fallos de
  autenticación (`auth.login_failed` y `auth.rate_limited`, con **ventana deslizante** sobre el `time` de cada
  línea, por encima de un umbral y no por debajo), servicios ausentes o no sanos, certificados internos a
  menos de 30 días (`pki.sh status`) y disco por encima de un umbral. Cada alerta produce su correo.
- **Correo:** por el relé SMTP de la aplicación (OCI Email Delivery, STARTTLS en 587, con autenticación),
  con `curl`; las credenciales llegan por `-K -` (entrada estándar), nunca como argumento. El destino
  (`ALERT_EMAIL_TO`) está en `/etc/cognitive-dag/local.env`, fuera del repositorio. Una alerta no se repite
  dentro de un periodo de enfriamiento y se reenvía de inmediato si la condición se despejó entre medias.
  Si el correo no sale, la unidad falla y se ve en `systemctl --failed`.
- **Sin alerta de costo:** con la capa gratuita de Gemini el gasto es cero y la defensa es la cuota (D13C).

## Consecuencias

- Bueno: ninguna pieza nueva permanente ni dato fuera de la VM; consultas con `grep` y `zgrep`; las
  alertas son un script de Bash con `shellcheck` y prueba contra un SMTP de prueba con STARTTLS.
- Malo: si Oracle Email Delivery o la VM caen, la alerta no sale; el archivo depende de que
  `alerts.sh archive` corra (el motor conserva 50 MB por contenedor entre pasadas); sin métricas no hay
  tendencias; el volumen de 90 días se dimensiona con la medición de T052.

## Confirmación

`scripts/test/unit/alerts.test.ts` (umbral y ventana, cada alerta con su correo, STARTTLS con autenticación,
enfriamiento y archivo) y `apps/api/test/integration/log-redaction.test.ts`.

## Enlaces

- D9C, D10A, FR-027, FR-028; #62; ADR-0094.
