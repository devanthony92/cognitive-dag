# Interfaz de Temporal por túnel SSH

Decisión D15A, ADR-0091. La UI de Temporal **no** está en internet: Caddy no la proxifica, no hay regla de
entrada para ella y el Compose la publica solo en `127.0.0.1:8233` de la VM. Se llega con un túnel SSH desde
tu máquina; el acceso queda en el registro de SSH de la VM.

```bash
ssh -N -L 8233:127.0.0.1:8233 ubuntu@<ip-publica>
```

Con el túnel abierto, abre `http://localhost:8233` en tu navegador (el namespace es `cognitive-dag`).
Se cierra con `Ctrl+C`. Si el puerto 8233 de tu máquina está ocupado, usa otro: `-L 18233:127.0.0.1:8233`.

La UI se conecta a Temporal con mTLS (certificado `temporal-client-ui`). Es de solo operación: no hay
usuarios finales de Temporal.

Comprobaciones:

```bash
# en la VM: la UI escucha solo en loopback
sudo ss -ltnp | grep 8233            # 127.0.0.1:8233, nunca 0.0.0.0
# desde fuera, sin túnel, no responde
curl -m 5 http://<ip-publica>:8233/   # sin respuesta
```
