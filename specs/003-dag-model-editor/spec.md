# Feature Specification: Modelo DAG y editor visual (F2)

**Feature Branch**: `003-dag-model-editor`

**Created**: 2026-10-30

**Status**: Draft

**Input**: User description: "Fase F2 de docs/PLAN.md: modelo del DAG con el catálogo completo de 11
tipos de nodo (esquemas de configuración y de salida), validación estructural y semántica, borrador
editable con versiones publicadas inmutables y versión activa con reactivación (rollback), permisos
owner y editor para editar y publicar y viewer de solo lectura, referencias declarativas entre nodos
y plantillas solo en campos de texto, condiciones como AST tipado sin evaluación de código, límites de
tamaño configurables por organización, bloqueo optimista, editor visual con paleta, conexiones,
panel de configuración generado desde los esquemas, validación en vivo, guardar, publicar,
auto-layout, exportar a JSON e historial de versiones. Sin ejecución de workflows (F3)."

## User Scenarios & Testing *(mandatory)*

Actores: **owner** y **editor** (crean, editan y publican), **viewer** (solo lectura), miembros de
otra organización (sin acceso).

### User Story 1 - Crear y editar un workflow en el editor visual (Priority: P1)

Un editor crea un workflow con nombre, arrastra nodos desde la paleta, los conecta, configura cada
nodo en un panel lateral y guarda el borrador.

**Why this priority**: es la funcionalidad central de la fase; sin ella no hay nada que validar ni
publicar.

**Independent Test**: crear un workflow con un disparador manual, una condición y dos nodos de
acción, guardarlo, recargar la página y verificar que todo se conserva.

**Acceptance Scenarios**:

1. **Given** un owner o editor, **When** crea un workflow con un nombre válido, **Then** se abre el
   editor con un borrador vacío.
2. **Given** el editor abierto, **When** arrastra un nodo desde la paleta al lienzo, **Then** el nodo
   aparece con su configuración por defecto y se puede mover.
3. **Given** dos nodos, **When** se conecta la salida de uno con la entrada del otro, **Then** queda
   una conexión dirigida entre ellos.
4. **Given** un nodo seleccionado, **When** se editan sus campos en el panel lateral, **Then** el
   formulario corresponde a su tipo y valida cada campo al escribir.
5. **Given** cambios sin guardar, **When** se pulsa Guardar, **Then** el borrador queda guardado y se
   ve el momento del último guardado; al salir con cambios sin guardar se pide confirmación.
6. **Given** un viewer, **When** abre un workflow, **Then** ve el lienzo y la configuración pero no
   puede modificar, guardar ni publicar.
7. **Given** un miembro de otra organización, **When** intenta abrir el workflow, **Then** recibe
   recurso inexistente.

---

### User Story 2 - Validación del DAG (Priority: P1)

El sistema valida el DAG mientras se edita y antes de publicar, y muestra cada problema sobre el nodo
o la conexión afectada y en una lista de problemas.

**Why this priority**: un DAG inválido no puede ejecutarse en F3; la validación es la garantía de
calidad del modelo.

**Independent Test**: construir DAGs con cada tipo de error y verificar que cada uno se informa en el
lugar correcto y que publicar queda bloqueado.

**Acceptance Scenarios**:

1. **Given** un DAG con un ciclo, **When** se valida, **Then** se informa el ciclo y los nodos que lo
   forman.
2. **Given** un DAG sin disparador o con más de uno, **When** se valida, **Then** se informa el error.
3. **Given** un nodo sin conexión con el disparador, **When** se valida, **Then** se informa como
   inalcanzable.
4. **Given** una referencia a un nodo inexistente, a un nodo posterior, o a un campo que el nodo no
   produce, **When** se valida, **Then** se informa sobre el campo afectado.
5. **Given** una referencia a un campo de tipo incompatible con el campo destino, **When** se valida,
   **Then** se informa la incompatibilidad con ambos tipos.
6. **Given** un campo obligatorio vacío o con formato inválido, **When** se valida, **Then** se informa
   en el formulario del nodo.
7. **Given** un DAG que supera los límites de su organización, **When** se valida o se guarda,
   **Then** se rechaza indicando el límite.
8. **Given** errores de validación, **When** se intenta publicar, **Then** la publicación se rechaza.
   Un borrador con errores sí puede guardarse.
