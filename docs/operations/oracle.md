# Infraestructura de Oracle Cloud (T043, T050)

Estos pasos los hace el autor en la consola de Oracle (no se automatizan, FR-016) y ya están hechos; se
dejan escritos para reconstruirlos. Los valores son identificadores y nombres, no secretos. **No se
versiona la IP pública** (paso 3).

## Datos de la cuenta

| Dato                    | Valor                                                                                                               |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Región                  | `sa-bogota-1`                                                                                                       |
| Compartimento           | `cognitive-dag`                                                                                                     |
| VM                      | `cognitive-dag-prod`, Ubuntu 24.04 aarch64, forma `VM.Standard.A1.Flex`, 2 OCPU y 12 GB, usuario SSH `ubuntu`       |
| Red                     | VCN `cognitive-dag-vcn`, subred pública `cognitive-dag-public`                                                      |
| Dominio del sitio       | `cognitive.devama.cloud` (registro A creado por el autor; la raíz `devama.cloud` es de otro sitio y no se toca)     |
| Vault                   | `ocid1.vault.oc1.sa-bogota-1.i5vpjtjvaabti.abrgcljr5twomtfqy3a2arojhc4bbanqdkpfe6wahx2om3nqkw32fyrgptcq`            |
| Grupo dinámico          | `cognitive-dag-vm` (la VM lee el Vault con su identidad de instancia, sin llaves de API)                            |
| Registro (OCIR)         | `bog.ocir.io`, espacio de nombres `axnl7xod1tm1`, repositorios `cognitive-dag/{api,worker,edge,migrator}`           |
| Usuario de solo lectura | `axnl7xod1tm1/Default/vm-ocir-pull` (su token vive en el Vault, nunca en el repositorio)                            |
| Correo                  | OCI Email Delivery, `smtp.email.sa-bogota-1.oci.oraclecloud.com:587` con STARTTLS; remitente `alertas@devama.cloud` |

## 1. Instancia

1. Compute → Instances → Create instance, en el compartimento `cognitive-dag`.
2. Imagen Canonical Ubuntu 24.04 (aarch64) y forma `VM.Standard.A1.Flex` con 2 OCPU y 12 GB. La capacidad
   de A1 en Bogotá puede faltar; si falla, se reintenta más tarde (la cifra y la política de instancias
   inactivas están por verificar en `research.md`, T002).
3. Red: la VCN `cognitive-dag-vcn` y la subred pública `cognitive-dag-public`, con IP pública asignada.
4. Llave SSH pública del autor para el usuario `ubuntu` (nunca contraseñas).
5. En «Advanced options → Management → Cloud-init script» se pega `deploy/provision/cloud-init.yaml`.
   Escribe las constantes de la tabla en `/etc/cognitive-dag/cognitive-dag.env`, clona el repositorio en
   `/opt/cognitive-dag` y ejecuta `provision.sh`. La instancia queda aprovisionada al primer arranque
   (`cloud-init status --wait` en la VM lo confirma).

## 2. Reglas de entrada

En la lista de seguridad de la subred (o un grupo de seguridad de red), entrada con estado, origen
`0.0.0.0/0`:

| Puerto | Protocolo | Para qué                                                                |
| ------ | --------- | ----------------------------------------------------------------------- |
| 22     | TCP       | SSH (solo llaves; `fail2ban` y límite de intentos en el anfitrión)      |
| 80     | TCP       | HTTP: Caddy solo redirige a HTTPS y resuelve el desafío de certificados |
| 443    | TCP       | HTTPS                                                                   |

Nada más. Si la IP del autor es estable, conviene limitar el 22 a ella. La UI de Temporal **no** tiene
regla de entrada: se llega por túnel ([temporal-ui.md](./temporal-ui.md)).

## 3. IP pública efímera

Decisión del autor: la IP pública **no se reserva**. En OCI una IP efímera persiste ante un reinicio, un
`stop` y un `start` de la instancia; solo cambia si la instancia se **termina**. El registro A de
`cognitive.devama.cloud` ya existe y resuelve a la IP actual.

- Si la VM se termina y se recrea (por ejemplo en una [reconstrucción](./rebuild.md)), la IP nueva es
  distinta: hay que **actualizar el registro A** a la IP nueva antes del primer despliegue, porque Caddy
  necesita que el nombre resuelva para obtener el certificado.
- La IP no se versiona ni se escribe en el repositorio.

Comprobación: `dig +short cognitive.devama.cloud` devuelve la IP pública actual de la instancia.

## 4. Vault y política de lectura

1. Identity & Security → Vault: el Vault de la tabla, con una clave de cifrado maestra (software) para
   proteger los secretos. Sus OCID van en el entorno del operador (`deploy/env/operator.env.example`).
2. Identity → Domains → Dynamic groups: `cognitive-dag-vm` con la regla
   `ALL {instance.compartment.id = '<OCID del compartimento cognitive-dag>'}` (o la instancia concreta).
3. Identity → Policies, en el compartimento (o la raíz si lo exige la consola):
   `Allow dynamic-group cognitive-dag-vm to read secret-bundles in compartment cognitive-dag`.
   Solo **lectura**: la VM no puede crear ni cambiar secretos. Los carga el autor desde su máquina
   ([secrets.md](./secrets.md)).

Comprobación, ya en la VM: `sudo systemctl start cognitive-dag-secrets` termina sin error
([provisioning.md](./provisioning.md)).

## 5. OCIR

1. Developer Services → Container Registry: repositorios privados `cognitive-dag/api`, `cognitive-dag/worker`,
   `cognitive-dag/edge` y `cognitive-dag/migrator` (los crea la primera publicación si la política lo permite).
2. Un usuario de solo lectura para la VM (`vm-ocir-pull`) con política
   `Allow group <grupo-del-usuario> to read repos in compartment cognitive-dag`; su token de autenticación
   se guarda en el Vault como `ocir_pull_token` (`secrets.sh put ocir_pull_token`).
3. La publicación (`release.yml`) usa otro usuario con escritura y sus credenciales como secretos del
   entorno `production` de GitHub; no se mezclan con el de lectura.

## 6. Correo (T050)

1. Email Delivery: dominio de correo `devama.cloud`, remitente aprobado `alertas@devama.cloud`.
2. Registros DNS del dominio de envío: **SPF** (`v=spf1 include:rp.oracleemaildelivery.com ~all`, según
   la región), **DKIM** (el CNAME que da Oracle) y **DMARC** (`_dmarc`: `v=DMARC1; p=none; rua=mailto:...`).
   Se empieza en `p=none` con informes y se sube a `quarantine` cuando los informes salgan limpios.
3. Credenciales SMTP del usuario de Oracle: usuario y contraseña van al Vault (`smtp_user`, `smtp_password`).
   Para que el envío no falle con `535 Authorization failed: Envelope From address <...> not authorized`
   aunque las credenciales sean válidas (aprendido en producción):
   - El usuario `email-sender` debe estar **añadido al grupo** `email-senders`.
   - La política lleva, además de `use email-family`, la línea explícita
     `Allow group 'Default'/'email-senders' to use approved-senders in compartment cognitive-dag`, y el
     remitente aprobado debe estar en el compartment `cognitive-dag`.
   - Los cambios de IAM pueden tardar **varios minutos** en aplicarse al envío SMTP: espera antes de
     volver a probar.
4. Correo de prueba y revisión de las cabeceras del mensaje recibido: `spf=pass`, `dkim=pass`, `dmarc=pass`.
