# Informe de anchos (F10)

Método: cada ruta se carga en un `iframe` del ancho indicado (las consultas de medios responden al ancho del
`iframe`) contra el servidor de desarrollo y una API simulada con datos ficticios; se lee
`documentElement.scrollWidth - ancho`. Cero o negativo = sin scroll horizontal. Se cubren 18 rutas distintas
(las 20 del producto, contando que `/` y `/orgs/{id}` comparten pantalla de entrada y que el editor y la
ejecución comparten shell).

## Línea base sobre `main` (`f1d60bf`), antes de la PR 1

| Ancho   | Rutas con desborde | Desborde                             | Causa                                         |
| ------- | ------------------ | ------------------------------------ | --------------------------------------------- |
| 375 px  | 18 de 18           | +152 px (sin organización) a +787 px | `AppHeader` con `whitespace-nowrap` (1162 px) |
| 768 px  | 12 de 18           | +394 px                              | ídem                                          |
| 1024 px | 12 de 18           | +138 px                              | ídem                                          |
| 1440 px | 0 de 18            | —                                    | —                                             |

Todas las rutas con sesión y organización activa desbordan por la cabecera; las de sesión sin organización
desbordan menos porque la cabecera es más corta.

## Tras la PR 1 (shell, tokens y estados de ruta)

20 rutas (8 de visitante y 12 con sesión, contando `/no-existe` de cada grupo) × 375, 768, 1024 y 1440 px × modo claro
y oscuro = **160 mediciones, 0 con scroll horizontal**. Cada pantalla tiene un solo `main`.

| Qué cambió                                                                                                             | Resultado                                                          |
| ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Cabecera de 56 px sin `whitespace-nowrap`; selector de organización con etiqueta truncada; marca sin texto bajo 640 px | 375 px: de +787 px a 0                                             |
| Carril de 240 px (≥ 1024), de 72 px (768–1023) y barra inferior de 56 px (< 768)                                       | 768 px: de +394 px a 0; 1024 px: de +138 px a 0                    |
| La lista de Workflows contiene el desborde de su tabla dentro del contenedor (`grid-cols-[minmax(0,1fr)]`)             | 375 px: la tabla se desplaza dentro de su tarjeta, no el documento |

## Tras la PR 3 (listas, ajustes y acceso)

Mismo método (iframes de 375, 768, 1024 y 1440 px, API simulada con datos ficticios, `scrollWidth - ancho`).
Rutas: organización, Workflows, «Describir workflow», Ejecuciones de la organización y de un workflow,
Aprobaciones, Conexiones, Miembros, cambio de contraseña y aceptar invitación (con sesión, 10 rutas), más `/`,
`/login`, `/register`, `/forgot-password`, `/reset-password` (con y sin token) y `/verify-email` (sin sesión,
7 rutas). 17 rutas × 4 anchos × claro y oscuro = **136 mediciones, 0 con scroll horizontal y 1 solo `h1` en cada
una**. El editor y la ejecución quedan para la PR 4.

| Qué cambió                                                                                        | Resultado                                                                   |
| ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Workflows y Aprobaciones apilan cada fila bajo 640 px en lugar de ocultar columnas                | 375 px: nombre, versión y fecha visibles sin desplazarse                    |
| Ejecuciones de la organización y de un workflow comparten `RunsTable` y `page-default`            | Antes `max-w-5xl`/`6xl` y ancho completo; ahora una sola columna de 1120 px |
| `reset-password`, `verify-email`, `invitations/accept`, `register`, `forgot-password`, compilador | Cada uno con un solo `h1` (antes usaban el título de la tarjeta, un `h2`)   |
| Las pantallas de lista cargan con esqueletos de la forma final y `role="status"`                  | Sin «Cargando…» suelto fuera del editor y de la ejecución                   |

Quedan «Cargando…» en `ScheduleStatus`, `WebhookPanel`, `StepPanel`, `RunDetailPage` y `WorkflowEditor`: son del
editor y de la ejecución (PR 4).