9. **Given** la misma definición, **When** se valida en el navegador y en el servidor, **Then** ambos
   producen los mismos errores.

---

### User Story 3 - Publicar, activar y volver a una versión anterior (Priority: P1)

Un editor publica el borrador como una versión numerada e inmutable que queda activa. Puede ver el
historial y reactivar una versión anterior.

**Why this priority**: las ejecuciones de F3 se ligan a una versión exacta; sin versiones no hay
ejecución confiable.

**Independent Test**: publicar v1, editar, publicar v2, reactivar v1 y verificar el contenido y el
estado de cada versión.

**Acceptance Scenarios**:

1. **Given** un borrador válido, **When** se publica, **Then** se crea la versión siguiente (v1, v2…)
   con una copia exacta de la definición, queda activa y el borrador sigue editable.
2. **Given** una versión publicada, **When** cualquier usuario intenta modificarla, **Then** no existe
   operación que lo permita.
3. **Given** varias versiones, **When** se abre el historial, **Then** se ven número, fecha, quién la
   publicó, una nota opcional y cuál está activa.
4. **Given** una versión anterior, **When** un owner o editor la reactiva, **Then** pasa a ser la
   activa sin crear una versión nueva ni tocar el borrador.
5. **Given** una versión, **When** se pide copiarla al borrador, **Then** el borrador se reemplaza
   por su definición tras confirmación.

---

### User Story 4 - Referencias, plantillas y condiciones (Priority: P2)

Al configurar un nodo, el usuario elige datos de nodos anteriores desde una lista, inserta referencias
en campos de texto y arma condiciones con un constructor visual.

**Why this priority**: conecta los datos entre nodos; sin ello el DAG es solo un dibujo.

**Independent Test**: armar un DAG que clasifique un texto y ramifique según el resultado, usando
solo los selectores y el constructor visual.

**Acceptance Scenarios**:

1. **Given** un campo que acepta referencias, **When** se abre el selector, **Then** se ofrecen solo
   los campos de nodos anteriores con tipo compatible.
2. **Given** un campo de texto que admite plantillas, **When** se inserta una referencia, **Then**
   aparece como marcador dentro del texto y se valida como cualquier referencia.
3. **Given** un campo que no admite plantillas, **When** se escribe texto con marcadores, **Then** se
   trata como texto literal.
4. **Given** el constructor de condiciones, **When** se combinan comparaciones con Y, O y NO,
   **Then** la condición se guarda como estructura tipada y se valida contra los tipos de los campos.
5. **Given** una condición, **When** se guarda, **Then** ninguna parte se almacena ni se interpreta
   como código.

---

### User Story 5 - Edición concurrente segura (Priority: P2)

Si dos personas editan el mismo borrador, la segunda en guardar recibe un aviso y no sobrescribe el
trabajo de la primera.

**Why this priority**: evita pérdida silenciosa de trabajo en organizaciones con varios editores.

**Independent Test**: abrir el mismo borrador en dos sesiones, guardar en una y luego en la otra.

**Acceptance Scenarios**:

1. **Given** un borrador abierto en dos sesiones, **When** la segunda guarda después de la primera,
   **Then** el guardado se rechaza con un aviso que ofrece recargar el borrador.
2. **Given** el aviso de conflicto, **When** se elige recargar, **Then** se ve el borrador guardado por
   la otra persona.

---

### User Story 6 - Herramientas del editor (Priority: P3)

El editor ordena automáticamente el grafo, exporta la definición a JSON y muestra el historial de
versiones.

**Why this priority**: mejora la experiencia; no bloquea el núcleo.

**Independent Test**: desordenar un grafo, aplicar el orden automático, exportar y verificar que el
JSON exportado se valida con el mismo esquema.

**Acceptance Scenarios**:

1. **Given** un grafo, **When** se pulsa Ordenar, **Then** los nodos se reposicionan en capas según
   las conexiones sin cambiar la lógica.
2. **Given** un borrador o una versión, **When** se exporta, **Then** se descarga un archivo JSON con
   la definición, válido contra el esquema del DAG.

---

### User Story 7 - Límites por organización (Priority: P3)

Cada organización tiene límites de tamaño de DAG; por defecto los de la plataforma, ajustables por
organización.

**Why this priority**: protege la plataforma y prepara los planes de uso; no bloquea el núcleo.

**Independent Test**: fijar un límite bajo para una organización y verificar el rechazo al
superarlo, mientras otra organización conserva el límite por defecto.

