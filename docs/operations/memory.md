# Memoria: presupuesto y medición (T052, SC-010)

> **Estado: medido en reposo (2026-11-12); la prueba de humo con carga sigue pendiente.** El uso máximo en reposo es el del worker, 27,7 % de su límite; los límites tienen margen holgado y no se cambian.

Los límites de `deploy/compose.prod.yaml` salen del presupuesto de `specs/010-deployment/research.md`. Medición del 2026-11-12 con `docker stats --no-stream`, tras el despliegue de `deccebb`, **en reposo y sin carga** (la columna con la prueba de humo queda pendiente). SC-010: el consumo medido debe quedar por debajo del 60 % de los límites y la suma de límites por debajo del 50 % de los 12 GB.

| Servicio                         | Límite (`mem_limit`) | Medido en reposo     | Medido con la prueba de humo | % del límite       |
| -------------------------------- | -------------------- | -------------------- | ---------------------------- | ------------------ |
| edge (Caddy)                     | 128 MB               | 11,4 MiB             | _pendiente_                  | 8,9 % (en reposo)  |
| api                              | 512 MB               | 82,55 MiB            | _pendiente_                  | 16,1 % (en reposo) |
| worker                           | 768 MB               | 212,5 MiB            | _pendiente_                  | 27,7 % (en reposo) |
| postgres                         | 768 MB               | 91,3 MiB             | _pendiente_                  | 11,9 % (en reposo) |
| valkey                           | 192 MB               | 4,38 MiB             | _pendiente_                  | 2,3 % (en reposo)  |
| temporal                         | 768 MB               | 90,39 MiB            | _pendiente_                  | 11,8 % (en reposo) |
| temporal-ui                      | 192 MB               | 6,61 MiB             | _pendiente_                  | 3,4 % (en reposo)  |
| migrator y tareas de un solo uso | 256 MB c/u           | no aplica (terminan) | no aplica                    | no aplica          |
| **Suma de los permanentes**      | 3 328 MB             | 499,1 MiB            | _pendiente_                  | 15,0 % (en reposo) |

Memoria de la VM en el mismo momento (`free -m`, MiB): total 11 925, usada 1 230, libre 4 570, caché 6 391, disponible 10 694, swap 0.

Recomendación (no aplicada): ningún servicio pasa del 28 % de su límite en reposo, así que no hace falta subir ninguno. Bajar límites solo tendría sentido tras la prueba de humo con carga; hasta entonces se dejan como están.

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
