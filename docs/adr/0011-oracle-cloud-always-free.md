---
status: accepted
date: 2026-10-28
decision-makers: autor
---

# Oracle Cloud Always Free (Ampere A1) como hosting (D10)

## Contexto y problema

El stack (Temporal, PostgreSQL, API, worker, Valkey) debe correr en un host gratuito o de muy bajo
costo para una demo pública.

## Opciones consideradas

- Google Cloud free tier (1 e2-micro, 1 GB de RAM): insuficiente para el stack.
- Oracle Cloud Always Free, Ampere A1 (2 OCPU, 12 GB de RAM).
- VPS de pago bajo (por ejemplo, Hetzner).

## Decisión

Oracle Cloud Always Free sobre ARM, con despliegue portable (Compose, script de aprovisionamiento
y backups fuera de la VM) para migrar en horas si la capa gratuita cambia. Despliegue en la fase F9.

## Consecuencias

- Bueno: recursos suficientes sin costo.
- Malo: la capa gratuita puede cambiar o reclamarse; hay que mantener compatibilidad arm64.
- Consecuencia ya aplicada en F0: imágenes sobre Debian y CI en amd64 y arm64
  ([ADR-0023](0023-imagenes-de-contenedor-sobre-debian.md)).

## Enlaces

- `docs/PLAN.md` §2 (D10) y §9.
