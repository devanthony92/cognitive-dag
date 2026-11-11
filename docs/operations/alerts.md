# Registros, alertas y respuesta

Decisiones D9C y D10A, ADR-0095. Sin métricas ni agente de observabilidad: la observabilidad de F9 son
**registros estructurados y alertas por correo desde un script** (FR-027, FR-028).

## Registros

- API, worker y Caddy escriben JSON a la salida estándar del contenedor (rotado por el motor,
  `max-size`/`max-file`). Los eventos de seguridad llevan `event`, `outcome`, `organizationId`, `userId`,
  `ip` y `correlationId`; **nunca** contenido de usuario ni secretos (lo prueba
  `apps/api/test/integration/log-redaction.test.ts`). Caddy redacta el token de `/api/v1/hooks/*` y las
  cabeceras `Cookie` y `Authorization`.
- Cada 5 minutos `alerts.sh archive` añade las líneas nuevas de `api`, `worker` y `edge` a
  `/var/log/cognitive-dag/<servicio>.log`, sin perder ni repetir líneas (cursor en
  `/var/lib/cognitive-dag/alerts/archive.cursor`).
- `logrotate` rota a diario, comprime y conserva **90 días** (`/etc/logrotate.d/cognitive-dag`). Los
  registros contienen IP; no hay copia fuera de la VM (D5) ni envío a terceros (D9C).

Comandos de consulta, por `event`, `organizationId` y `correlationId`:

```bash
grep -h '"event":"auth.rate_limited"' /var/log/cognitive-dag/api.log
zgrep -h '"organizationId":"<id>"' /var/log/cognitive-dag/api.log*
zgrep -h '"correlationId":"<uuid>"' /var/log/cognitive-dag/*.log*
```

## Alertas

`cognitive-dag-alerts.timer` ejecuta cada 5 minutos `alerts.sh archive` y `alerts.sh check`. El correo sale
por el mismo relé SMTP de la aplicación (STARTTLS con autenticación) hacia `ALERT_EMAIL_TO`, que está en
`/etc/cognitive-dag/local.env`, fuera del repositorio. Una misma alerta no se repite durante
`ALERT_COOLDOWN_MINUTES` (60) y, si la condición se despeja, la próxima vez avisa de inmediato. Si el
correo no se puede enviar, la unidad falla (`systemctl --failed`).

| Alerta        | Se dispara cuando                                                                                 | Umbral (variable, valor por defecto)                       |
| ------------- | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `auth`        | más de N eventos `auth.login_failed` o `auth.rate_limited` en una ventana deslizante sobre `time` | `ALERT_AUTH_THRESHOLD` (20) en `ALERT_WINDOW_MINUTES` (10) |
| `service`     | un servicio falta, no está `running` o está `unhealthy`                                           | —                                                          |
| `certificate` | un certificado interno vence en menos de N días                                                   | `ALERT_CERT_MIN_DAYS` (30)                                 |
| `disk`        | el disco de `ALERT_DISK_PATH` (`/`) llega al N %                                                  | `ALERT_DISK_PERCENT` (85)                                  |

**No hay alerta de costo** (D9C): con la capa gratuita de Gemini el gasto es cero y la defensa es la cuota;
el worker falla con códigos de presupuesto y de límite de tasa que quedan en los registros. Límite
conocido: si Oracle Email Delivery o la VM caen, la alerta no sale.

## Qué hacer ante cada alerta

- **`auth`**: ¿un ataque o un usuario que olvidó su contraseña? Busca el origen:
  `grep -h '"event":"auth.login_failed"' /var/log/cognitive-dag/api.log | grep -o '"ip":"[^"]*"' | sort | uniq -c | sort -rn | head`.
  Si es una IP, bloquéala: `sudo ufw insert 1 deny from <ip>`. El límite de tasa de la API ya frena los intentos.
- **`service`**: `deploy/ops/doctor.sh` y `deploy/ops/compose.sh logs --since 15m <servicio>`. Un reinicio
  suelto: `compose.sh restart <servicio>`. Si empezó con un despliegue: `rollback.sh`.
- **`certificate`**: rota las hojas ([secrets.md](./secrets.md#certificados-internos-pki-adr-0092)).
- **`disk`**: `df -h`, `du -sh /var/lib/docker /var/log/cognitive-dag /var/lib/cognitive-dag/dumps`; los volcados
  previos (3) y los registros (90 días) son lo primero a revisar; `docker image prune -a` libera imágenes viejas.

## Probar cada alerta

Sin esperar a que ocurran, en la VM como `cdag-deploy` (`ALERT_EMAIL_TO` ya configurado). Cada prueba debe
terminar con un correo y, tras repetirla, sin un segundo correo dentro del enfriamiento:

```bash
A=/opt/cognitive-dag/deploy/ops/alerts.sh
ALERT_DISK_PERCENT=0 $A check            # disco: siempre dispara
ALERT_CERT_MIN_DAYS=120 $A check         # certificado: las hojas duran 90 días
ALERT_AUTH_THRESHOLD=-1 $A check         # auth: cualquier valor por encima de -1 dispara
/opt/cognitive-dag/deploy/ops/compose.sh stop worker && $A check   # servicio: falta el worker
/opt/cognitive-dag/deploy/ops/compose.sh start worker              # y se recupera
rm -f /var/lib/cognitive-dag/alerts/*.sent                         # reinicia el enfriamiento
```

Si no llega el correo: `journalctl -u cognitive-dag-alerts -n 50`, revisa SPF/DKIM/DMARC del dominio de
envío ([oracle.md](./oracle.md)) y la carpeta de correo no deseado.
