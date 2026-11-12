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
