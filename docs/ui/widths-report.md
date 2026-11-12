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

Pendiente para la PR 3 (T038, T047): `reset-password`, `verify-email`, `invitations/accept`, `register`,
`forgot-password` y el compilador siguen sin un `h1` propio (usan el título de la tarjeta), y la tabla de Workflows
oculta columnas a 375 px en lugar de convertirse en lista. El `h1` único se exige por ruta desde la PR 3.
