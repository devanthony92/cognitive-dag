# Baja de la VM

Sin copias de seguridad (D5), dar de baja la VM **borra los datos**. Haz antes lo que quieras conservar.

1. **Detén el despliegue automático** (deshabilita `deploy.yml` y, si se eligió extracción, el
   temporizador de la VM) para que ninguna publicación vuelva a desplegar.
2. **Detén la pila y descarta los volúmenes** (solo si no quieres nada):
   `sudo -iu cdag-deploy /opt/cognitive-dag/deploy/ops/compose.sh down -v`.
3. **Quita el DNS**: borra el registro A de `cognitive.devama.cloud` (la raíz `devama.cloud` no se toca).
4. **Termina la instancia** `cognitive-dag-prod` en la consola y elige borrar también el volumen de arranque.
5. **Libera la IP pública reservada** (Networking → Reserved public IPs): una IP reservada sin asignar puede
   costar.
6. **Vault**: programa el borrado de los secretos `cdag-*` (Oracle los borra tras un plazo mínimo) y, si no
   se va a reutilizar, del Vault y de su clave maestra. Revoca el token del usuario `vm-ocir-pull` y las
   credenciales SMTP.
7. **OCIR**: borra los repositorios `cognitive-dag/*` si ya no hacen falta.
8. **GitHub**: retira los secretos y variables del entorno `production` (`OCIR_*` y, si se usó empuje, la
   llave de despliegue).

Comprobación: `dig +short cognitive.devama.cloud` sin respuesta y la consola sin instancia, IP ni Vault
activos en el compartimento `cognitive-dag`.
