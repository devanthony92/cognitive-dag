---
status: accepted
date: 2026-11-07
decision-makers: autor
---

# Credenciales de conector con cifrado de sobre y llave maestra por entorno

## Contexto y problema

Un `http.request` necesita autenticarse ante APIs externas con tokens o claves. Esos secretos no
pueden aparecer en la definición del DAG, en logs, en el historial de Temporal, en respuestas de la
API ni en filas en claro. El worker debe poder usarlos sin devolverlos.

## Opciones consideradas

- Cifrado de la aplicación con una sola llave y sin sobre.
- Un KMS externo del proveedor de nube.
- Secretos en variables de entorno, sin base de datos.
- Cifrado de sobre con AES-256-GCM y una llave maestra por entorno (elegida, decisión 10B).

## Decisión

Cada credencial genera una llave de datos (DEK) aleatoria de 32 bytes. La DEK cifra el secreto y la
llave maestra (`CREDENTIALS_MASTER_KEY`, 32 bytes en base64) cifra la DEK. Ambos cifrados usan
AES-256-GCM con IV aleatorio de 12 bytes. Los datos autenticados adicionales son
`credential:<id>:<organization_id>`, de modo que un blob copiado a otra fila u organización no se
descifra. La base guarda la DEK envuelta, sus IV y tags, el secreto cifrado y `key_version` (1 hoy).

Tipos de cabecera, solo estos: `bearer`, `api_key_header` (con una lista de nombres prohibidos, como
`Host`, `Content-Type`, `Cookie` o `Idempotency-Key`) y `basic`. No hay credenciales en el cuerpo ni
en la consulta. El secreto admite hasta 4096 bytes.

Los endpoints devuelven solo metadatos y nunca el valor, ni al crear ni al leer. Rotar reemplaza el
secreto. Archivar pone `archived_at`, sin borrado, y un archivado se rechaza al publicar y al
ejecutar. Quién hace qué: el owner crea, rota y archiva; owner y editor listan metadatos y usan la
credencial por id. El nodo solo lleva `credentialId`. El worker descifra dentro de la activity y no
devuelve el valor. La llave maestra es obligatoria en producción. Sin ella, los endpoints responden
503 `CREDENTIALS_NOT_CONFIGURED` y los nodos fallan de forma permanente. El script `pnpm
credentials:gen-key` genera una llave válida.

Desviación: `credentialId` no está en `sensitiveFields` de `http.request` (PR #56). Si lo estuviera,
cada compilación de F6 lo marcaría como faltante. Los nodos F7 no llegan al compilador hasta F8
(ADR-0080), así que se revisará entonces.

## Consecuencias

- Bueno: un volcado de la base sin la llave maestra no revela secretos. Un blob movido de fila no se
  descifra.
- Bueno: la API nunca devuelve un valor en claro. Los eventos `credential.created`, `rotated` y
  `archived` no incluyen el valor.
- Malo: perder la llave maestra hace irrecuperables todas las credenciales. Hay que volver a
  introducir cada secreto.
- Malo: la llave vive en una variable de entorno del proceso. El despliegue (F9) debe protegerla.
- Malo: la rotación de la llave maestra está diferida. `key_version` deja el camino preparado.
- Desviación: el valor de `CREDENTIALS_MASTER_KEY` se descarta de la configuración que circula, tras
  decodificarlo (PR #56).

## Confirmación

`packages/connectors/test/crypto.test.ts` y `credential-headers.test.ts`,
`packages/db/test/credentials-projection.test.ts` (la API lee sin columnas `bytea`),
`apps/api/test/integration/credentials.e2e.test.ts`.

## Enlaces

- [Research F7](../../specs/008-triggers-human-control/research.md) (R10).
- [ADR-0038](0038-eventos-de-seguridad-en-logs.md),
  [ADR-0050](0050-contenido-de-entradas-y-salidas-solo-en-temporal.md),
  [ADR-0076](0076-anti-ssrf-y-allowlist-de-hosts.md),
  [ADR-0078](0078-http-request-limites-clasificacion-e-idempotencia.md).
