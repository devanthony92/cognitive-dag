---
status: accepted
date: 2026-11-11
decision-makers: autor
---

# Secretos en OCI Vault, volcados a un tmpfs al arrancar y con fallo cerrado

## Contexto y problema

La aplicación lee todos sus secretos de archivos (`*_FILE`, PR 1) y el Compose los monta como `secrets`
(PR 3). Falta decidir dónde viven de verdad, cómo llegan a la VM y qué pasa si no pueden llegar. El
repositorio es público y gitleaks revisa todo el historial: ningún valor, ni de ejemplo, puede entrar (FR-014).

## Opciones consideradas

- Archivos en la VM con copia cifrada del autor (recomendación inicial A de `research.md`): portable, pero un
  secreto generado vive solo en un disco.
- **OCI Vault con identidad de instancia (elegida, D4B).**
- Secretos de GitHub Environments inyectados al desplegar: pasan por CI y su registro, y no sirven para lo
  que genera la propia VM.

## Decisión

- **Vault:** cada secreto es `cdag-<nombre>`. El operador los carga desde su máquina
  (`deploy/provision/secrets.sh init-generated | put | list`) con su propio perfil de la CLI de OCI; la
  política de la VM (`read secret-bundles`, grupo dinámico `cognitive-dag-vm`) es **solo de lectura**. La VM no
  tiene llaves de API: usa la identidad de instancia (`--auth instance_principal`).
- **Volcado a `tmpfs`:** `cognitive-dag-secrets.service` (oneshot, `RuntimeDirectory=cognitive-dag`) ejecuta
  `secrets.sh fetch`, que comprueba que el destino es `tmpfs`/`ramfs` (si no, se niega antes de pedir nada),
  lee los 12 secretos en un directorio de preparación y solo cuando están todos lo mueve a
  `/run/cognitive-dag/secrets` (directorio `0700`, archivos `0444`, el token de OCIR `0400`). Si el Vault no
  responde o falta un secreto, **sale con error y no deja nada**: la pila no arranca con valores viejos
  (`cognitive-dag.service` exige esa unidad). Los archivos son `0444` y no `0600` (FR-015 decía `0600`)
  porque los contenedores corren con otros usuarios y Compose no aplica `uid`, `gid` ni `mode` a secretos de
  archivo (ADR-0092): el control de acceso es el directorio `0700` y que viven en memoria.
- **PKI:** `pki_ca_key` y `pki_ca_crt` también están en el Vault. `fetch` los usa para emitir hojas nuevas en
  cada volcado (`pki.sh init` con la CA que existe) en `/run/cognitive-dag/pki` y borra la clave de la CA al
  terminar; la clave de la CA nunca queda en el disco de la VM.
- **Nada se imprime:** los valores solo se leen para pasarlos a un archivo o a un comando por entrada
  estándar (el token de OCIR a `docker login --password-stdin`, las credenciales SMTP a `curl -K -`). La
  sesión de `docker` vive en el `tmpfs` (`DOCKER_CONFIG`). `provision.sh` no toca secretos.
- **Aprovisionamiento (D16A):** `provision.sh` es idempotente, no escribe en el árbol del repositorio y
  tiene una prueba que lo repite y compara el resultado (`provision.test.ts`). `cloud-init.yaml` solo escribe
  constantes no secretas. El correo de destino de las alertas y el dominio son configuración de la VM
  (`local.env`), fuera del repositorio.

## Consecuencias

- Bueno: ningún secreto en el repositorio, en las imágenes, en `docker inspect` ni en el disco de la VM;
  rotación con un procedimiento por secreto (`docs/operations/secrets.md`); fallo cerrado.
- Malo: dependencia de Oracle (Vault, identidad de instancia); la CLI de OCI se instala con `pip` en un
  _virtualenv_ (versión fijada, dependencias transitivas sin fijar) y es la pieza de cadena de suministro más
  débil de la VM; el valor viaja como argumento en base64 en la máquina del operador un instante; los archivos
  enlazados no ven una rotación hasta recrear el contenedor; sin backups (D5), lo que el Vault pierda y no se
  pueda regenerar lo repone el autor.

## Confirmación

`scripts/test/unit/provision.test.ts`: `fetch` escribe solo en `tmpfs`, falla cerrado sin dejar nada, no
imprime valores y usa la identidad de instancia; las órdenes del operador no pisan secretos existentes ni
imprimen valores. `gitleaks` sigue pasando sobre todo el historial.

## Enlaces

- D4B, D16A, FR-014 a FR-016 en `specs/010-deployment`; ADR-0092 (PKI) y ADR-0091.
