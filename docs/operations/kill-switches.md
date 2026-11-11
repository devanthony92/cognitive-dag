# Kill switches

Tres variables del worker apagan una capacidad sin desplegar una versión nueva (principio VIII). Valen
`true` por defecto y se ponen en `/etc/cognitive-dag/local.env` (modelo: `deploy/env/local.env.example`).

| Variable           | Apaga                                                                       |
| ------------------ | --------------------------------------------------------------------------- |
| `LLM_ENABLED`      | Las llamadas a Gemini: nodos LLM y el compilador de lenguaje natural a DAG  |
| `TRIGGERS_ENABLED` | Los disparadores (webhooks, programaciones y la reconciliación del sistema) |
| `HTTP_ENABLED`     | Los nodos de petición HTTP salientes                                        |

## Apagar y volver a encender

```bash
sudoedit /etc/cognitive-dag/local.env            # LLM_ENABLED=false
sudo -iu cdag-deploy /opt/cognitive-dag/deploy/ops/compose.sh up -d --no-deps worker
```

`compose.sh up -d` recrea el worker con el valor nuevo. Para volver a encender se pone `true` (o se quita
la línea) y se repite el comando. Un despliegue posterior conserva el valor, porque viene de `local.env`.

Comprobación: `compose.sh exec -T worker printenv LLM_ENABLED` imprime el valor vigente (la salida no
contiene secretos) y los nodos afectados fallan sin llamar a nadie con el código `LLM_DISABLED` (LLM y compilador) o `HTTP_DISABLED` (nodos HTTP); con `TRIGGERS_ENABLED=false` el worker deja de disparar ejecuciones por sistema.

Cuándo usarlos: `LLM_ENABLED=false` si la cuota de Gemini se agota o hay un abuso del compilador;
`TRIGGERS_ENABLED=false` ante un bucle de disparos o un webhook inundado; `HTTP_ENABLED=false` si un nodo
HTTP se usa para llegar a algo que no debe.
