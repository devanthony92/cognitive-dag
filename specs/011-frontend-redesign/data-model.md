# Data Model: Rediseño del frontend (F10)

**Sin cambios de esquema, de contratos Zod ni de API.** F10 no añade tablas, columnas, endpoints ni
migraciones; los datos de dominio (workflows, ejecuciones, pasos) se leen como hoy. Si una tarea necesitara
alguno, se detiene, se marca **[API]** en `tasks.md` y se pide aprobación del autor (FR-030).

Lo que sí existe son **modelos de presentación** del cliente, sin persistencia en servidor:

| Entidad             | Campos                                                                                     | Origen / reglas                                                                                                                                              |
| ------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ThemePreference`   | `'system'`, `'light'` o `'dark'`                                                           | `localStorage` (clave fija), por navegador, en try/catch; por defecto `system`. Se aplica como `data-theme` en `<html>` antes del primer render             |
| `DesignToken`       | nombre, valor oscuro, valor claro, grupo (neutro, acción, estado, categoría)               | `src/styles/tokens.css`; fuente de verdad del contraste ([contracts/design-contract.md](./contracts/design-contract.md))                                      |
| `ServiceState`      | `key`, `label` (es), `glyph`, `tokenState`, `errorClass?`                                  | Mapa único desde `RunStatus`, `StepStatus` y `waitingReason`; 7 estados de `DESIGN.md` más «Pendiente»                                                        |
| `NodeCategory`      | `key`, `label` (es), `pictogram`, `tokenNode`                                              | Mapa único desde los tipos de `NODE_CATALOG` (prefijo del tipo); 6 categorías                                                                                 |
| `StationModel`      | `nodeId`, `category`, `label`, `typeLabel`, `state?`, `selected`, `errorCount`             | Derivado de `FlowNode.data` (editor) o de `RunStep` y la definición (ejecución); sin estado en el editor                                                      |
| `StationEdgeModel`  | `source`, `target`, `category` del origen, `branchLabel?` («sí»/«no»), `failing`           | Derivado de `buildEdges`; el color sale de la categoría del nodo de origen                                                                                    |
| `ServiceStripModel` | `steps: { nodeId, category, state }[]`, `overflow` (N)                                     | Detalle de la ejecución; en la lista, por fila visible bajo demanda (research R15)                                                                            |
| `RouteErrorModel`   | `kind` (`problem`, `unavailable`, `stale-chunk`, `unknown`), `title`, `detail?`, `correlationId?`, `attempt` | Derivado del error de ruta: problema RFC 9457, 503 o red, error de importación de chunk, resto                                                          |
| `NavDestination`    | `key`, `label`, `icon`, `to`, `minRole`                                                    | Lista fija de 5; se filtra por `organization.role`; solo rutas existentes                                                                                     |
| `PageWidth`         | `narrow` (640), `default` (1120) o `full`                                                  | `staticData.width` de cada ruta                                                                                                                               |
| `RecentChange`      | `runId`, `since`                                                                           | Estado local de la lista: resalta una fila 8 s o hasta el foco; no persiste                                                                                   |

## Transiciones relevantes

- `ThemePreference`: cambia por elección del usuario; cualquier fallo de almacenamiento vuelve a `system`.
- `RouteErrorModel(unavailable)`: intento 0 → 1 → 2 → 3 con esperas de 1, 2 y 4 s; al agotarse, panel manual.
- `RecentChange`: nace con un cambio de estado en vivo; termina al recibir foco o a los 8 s.
