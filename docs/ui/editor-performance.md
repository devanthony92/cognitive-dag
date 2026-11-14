# Rendimiento del editor (F10, T074 / SC-011)

Meta de SC-011: el editor con un workflow de referencia dentro de +10 % respecto a `main`, y el JavaScript
inicial dentro de +15 %. **Desviación aceptada por el autor:** la apertura del editor en caliente queda +31 %
por encima de `main` en navegador real (113 → 148 ms). El resto de la meta se cumple.

## JavaScript inicial

Gzip del `index-*.js`, ambos con `NODE_ENV=production`: `main` 129 463 B, esta rama 129 519 B (+0,04 %). Las
estaciones viven en el chunk perezoso del editor.

## Navegador real

Método: `vite build` y `vite preview` de `main` (47ef81b) y de esta rama, cada uno en su puerto, con una API
simulada de datos ficticios y un workflow de 50 nodos y 100 aristas (el de la prueba). Navegador integrado
(Chrome) con el panel visible. En cada pasada, desde una página recién cargada: 4 aperturas (navegar al editor
y esperar a los 50 nodos más dos fotogramas; la primera es la fría, con el chunk sin cargar) y 3 tandas de
tecleo de 11 pulsaciones en «Nombre del nodo». Se midió con `performance.now`, `PerformanceObserver` de tipo
`longtask` y de tipo `event`. 5 pasadas por build, alternando.

| Medida                                     | `main`   | Rama    | Diferencia     |
| ------------------------------------------ | -------- | ------- | -------------- |
| Apertura en caliente, mediana (12 y 12)    | 113 ms   | 148 ms  | +31 %          |
| Apertura en caliente, rango                | 94–151   | 91–225  |                |
| Apertura fría, mediana (4 y 4)             | 257 ms   | 257 ms  | 0 %            |
| Longtasks en apertura en caliente, mediana | 0 ms     | 67 ms   |                |
| Tecleo, 11 pulsaciones                     | 359–375  | 362–368 | sin diferencia |
| Peor pulsación                             | 34–41 ms | 35 ms   | sin diferencia |

Causa probable: una tarea larga de ~67 ms al montar 50 estaciones y 100 aristas (la estación tiene más DOM que el
nodo anterior y cada arista pinta dos caminos y una etiqueta).

Limitaciones: el tecleo se mide con eventos sintéticos y cada pulsación espera dos fotogramas (~33 ms), así que no
distingue diferencias menores de ~16 ms por pulsación. No hay perfil de CPU (la Self-Profiling API necesita una
cabecera que `vite preview` no envía) ni corrida con la CPU limitada 4×.

## jsdom

`workflow-editor-performance` mide React sin layout ni pintura y varía ±30 % de una corrida a otra (10 corridas
alternando: medianas de 1,1 a 1,6 s en `main` y en la rama para toda la prueba). Las 11 pulsaciones con 50 nodos
tardan ≈0,4 s; una regresión de esta PR (un `onNodeClick` en línea que repintaba los 50 nodos en cada pulsación)
las subía a ≈0,7 s y se corrigió. La prueba conserva un presupuesto absoluto de 2 s para esas pulsaciones (antes
5 s), unas cinco veces lo habitual: el ruido de jsdom no la rompe y una regresión mayor sí. La meta de +10 % se
verifica en navegador real, no en jsdom.
