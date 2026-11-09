# Contrato del borde (Caddy)

Fuente: ZAP 10038, 10020, 10021, 10063 y 90004 ([zap.md](../../../docs/security/zap.md)), ADR-0088 y
`docs/PLAN.md` §9. Estos valores son la **propuesta** que fija `scripts/test/unit/deploy-config.test.ts`;
los ajustes que exija el build real (por ejemplo `style-src-attr`) se registran en el ADR-0090.

## Por ruta

| Ruta                              | Quién responde       | Cabeceras que añade Caddy                                                                                                   | Notas                                                                                                       |
| --------------------------------- | -------------------- | --------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `http://*` (puerto 80)            | Caddy                | —                                                                                                                           | `301` a `https://` con la misma ruta; ningún contenido ni cookie                                            |
| `/` y rutas de la SPA             | Caddy (archivos)     | Conjunto completo de la tabla siguiente + `Cache-Control: no-cache` para `index.html`                                       | Rutas desconocidas de la SPA devuelven `index.html` con `200`                                               |
| `/assets/*` (archivos con hash)   | Caddy (archivos)     | Conjunto completo + `Cache-Control: public, max-age=31536000, immutable`                                                    | Sin compresión doble                                                                                        |
| `/api/*`                          | API (`reverse_proxy`) | Solo HSTS y `Strict-Transport-Security`; **no** pisa las cabeceras de Helmet de la API                                       | `X-Forwarded-For` y `X-Forwarded-Proto` los fija Caddy; el cliente no puede falsearlos                       |
| `/api/v1/organizations/*/runs/*/events` (SSE) | API       | Igual que `/api/*`                                                                                                           | `flush_interval -1`, sin compresión de `text/event-stream`, plazo de lectura mayor que el latido (`SSE_HEARTBEAT_MS`) |
| `/api/v1/hooks/*`                 | API                  | Igual que `/api/*`                                                                                                           | **Token redactado** en el registro de acceso de Caddy                                                       |
| UI de Temporal (y `/api/v1/metrics` si algún día existe) | —                   | —                                                                                                                           | **No** se publican; `404` desde el borde                                                                     |

## Cabeceras de la web estática

| Cabecera                           | Valor propuesto                                                                                                                                                                     | Cierra     |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| `Content-Security-Policy`          | `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'` | 10038      |
| `X-Frame-Options`                  | `DENY`                                                                                                                                                                              | 10020      |
| `X-Content-Type-Options`           | `nosniff`                                                                                                                                                                           | 10021      |
| `Permissions-Policy`               | `camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()`                                                                                                  | 10063      |
| `Cross-Origin-Embedder-Policy`     | `require-corp`                                                                                                                                                                      | 90004      |
| `Cross-Origin-Opener-Policy`       | `same-origin`                                                                                                                                                                       | 90004      |
| `Cross-Origin-Resource-Policy`     | `same-origin`                                                                                                                                                                       | 90004      |
| `Strict-Transport-Security`        | `max-age=31536000; includeSubDomains`; sin `preload` hasta verificar subdominios                                                                                         | A02, A05   |
| `Referrer-Policy`                  | `strict-origin-when-cross-origin`                                                                                                                                                   | —          |
| `Server`                           | eliminada                                                                                                                                                                           | A02        |

Reglas: `script-src` nunca lleva `unsafe-inline` ni `unsafe-eval`. Si el build exige estilos en línea se
usa `style-src-attr 'unsafe-inline'` (solo atributos) y se registra. Si COEP rompe un recurso, se baja a
`credentialless` y se registra.

## Registro de acceso

- Formato JSON a la salida estándar del contenedor, y rotado por el motor (D9C).
- Se elimina o enmascara: segmento `{token}` de `/api/v1/hooks/{triggerId}/{token}`, y las cabeceras
  `Cookie`, `Set-Cookie`, `Authorization` y `X-CSRF-Token`. Nunca se registran cuerpos.
- Prueba: enviar un webhook con un token de prueba generado en la propia prueba y buscar ese valor en la
  salida completa de Caddy; debe aparecer 0 veces.
- Retención: 90 días como máximo en la VM (D10A); contiene IP. Rotación y compresión del motor (`max-size`, `max-file`).

## Límites

- Tamaño de cuerpo en `/api/*`: coherente con `BODY_LIMIT` de la API (100 kb) y con el tope del webhook;
  Caddy rechaza antes de llegar a la API cuando excede.
- Tiempos de lectura y escritura acotados; los de SSE, mayores que `SSE_HEARTBEAT_MS`.