**Acceptance Scenarios**:

1. **Given** una organización sin ajuste, **When** se valida un DAG, **Then** se aplican 50 nodos,
   100 conexiones y 256 KB de definición.
2. **Given** una organización con límites propios, **When** se valida un DAG, **Then** se aplican
   esos límites.
3. **Given** cualquier miembro, **When** abre los ajustes de la organización, **Then** ve los límites
   vigentes.
4. **Given** un operador de la plataforma, **When** ajusta los límites con el script de
   administración, **Then** se aplican en la siguiente validación y nunca superan el máximo absoluto.
5. **Given** cualquier miembro, incluido el owner, **When** intenta cambiar los límites desde la app o
   el API, **Then** no existe operación que lo permita.

### Edge Cases

- Borrar un nodo referenciado por otros: las referencias quedan marcadas como inválidas, sin borrarse
  en silencio.
- Renombrar el identificador visible de un nodo: las referencias que lo usan se actualizan.
- Workflow con nombre repetido en la misma organización: se rechaza.
- Archivar un workflow con una versión activa: el workflow deja de aparecer en la lista y su versión
  activa queda desactivada.
- Definición manipulada fuera del editor (petición directa al API): el servidor la valida con las
  mismas reglas y rechaza cualquier campo desconocido.
- Publicar dos veces en paralelo el mismo borrador: se crea una sola versión.

## Requirements *(mandatory)*

### Functional Requirements

**Modelo del DAG**

- **FR-001**: El modelo DEBE definir los 11 tipos de nodo del plan (`trigger.manual`,
  `trigger.webhook`, `trigger.schedule`, `llm.classify`, `llm.extract`, `llm.generate`,
  `logic.condition`, `logic.merge`, `human.approval`, `http.request`, `mock.service`), cada uno con un
  esquema de configuración y un esquema de salida tipados.
- **FR-002**: Cada tipo DEBE declarar la fase en que se vuelve ejecutable; el editor DEBE mostrarlo.
- **FR-003**: Un DAG DEBE tener exactamente un disparador, sin conexiones entrantes, y todos los
  demás nodos DEBEN ser alcanzables desde él.
- **FR-004**: El DAG NO DEBE contener ciclos.
- **FR-005**: La definición NO DEBE admitir campos desconocidos ni secretos (credenciales, tokens o
  cabeceras de autorización); los conectores con credenciales llegan en F10.

**Referencias y condiciones**

- **FR-006**: Las referencias DEBEN expresarse como rutas declarativas a la salida de un nodo
  anterior (`nodes.<id>.output.<campo>`) y validarse por existencia, orden y compatibilidad de tipo.
- **FR-007**: Las plantillas con referencias DEBEN estar permitidas solo en campos de texto marcados
  para ello en el esquema del tipo de nodo.
- **FR-008**: Las condiciones DEBEN representarse como una estructura tipada con un conjunto cerrado
  de operaciones (comparación, pertenencia, existencia, Y, O, NO). NADA en la definición DEBE
  evaluarse como código.

**Validación**

- **FR-009**: La validación DEBE ser la misma en el navegador y en el servidor (una sola
  implementación compartida) y devolver errores con ubicación: nodo, campo o conexión.
- **FR-010**: Guardar un borrador con errores DEBE estar permitido; publicar con errores NO.
- **FR-011**: El servidor DEBE validar toda definición recibida, aunque venga del editor.

**Workflows, borrador y versiones**

- **FR-012**: Un workflow DEBE tener nombre único por organización (1–100 caracteres) y un borrador.
- **FR-013**: Publicar DEBE crear una versión numerada correlativa con una copia inmutable de la
  definición, autor, momento y nota opcional, y activarla.
- **FR-014**: Debe haber como máximo una versión activa por workflow; reactivar una anterior NO DEBE
  crear una versión nueva.
- **FR-015**: Las versiones publicadas NO DEBEN poder modificarse ni borrarse.
- **FR-016**: Guardar el borrador DEBE usar bloqueo optimista; un guardado basado en una revisión
  anterior DEBE rechazarse con conflicto.
- **FR-017**: Archivar un workflow DEBE ser borrado lógico, solo del owner, y desactivar su versión
  activa.

**Permisos y aislamiento**

- **FR-018**: Owner y editor DEBEN poder crear, editar, guardar, publicar y reactivar; el viewer
  solo leer; solo el owner archivar.
