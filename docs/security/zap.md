# ZAP baseline

Evidencia de F8 (decisión 6A, FR-013 a FR-015, ADR-0086). OWASP ZAP baseline **pasivo**, local y sin
sesión, ejecutado a mano con un script. No hay workflow de CI ni check requerido para ZAP.

## Alcance

| Dentro de F8                                                                                                   | Diferido a F9 (issue #65)             |
| -------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| Reglas pasivas sobre lo que la araña y la semilla alcanzan                                                     | Análisis activo (`zap-full-scan`)     |
| API y web en loopback (`127.0.0.1`)                                                                            | Staging con TLS, Caddy y dominio real |
| Sin sesión: las rutas autenticadas responden 401, que es lo correcto                                           | Análisis con sesión iniciada          |
| Rutas públicas de la API sembradas: salud, `features`, sesión, login, restablecimiento de contraseña y webhook | Workflow de CI para ZAP               |

El script rechaza (código 2) cualquier destino que no sea `localhost`, `127.0.0.1` o `[::1]`. No hay
ninguna llamada a Gemini ni a terceros: el worker corre con `LLM_ENABLED=false`. La prueba
`scripts/test/unit/zap-script.test.ts` lo fija.

## Procedimiento

1. `docker compose up -d --wait` y `pnpm db:migrate`.
2. `pnpm turbo run build`.
3. Levantar la API y el worker desde `dist` con `WEB_ORIGIN=http://127.0.0.1:4173` y
   `LLM_ENABLED=false` (`node --env-file=../../.env dist/main.js` en `apps/api` y `apps/worker`), y la
   web construida: `pnpm exec vite preview --host 127.0.0.1 --port 4173` en `apps/web`.
4. `bash scripts/security/zap-baseline.sh` (Git Bash o Linux).

Variables: `ZAP_API_URL` (por defecto `http://127.0.0.1:3000`), `ZAP_WEB_URL`
(`http://127.0.0.1:4173`), `ZAP_OUT_DIR` (`docs/security/zap`), `ZAP_SPIDER_MINUTES` (2) y
`ZAP_DRY_RUN=1` para ver el plan sin ejecutar.

La imagen es la oficial de Docker Hub (`zaproxy/zap-stable`), fijada por digest en el script. Para
actualizarla se cambia el digest a propósito. Con `--network host` el contenedor ve el `localhost`
del anfitrión; el script de semilla es `.zap/seed-hook.py` y las decisiones por regla,
`.zap/rules.tsv`.

**Docker Desktop en Windows.** El modo `host` está desactivado por defecto y apunta a la VM, no a
Windows. Sin tocar la configuración de Docker, se pone un relé en la VM que reenvía a Windows y todo
el tráfico sigue en la máquina:

```bash
for p in 3000 4173; do
  docker run -d --rm --name zap-relay-$p --network host alpine/socat \
    TCP-LISTEN:$p,bind=127.0.0.1,fork,reuseaddr TCP:host.docker.internal:$p
done
# ... script ...
docker rm -f zap-relay-3000 zap-relay-4173
```

**Límites de tasa.** Los de login (espera progresiva por cuenta) y webhook (60 por minuto por trigger,
20 intentos fallidos por 100 s y dirección) son constantes de `RATE_RULES`, no variables de entorno,
así que el script no relaja ninguno: la araña solo emite GET y la semilla envía 5 peticiones. Los
valores de producción no se tocan. El script imprime esto al empezar.

**Secretos.** Tras ejecutar, el script busca en el informe el valor de cada variable de `.env` que
termine en `KEY`, `SECRET`, `PASSWORD` o `TOKEN` y falla si aparece. El informe de la corrida de F8 no
contiene cookies, cabeceras de autorización ni valores de `.env` (revisado a mano además).

## Resultado de la corrida de F8

Fecha: 2026-11-08, ZAP 2.17.0, estado final de las PR 1 a 3 (`ade336e`). Informe en
[`docs/security/zap/`](zap/): `zap-report.json` y `zap-report.md` (el HTML se regenera y no se versiona). 61 reglas
pasaron sin alerta.

| Origen               | Alertas                                                                                              |
| -------------------- | ---------------------------------------------------------------------------------------------------- |
| API `127.0.0.1:3000` | Solo informativas: respuestas no almacenables (correcto) y una almacenable. **Cero medias o altas.** |
| Web `127.0.0.1:4173` | 2 medias, 6 bajas y 3 informativas, todas de cabeceras del servidor estático o del bundle            |

### Decisión por alerta de nivel medio o alto

| Regla                       | Riesgo | Ruta    | Decisión | Razón                                                                                                                                                                                                                                                          | Dueño | Revisión           |
| --------------------------- | ------ | ------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | ------------------ |
| 10038 CSP no definida       | Media  | web `/` | Aceptada | La web son archivos estáticos que sirve `vite preview`, que no pone cabeceras de seguridad; el origen real será Caddy en F9, que debe fijar una CSP (`default-src 'self'`, sin `unsafe-inline` en scripts). La CSP de Helmet protege a la API, que ya la tiene | autor | F9, contra staging |
| 10020 sin anti-clickjacking | Media  | web `/` | Aceptada | Mismo origen: se resuelve con `frame-ancestors 'none'` en la CSP de Caddy y `X-Frame-Options: DENY`. La API ya envía `X-Frame-Options: SAMEORIGIN`                                                                                                             | autor | F9, contra staging |

Las medias de la API están a cero, así que esta corrida no exigió ningún cambio de código ni una
prueba de regresión nueva (T041). La superficie de la API que ZAP ve limpia queda fijada por
`apps/api/test/integration/security-surface.test.ts` (cabeceras de Helmet y atributos de la cookie
de sesión). La prueba `zap-script.test.ts` comprueba además que toda alerta media o alta del informe
versionado tiene una regla en `.zap/rules.tsv` y una fila en esta tabla.

### Alertas bajas e informativas

| Regla                                  | Riesgo      | Decisión          | Razón                                                                  |
| -------------------------------------- | ----------- | ----------------- | ---------------------------------------------------------------------- |
| 10021 `X-Content-Type-Options` ausente | Baja        | Aceptada hasta F9 | Cabecera de Caddy; la API la envía (`nosniff`)                         |
| 10063 `Permissions-Policy` ausente     | Baja        | Aceptada hasta F9 | Cabecera de Caddy                                                      |
| 90004 COEP, COOP y CORP                | Baja        | Aceptada hasta F9 | Cabeceras de Caddy; la API ya envía COOP y CORP `same-origin`          |
| 10096 Timestamp Unix                   | Baja        | Falso positivo    | Un número del bundle minificado, no una marca de tiempo                |
| 10027, 10109, 10049                    | Informativa | Sin acción        | Comentarios del bundle, aplicación moderna y caché de HTML/JS estático |

## Resultado de la corrida de F9 (T037)

Fecha: 2026-11-09, ZAP 2.17.0 (misma imagen fijada por digest), pasivo, sin sesión y solo sobre loopback. El script y su prueba no cambian: no se amplía ningún host. Estado final de la PR 3 de F9.

- **Web:** la imagen de borde real (`deploy/caddy/local.Caddyfile`, que importa `deploy/caddy/site.caddy`, el mismo sitio que usa producción) en `http://127.0.0.1:8081`, con la SPA de la imagen y `/api/*` hacia la API. Local y por HTTP porque ZAP no confía en una CA local; las cabeceras son las de producción (HSTS aparte, que solo cuenta sobre HTTPS y ZAP no evalúa aquí).
- **API:** `http://127.0.0.1:3000`, directa, como en F8.
- **Resultado:** 67 reglas pasaron sin alerta, **0 alertas bajas, medias o altas**. Quedan 4 informativas (10109 aplicación moderna, 10049 caché de contenido no almacenable o no cacheable), las mismas de F8 y sin acción.

| Alerta de F8                   | Estado                                                                                                                           |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| 10038 CSP no definida          | **Cerrada**: `Content-Security-Policy` con `default-src 'self'` y sin `unsafe-inline` en `script-src`                            |
| 10020 sin anti-clickjacking    | **Cerrada**: `frame-ancestors 'none'` y `X-Frame-Options: DENY`                                                                  |
| 10021 `X-Content-Type-Options` | **Cerrada**: `nosniff`                                                                                                           |
| 10063 `Permissions-Policy`     | **Cerrada**                                                                                                                      |
| 90004 COEP, COOP y CORP        | **Cerrada**: `require-corp`, `same-origin`, `same-origin` (la web sigue funcionando aislada: `crossOriginIsolated` es verdadero) |

No hay alertas nuevas, así que no hay decisión por alerta nueva. Las reglas de `.zap/rules.tsv` siguen en `WARN`: si alguna cabecera vuelve a faltar, aparece. Comprobaciones de navegador contra la misma imagen (SPA, inicio de sesión, lista de workflows y editor de React Flow): ninguna violación de CSP.

El informe de esta corrida sustituye en `docs/security/zap/` al de F8 (que queda en el historial de git). Para repetirla: construir la imagen de borde, arrancarla con `local.Caddyfile` (`docker run -v $PWD/deploy/caddy/local.Caddyfile:/etc/caddy/Caddyfile:ro -p 127.0.0.1:8081:8081 --add-host api:host-gateway`), levantar la API como en el procedimiento anterior con `WEB_ORIGIN=http://127.0.0.1:8081` y ejecutar `ZAP_WEB_URL=http://127.0.0.1:8081 bash scripts/security/zap-baseline.sh`.

## Qué quedaba para F9 (resuelto arriba, salvo el análisis activo)

- Ejecutar el mismo script contra staging (`ZAP_API_URL` y `ZAP_WEB_URL` hoy solo admiten loopback; F9
  decide cómo ampliar la lista con una prueba que lo cubra) y confirmar que 10038, 10020, 10021,
  10063 y 90004 desaparecen con las cabeceras de Caddy.
- Decidir si se añade análisis activo y análisis con sesión iniciada (issue #65).
