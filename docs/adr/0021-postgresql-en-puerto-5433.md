---
status: accepted
date: 2026-10-28
decision-makers: autor
---

# PostgreSQL de desarrollo en el puerto de host 5433

## Contexto y problema

El sistema principal de desarrollo es Windows, donde es habitual tener un PostgreSQL instalado en
el puerto 5432. Publicar el contenedor en el mismo puerto choca con ese servicio o, peor, hace que el API se
conecte al servidor equivocado y falle la autenticación sin un mensaje claro.

## Opciones consideradas

- Mantener 5432 y pedir al desarrollador que detenga su servicio local.
- Puerto 5433 configurable en el host, 5432 dentro del contenedor.

## Decisión

`compose.yaml` publica `127.0.0.1:${POSTGRES_HOST_PORT:-5433}:5432`. `.env.example` fija
`POSTGRES_HOST_PORT=5433` y `DATABASE_URL` apunta a `127.0.0.1:5433`. El README documenta cómo
cambiarlo.

## Consecuencias

- Bueno: no choca con instalaciones locales; el mapeo sigue enlazado solo a `127.0.0.1`.
- Malo: un puerto no estándar que recordar; las herramientas externas deben usar 5433.
- La URL de conexión y el puerto publicado deben cambiarse juntos.

## Enlaces

- `compose.yaml`, `.env.example`, `README.md`.
