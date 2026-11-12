# Memoria: presupuesto y medición (T052, SC-010)

> **Estado: pendiente de medir.** La tabla se completa con `docker stats --no-stream` y `free -m` en la VM (procedimiento más abajo).

Los límites de `deploy/compose.prod.yaml` salen del presupuesto de `specs/010-deployment/research.md`. **El
consumo real todavía no se ha medido: hace falta la VM real.** Esta tabla queda pendiente; no se inventan
cifras. SC-010: el consumo medido debe quedar por debajo del 60 % de los límites y la suma de límites por
debajo del 50 % de los 12 GB.

| Servicio                         | Límite (`mem_limit`) | Medido en reposo     | Medido con la prueba de humo | % del límite |
| -------------------------------- | -------------------- | -------------------- | ---------------------------- | ------------ |
| edge (Caddy)                     | 128 MB               | _pendiente_          | _pendiente_                  | _pendiente_  |
| api                              | 512 MB               | _pendiente_          | _pendiente_                  | _pendiente_  |
| worker                           | 768 MB               | _pendiente_          | _pendiente_                  | _pendiente_  |
| postgres                         | 768 MB               | _pendiente_          | _pendiente_                  | _pendiente_  |
| valkey                           | 192 MB               | _pendiente_          | _pendiente_                  | _pendiente_  |
| temporal                         | 768 MB               | _pendiente_          | _pendiente_                  | _pendiente_  |
| temporal-ui                      | 192 MB               | _pendiente_          | _pendiente_                  | _pendiente_  |
| migrator y tareas de un solo uso | 256 MB c/u           | no aplica (terminan) | no aplica                    | no aplica    |
| **Suma de los permanentes**      | 3 328 MB             | _pendiente_          | _pendiente_                  | _pendiente_  |

## Procedimiento de medición

Con la versión desplegada y estable:

```bash
# En reposo, tras 10 minutos sin tráfico
docker stats --no-stream --format 'table {{.Name}}\t{{.MemUsage}}\t{{.MemPerc}}'
free -m
```

Prueba de humo (carga representativa, desde tu máquina o la VM): inicia sesión, crea y publica un flujo,
lanza 20 ejecuciones seguidas con nodos LLM (cuota de Gemini permitiendo), abre la vista en vivo por SSE
en dos pestañas y dispara un webhook 50 veces. Mientras corre, repite `docker stats --no-stream` cada
30 s y anota el máximo de cada servicio. Después:

1. Rellena la tabla con el máximo observado y su porcentaje del límite.
2. Si un servicio pasa del 60 % de su límite, sube el límite en `deploy/compose.prod.yaml` (y
   `deploy-config.test.ts` comprueba que la suma siga ≤ 6 GB); si un servicio usa menos del 20 % durante
   toda la prueba, puedes bajarlo.
3. Anota la fecha, la versión (`state/current.env`) y el límite de PostgreSQL de `postgresql.conf` si lo
   ajustaste. Registra también el volumen de registros del día para dimensionar los 90 días de retención.
