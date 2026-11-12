# Contrato de diseño (F10)

Fija lo que las pruebas comprueban. Los valores de color son los de [DESIGN.md](../../../DESIGN.md) (normativo);
este contrato añade las reglas de mapeo y los umbrales verificables.

## 1. Estados de servicio

| Origen en el contrato de la API                              | Estado de diseño | Etiqueta en español (existente) | Glifo                                                            | Token             |
| ------------------------------------------------------------ | ---------------- | ------------------------------- | ---------------------------------------------------------------- | ----------------- |
| `StepStatus.running`, `RunStatus.running`                    | En curso         | En curso                        | arco abierto; gira lento (estático con `prefers-reduced-motion`) | `state-running`   |
| `StepStatus.succeeded`, `RunStatus.succeeded`                | Completado       | Completado / Completada         | círculo con ✓                                                    | `state-succeeded` |
| `StepStatus.failed`, `RunStatus.failed`                      | Fallido          | Fallido / Fallida               | círculo con ✕ y clase de error en texto                          | `state-failed`    |
| `RunStatus.timed_out`                                        | Fallido          | Vencida                         | círculo con ✕ y «Tiempo agotado»                                 | `state-failed`    |
| `waitingReason` (`rate_limited`, `approval`, `circuit_open`) | Esperando        | texto de `WAITING_REASON_LABELS` | reloj de arena                                                  | `state-waiting`   |
| `RunStatus.queued`                                           | Esperando        | En cola                         | reloj de arena                                                   | `state-waiting`   |
| `StepStatus.cancelled`, `RunStatus.cancelled`                | Cancelado        | Cancelado / Cancelada           | círculo tachado ⊘                                                | `state-cancelled` |
| `StepStatus.skipped`                                         | Omitido          | Omitido                         | relleno rayado a 45° y «»»                                       | `state-skipped`   |
| `StepStatus.reused`                                          | Reutilizado      | Reutilizado                     | contorno discontinuo y ↺                                         | `state-reused`    |
| `StepStatus.pending`                                         | Pendiente (**añadido**, no está en `DESIGN.md`) | Pendiente | círculo vacío de trazo fino                              | `ink-muted`       |

Reglas: el glifo y la etiqueta están siempre presentes; el color solo refuerza; los glifos son distintos entre
sí en escala de grises; las 6 clases de error (`ErrorClassSchema`) se muestran con las etiquetas de
`ERROR_CLASS_LABELS`. «Pendiente» se registra en `DESIGN.md` en la PR 2 y en el ADR-0101.

## 2. Categorías de nodo

| Prefijo del tipo (`NODE_CATALOG`) | Categoría         | Pictograma      | Token           |
| --------------------------------- | ----------------- | --------------- | --------------- |
| `trigger.*`                       | Disparador        | `zap`           | `node-trigger`  |
| `logic.*`                         | Lógica            | `git-branch`    | `node-logic`    |
| `llm.*`                           | LLM               | `sparkles`      | `node-llm`      |
| `http.*`                          | HTTP              | `globe`         | `node-http`     |
| `human.*`                         | Aprobación humana | `user-check`    | `node-approval` |
| `mock.*`                          | Simulado          | `flask-conical` | `node-mock`     |

Una prueba recorre `NODE_CATALOG` y falla si algún tipo no tiene categoría o si aparece un prefijo sin mapa.

## 3. Estación y arista

- Estación: círculo de 40 px (48 px seleccionada), borde de 4 px (`node-*`), relleno `surface`, pictograma de
  24 px con trazo de 2 px. Nombre (13 px, 600) y tipo (body-sm, apagado) debajo, de tamaño fijo y ≥ 12 px.
- Insignia de estado: círculo de 18 px arriba a la derecha, borde de 2 px en `ground`, glifo en `ground`; sin
  estado no hay insignia; no existe anillo de estado exterior.
- Arista: 5 px, segmentos a 0°, 45° y 90°, esquina de 12 px, color del nodo de origen; condición con «sí»/«no».
- Puerto: círculo de 12 px con zona de impacto de 44 px. Foco: anillo doble de 2+2 px.

## 4. Umbrales verificables

| Comprobación                                    | Umbral                                                                | Dónde                             |
| ----------------------------------------------- | --------------------------------------------------------------------- | --------------------------------- |
| Contraste de texto normal                       | ≥ 4,5:1 en claro y oscuro                                             | `scripts/ui/contrast.ts` (CI)     |
| Contraste de texto grande, glifos, bordes, foco | ≥ 3:1 en claro y oscuro                                               | `scripts/ui/contrast.ts` (CI)     |
| Colores fijos, `#hex`, `rgb()`, `hsl()`         | 0 fuera de `tokens.css`                                               | prueba estática (CI)              |
| `style=` o `<style>` propios                    | 0, salvo la lista de excepciones geométricas con razón                | prueba estática (CI)              |
| `border-l-*` o `border-r-*` > 1 px              | 0                                                                     | prueba estática (CI)              |
| `max-w-*` en rutas y páginas                    | solo `page-narrow`, `page-default`, `page-full`                       | prueba estática (CI)              |
| Tamaño de texto                                 | ≥ 12 px (sin `text-[10px]` ni `text-[11px]`)                          | prueba estática (CI)              |
| `h1` por pantalla                               | exactamente 1                                                         | pruebas de ruta (CI)              |
| Scroll horizontal                               | 0 px a 375, 768, 1024, 1440 y 200 % de zoom                           | navegador, informe versionado     |
| Objetivos táctiles                              | ≥ 44×44 px en controles                                               | pruebas de componente y navegador |
| Auditoría de impeccable                         | ≥ 16/20, 0 P0 y 0 P1                                                  | PR 5, informe versionado          |

## 5. Shell

Cabecera de 56 px; carril de 240 px (≥ 1024), de 72 px (768–1023) y barra inferior de 56 px (< 768). Destinos,
en este orden: Workflows, Ejecuciones, Aprobaciones, Conexiones, Miembros. El `main` es único y hay «Saltar al
contenido». El shell se mantiene en carga, vacío y error.

## 6. Estados de ruta

| Situación                       | Componente      | Contenido mínimo                                                                                      |
| ------------------------------- | --------------- | ----------------------------------------------------------------------------------------------------- |
| Carga de ruta > 150 ms          | `RoutePending`  | esqueleto con la forma final; `role="status"` «Cargando»                                              |
| Problema RFC 9457               | `RouteError`    | título llano, `detail`, `correlationId` (mono, copiable), **Reintentar** y **Volver**                 |
| 503 o red                       | `RouteError`    | «El servicio se está reiniciando»; hasta 3 reintentos con 1, 2 y 4 s; luego **Reintentar** manual     |
| Chunk ausente (versión nueva)   | `RouteError`    | «Hay una versión nueva»; acción **Recargar**                                                          |
| Ruta inexistente                | `RouteNotFound` | «No encontramos esa página» y ruta de vuelta                                                          |
| Lista vacía                     | `EmptyState`    | texto actual en español y una acción, dentro de `page-default`                                        |

Texto prohibido: «Something went wrong».