- **FR-019**: Todo acceso DEBE estar aislado por organización en la aplicación y en la base de datos,
  con respuesta de recurso inexistente ante workflows de otra organización.

**Límites**

- **FR-020**: Los límites por defecto DEBEN ser 50 nodos, 100 conexiones y 256 KB de definición, con
  máximos absolutos de plataforma configurables en el servidor.
- **FR-021**: Cada organización DEBE poder tener límites propios, nunca superiores a los máximos de
  plataforma. Solo un operador de la plataforma los modifica, con un script de administración fuera
  de la aplicación; ningún miembro (tampoco el owner) puede cambiarlos desde la app. Todos los
  miembros los ven en los ajustes de la organización.

**Editor**

- **FR-022**: El editor DEBE ofrecer paleta, lienzo con conexiones, panel de configuración generado
  desde el esquema de cada tipo, validación en vivo con errores sobre nodos y lista de problemas,
  Guardar, Publicar, Ordenar (auto-layout), Exportar JSON e historial de versiones con reactivación.
- **FR-023**: El editor DEBE advertir antes de abandonar con cambios sin guardar.

**Eventos y entrega**

- **FR-024**: Crear, publicar, reactivar y archivar workflows DEBEN emitir eventos de seguridad con
  el mismo formato de F1; el script de límites DEBE registrar quién, cuándo y qué valores cambió.
- **FR-025**: Toda la funcionalidad DEBE estar detrás del flag `dag-editor-enabled`.

### Key Entities

- **Workflow**: organización, nombre, borrador (definición y número de revisión), versión activa,
  autor, fechas, borrado lógico.
- **Versión de workflow**: workflow, número, definición inmutable, nota, quién publicó, momento,
  resumen derivado (cantidad de nodos y tipos usados).
- **Definición de DAG**: nodos (id, tipo, etiqueta, posición, configuración) y conexiones (origen,
  salida, destino); validada por el esquema compartido.
- **Límites de organización**: máximos de nodos, conexiones y tamaño.

## Security Considerations *(required by constitution, principle I)*

| Riesgo | Cómo lo aborda F2 |
|---|---|
| A01 Broken Access Control | RLS por organización en workflows y versiones; permisos por rol en cada endpoint; 404 ante recursos ajenos; pruebas de acceso cruzado |
| A04 Cryptographic Failures | Sin secretos en la definición del DAG (FR-005) |
| A05 Injection | Sin `eval`; condiciones como AST cerrado; plantillas solo con rutas validadas; esquema estricto sin campos desconocidos |
| A06 Insecure Design | Límites de tamaño; versiones inmutables; validación en servidor aunque venga del editor |
| A08 Software or Data Integrity Failures | Versiones inmutables (sin `UPDATE` ni `DELETE` para la cuenta de ejecución); bloqueo optimista |
| A10 Mishandling of Exceptional Conditions | Definiciones inválidas rechazadas con errores ubicados; nunca se publica un DAG inválido |
| LLM01/LLM06 (preparación) | Los prompts de nodos LLM se guardan como datos sin ejecutarse; los límites de tamaño acotan el costo futuro del compilador |

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Un editor crea, configura, guarda y publica un workflow de 5 nodos en menos de 5 minutos.
- **SC-002**: El 100 % de los casos de prueba de validación (un caso por regla de FR-003 a FR-008 y de
  límites) producen el mismo error en navegador y servidor.
- **SC-003**: La validación de un DAG de 50 nodos responde en menos de 100 ms en el navegador.
- **SC-004**: El editor se mantiene fluido (sin bloqueos perceptibles) con 50 nodos y 100 conexiones.
- **SC-005**: El 100 % de los intentos de acceso entre organizaciones a workflows y versiones se
  rechazan.
- **SC-006**: Ninguna versión publicada cambia después de publicarse (verificado comparando su
  contenido tras ediciones del borrador y reactivaciones).

## Assumptions

- No se ejecutan workflows en F2; los disparadores, nodos LLM y acciones solo se configuran.
- La configuración de `http.request` se valida en forma (URL https, método, cuerpo con plantillas),
  pero la protección completa anti-SSRF se aplica al ejecutar (F7).
- Deshacer/rehacer, edición colaborativa en tiempo real e importar JSON quedan fuera de F2.
- Los textos del editor están en español.
