---
status: accepted
date: 2026-11-11
decision-makers: autor
---

# Reglas de cortafuegos fuera de ufw: InstanceServices y metadatos desde contenedores

## Contexto y problema

Al aprovisionar la VM real (Ubuntu 24.04 aarch64, imagen de Oracle) apareció esto:

1. Instalar `ufw` desinstala `iptables-persistent` y `netfilter-persistent`. Las reglas de Oracle siguen
   cargadas en memoria, entre ellas un `REJECT --reject-with icmp-host-prohibited` al final de `INPUT` y de
   `FORWARD` que queda antes de las cadenas de `ufw` y bloquea el 80 y el 443. `harden.sh` llamaba a
   `netfilter-persistent reload`, que ya no existe.
2. La cadena `InstanceServices` de Oracle (reglas sobre `169.254.0.0/16` que dejan hablar con iSCSI y con
   los metadatos solo a `root`) vive en `/etc/iptables/rules.v4`, que nada carga ya tras un reinicio.
3. El tráfico de los contenedores pasa por `FORWARD`, no por `OUTPUT`, así que `InstanceServices` no lo
   alcanza: un contenedor puede pedir a `169.254.169.254` el token del instance principal, que lee los
   secretos del Vault (SSRF hacia secretos).

## Opciones consideradas

- Reglas en `/etc/ufw/before.rules` y `after.rules`: `ufw` las carga bien en cada arranque, pero `DOCKER-USER`
  la crea Docker y puede no existir cuando `ufw` arranca, y reescribir esos archivos a mano choca con las
  actualizaciones del paquete.
- Reinstalar `iptables-persistent` junto a `ufw`: dos dueños de las mismas tablas; justo lo que falló.
- **Un script idempotente (`firewall.sh`) y una unidad `systemd` que lo aplica tras `docker.service` y
  `ufw.service` (elegida).**

## Decisión

- `deploy/provision/firewall.sh apply` quita en caliente los `REJECT icmp-host-prohibited` de `INPUT` y
  `FORWARD` (si no están, no hace nada), carga la cadena `InstanceServices` guardada y su salto desde `OUTPUT`
  y bloquea en `DOCKER-USER` el destino `169.254.0.0/16` con una cadena propia, `COGNITIVE-DAG-METADATA`,
  que deja pasar solo el DNS (UDP y TCP 53) hacia el resolvedor de la VCN, `169.254.169.254`. La salida
  normal de los contenedores (OCIR, Gemini, SMTP) no se toca.
- `harden.sh` guarda una vez la cadena `InstanceServices` en
  `/etc/cognitive-dag/oracle-instance-services.rules` (de las reglas cargadas o, si no hay, de `rules.v4` y de la
  copia `.cognitive-dag.bak`), ya no reescribe `rules.v4` y no usa `netfilter-persistent`.
- `cognitive-dag-firewall.service` (`oneshot`, `RemainAfterExit`) va `After=docker.service ufw.service`, con
  `Requires=` y `PartOf=docker.service` (un reinicio de Docker lo reaplica) y `Before=cognitive-dag.service`
  (ningún contenedor arranca sin el bloqueo).
- Es solo IPv4: el servicio de metadatos de Oracle no se sirve por IPv6.

## Consecuencias

- Bueno: sobrevive a reinicios del host y de Docker; se puede repetir sin duplicar reglas; un solo dueño por
  tabla (`ufw` sus cadenas, este script las suyas).
- Malo: si Oracle cambia las reglas de la imagen, la copia guardada queda con las de hoy (se borra el archivo y se
  corre `harden.sh` para tomarlas de nuevo); un contenedor con `network_mode: host` no pasa por `FORWARD`
  (hoy no hay ninguno).

## Confirmación

`scripts/test/unit/provision.test.ts` (grupo «firewall»): quita los `REJECT`, conserva y recarga
`InstanceServices`, bloquea `169.254.0.0/16` salvo DNS en `DOCKER-USER`, es idempotente y la unidad va en orden.

## Enlaces

- FR-016, ADR-0093; `docs/operations/provisioning.md`.
