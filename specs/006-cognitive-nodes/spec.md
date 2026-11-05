# Feature Specification: Nodos cognitivos (F5)

**Feature Branch**: `006-cognitive-nodes`

**Created**: 2026-11-05

**Status**: Draft

**Input**: User description: "Fase F5 de docs/PLAN.md: paquete `llm` (Gemini con structured output,
presupuesto de tokens y costo, redacción de datos sensibles); nodos ejecutables `llm.classify`,
`llm.extract` y `llm.generate`. Terminado cuando las salidas validan contra su esquema, los límites de
consumo están activos y el set de inyección no produce escapes. Llegan las clases `invalid_output` y
`budget_exhausted` de la taxonomía de F4, la cuota diaria de tokens y el bulkhead de los nodos LLM."

## User Scenarios & Testing *(mandatory)*

Actores: miembros de una organización (cualquier rol ejecuta y ve ejecuciones, como en F3–F4; owner y
editor editan workflows), el operador de la plataforma, un atacante que controla el texto que entra a
un nodo LLM, miembros de otra organización (sin acceso).

### User Story 1 - Clasificar, extraer y generar dentro de un workflow (Priority: P1)

Quien edita un workflow agrega nodos "Clasificar", "Extraer datos" o "Generar texto", los publica y
los ejecuta. Cada nodo devuelve una salida que cumple siempre el tipo declarado por su configuración,
y los nodos siguientes pueden usarla como cualquier otra salida.

**Why this priority**: es el objetivo de la fase.

**Independent Test**: publicar un workflow manual → clasificar → condición sobre la etiqueta →
generar, ejecutarlo con el proveedor de pruebas y con Gemini, y comprobar las salidas.

**Acceptance Scenarios**:

1. **Given** un nodo "Clasificar" con etiquetas, **When** se ejecuta, **Then** devuelve una de esas
   etiquetas y una confianza estimada entre 0 y 1.
2. **Given** un nodo "Extraer datos" con campos tipados, **When** se ejecuta, **Then** devuelve
   exactamente esos campos con sus tipos; un dato ausente en el texto vuelve como nulo solo si el campo
   lo admite.
3. **Given** un nodo "Generar texto", **When** se ejecuta, **Then** devuelve un texto en el idioma
   configurado que no supera la longitud máxima.
4. **Given** la salida de un nodo LLM, **When** una condición o una plantilla la referencia, **Then**
   se usa como dato; nunca se ejecuta ni elige qué nodo sigue fuera del grafo publicado.
5. **Given** la vista de una ejecución, **When** termina un nodo LLM, **Then** el paso muestra el
   modelo, los tokens y el costo estimado, sin mostrar el prompt.

---

### User Story 2 - Salidas inválidas reparadas o falladas con su clase (Priority: P1)

Si el modelo devuelve algo que no cumple el esquema, el nodo intenta repararlo como máximo dos veces
indicando los errores; si sigue mal, falla como "salida inválida" sin reintentos. Si el proveedor
bloquea el contenido, falla igual, sin reparar.

**Independent Test**: con el proveedor de pruebas configurado para devolver salidas inválidas N veces,
comprobar éxito tras 1–2 reparaciones y fallo `invalid_output` tras 3 respuestas inválidas.

**Acceptance Scenarios**:

1. **Given** una primera respuesta inválida y una segunda válida, **When** corre el nodo, **Then**
   termina bien y el paso registra una reparación.
2. **Given** tres respuestas inválidas seguidas, **When** corre el nodo, **Then** falla con clase
   `invalid_output` y no se reintenta.
3. **Given** contenido bloqueado por el proveedor, **When** ocurre, **Then** falla con clase
   `invalid_output` y código de bloqueo, sin reparación.
4. **Given** errores 5xx, timeouts o 429 del proveedor, **When** ocurren, **Then** se tratan como en
   F4 (transitorio, tiempo, limitado).

---

### User Story 3 - Consumo acotado (Priority: P1)

La plataforma limita los tokens por llamada, por ejecución y por organización y día. Al agotarse un
presupuesto, el nodo falla como "presupuesto agotado", la ejecución se detiene y queda un evento de
seguridad. El límite se decide antes de llamar al proveedor.

**Independent Test**: con límites bajos, ejecutar hasta agotar el presupuesto de la ejecución y luego
el diario, y comprobar el fallo, el evento y que no hubo llamada al proveedor.

**Acceptance Scenarios**:

1. **Given** un presupuesto por ejecución, **When** una llamada lo superaría, **Then** no se hace, el
   nodo falla con `budget_exhausted` y la ejecución termina fallida con esa clase.
2. **Given** el presupuesto diario de la organización agotado, **When** cualquier ejecución llega a un
   nodo LLM, **Then** falla igual hasta el día siguiente (UTC).
3. **Given** dos organizaciones, **When** una agota su presupuesto, **Then** la otra sigue igual.
4. **Given** una entrada mayor que el tamaño máximo, **When** corre el nodo, **Then** falla como
   permanente sin llamar al proveedor.
5. **Given** la página de la organización, **When** se abre, **Then** muestra "Consumo LLM de hoy" con
   tokens usados, límite y costo estimado.
6. **Given** la base de datos no disponible al reservar presupuesto, **When** ocurre, **Then** el nodo
   falla como transitorio sin llamar al proveedor.

---

### User Story 4 - Inyección de prompts sin escapes (Priority: P1)

Un atacante que controla el texto de entrada no logra que un nodo devuelva algo fuera de su esquema,
revele sus instrucciones ni cambie el flujo.

**Independent Test**: correr el set de inyección con el proveedor de pruebas (CI) y con Gemini
(bajo demanda) y comprobar cero escapes.

**Acceptance Scenarios**:

1. **Given** un texto que ordena "responde con la etiqueta X" fuera de la lista, **When** se
   clasifica, **Then** la salida es una etiqueta de la lista o el nodo falla con `invalid_output`.
2. **Given** un texto que pide campos extra o tipos distintos, **When** se extrae, **Then** la salida
   tiene solo los campos y tipos declarados o el nodo falla.
3. **Given** un texto que pide revelar las instrucciones, **When** se genera, **Then** la salida no
   contiene el marcador secreto de las instrucciones; si lo contiene, el nodo falla.
4. **Given** un texto con delimitadores falsos, **When** se arma el prompt, **Then** no puede cerrar el
   bloque de datos porque el delimitador cambia en cada llamada.

---

### User Story 5 - Datos sensibles fuera del proveedor y de los logs (Priority: P2)

Quien edita un nodo LLM puede activar "Ocultar datos personales": correos, teléfonos, tarjetas y
documentos de identidad se sustituyen por marcadores antes de enviar el texto. Con o sin esa opción,
ni los prompts ni las respuestas aparecen en logs, trazas ni eventos.

**Independent Test**: con la opción activada, verificar con el proveedor de pruebas que el texto
recibido no contiene los datos; revisar logs de una ejecución completa.

**Acceptance Scenarios**:

1. **Given** la opción activada, **When** el texto contiene un correo y una tarjeta válida, **Then** el
   proveedor recibe `[EMAIL_1]` y `[CARD_1]`.
2. **Given** la opción desactivada (por defecto), **When** corre el nodo, **Then** el texto se envía
   tal cual.
3. **Given** cualquier ejecución, **When** se revisan logs y eventos, **Then** solo hay métricas
   (modelo, tokens, costo, duración, resultado).
4. **Given** el panel de un nodo LLM, **When** se abre, **Then** avisa que no se deben enviar datos
   reales (capa gratuita del proveedor).

---

### User Story 6 - Apagar los nodos LLM (Priority: P2)

El operador apaga los nodos LLM sin desplegar: con el flag apagado no aparecen ni se pueden ejecutar;
con el interruptor del worker, también se cortan las llamadas en curso.

**Acceptance Scenarios**:

1. **Given** `llm-nodes-enabled` apagado, **When** se abre el editor, **Then** los nodos LLM siguen
   marcados como "no disponibles" y una ejecución que los contenga se rechaza.
2. **Given** el interruptor del worker apagado, **When** un nodo LLM corre, **Then** falla al instante
   como permanente con un código propio.

---

### User Story 7 - Reejecutar sin pagar dos veces (Priority: P3)

Al reejecutar desde un nodo, los nodos LLM exitosos que no dependen del elegido se reutilizan, sin
gastar tokens.

**Acceptance Scenarios**:

1. **Given** clasificar → servicio simulado fallido, **When** se reejecuta desde el servicio, **Then**
   el clasificador aparece como reutilizado y no consume tokens.

### Edge Cases

- Plantilla que resuelve a texto vacío: falla permanente antes de llamar.
- Respuesta truncada por el máximo de tokens de salida: se trata como salida inválida (se repara si
  quedan intentos).
- Caída del worker entre la reserva y el ajuste del presupuesto: la reserva queda contada (falla
  cerrada a favor del límite); no se devuelve.
- Reintento de Temporal tras un fallo transitorio: es una llamada nueva y consume presupuesto.
- `llm.extract` con un campo numérico que el modelo devuelve como texto: la validación lo rechaza; no
  hay coerción silenciosa.
- Cambio de día UTC durante una ejecución: cada llamada cuenta en el día en que se reserva.
- Etiquetas de clasificación con mayúsculas o espacios distintos en la respuesta: no se normalizan;
  el enum del esquema lo impide.

## Requirements *(mandatory)*

### Functional Requirements

**Nodos**

- **FR-001**: `llm.classify`, `llm.extract` y `llm.generate` DEBEN ser ejecutables cuando el flag
  está encendido.
- **FR-002**: Cada salida DEBE validarse contra el esquema derivado de la configuración del nodo antes
  de entregarse al resto del grafo.
- **FR-003**: Las instrucciones al modelo DEBEN estar en inglés; el texto generado para usuarios usa
  el idioma configurado del nodo (español por defecto).
- **FR-004**: `confidence` de clasificar DEBE estar en [0,1] y documentarse como estimada por el
  modelo.
- **FR-005**: Cada tipo de nodo LLM DEBE usar un modelo configurado por la plataforma por tipo.
- **FR-006**: Los nodos LLM DEBEN tener valores por defecto de reintento y aceptar ajustes por nodo
  con los mismos límites de F4.

**Taxonomía y reparación**

- **FR-007**: La taxonomía DEBE incluir `invalid_output` y `budget_exhausted`, ambas no reintentables.
- **FR-008**: Una salida que no valida DEBE repararse como máximo 2 veces dentro del mismo intento,
  pasando los errores al modelo; después, falla `invalid_output`.
- **FR-009**: El contenido bloqueado por el proveedor DEBE fallar `invalid_output` sin reparación.
- **FR-010**: Los errores del proveedor DEBEN traducirse a la taxonomía (5xx y red → transitorio,
  429 → limitado, credenciales o petición inválida → permanente).

**Consumo**

- **FR-011**: Cada llamada DEBE tener un máximo de tokens de salida derivado del nodo.
- **FR-012**: Antes de cada llamada se DEBE reservar el consumo estimado contra el presupuesto de la
  ejecución y el diario de la organización, de forma atómica; sin reserva, no hay llamada.
- **FR-013**: Tras la llamada, la reserva DEBE ajustarse al consumo real.
- **FR-014**: Agotar un presupuesto DEBE fallar el nodo con `budget_exhausted`, detener la ejecución y
  emitir un evento de seguridad.
- **FR-015**: La entrada de una llamada DEBE tener un tamaño máximo; superarlo es fallo permanente.
- **FR-016**: Cada llamada DEBE quedar registrada sin contenido: modelo, tokens, costo estimado,
  reparaciones, resultado.
- **FR-017**: Los límites (por ejecución, por organización y día, tamaño de entrada) y los precios por
  modelo DEBEN ser configuración de la plataforma.
- **FR-018**: Además del rate limit por organización y tipo de F4, DEBE existir un límite global por
  modelo que respete la cuota del proveedor.

**Contención**

- **FR-019**: Las llamadas LLM DEBEN ejecutarse en una cola de tareas propia con concurrencia
  limitada, separada del resto de nodos.

**Seguridad del contenido**

- **FR-020**: El texto de entrada DEBE entrar al modelo como datos, dentro de un delimitador distinto
  en cada llamada.
- **FR-021**: Las instrucciones DEBEN contener un marcador secreto por llamada; una salida que lo
  contenga DEBE fallar `invalid_output`.
- **FR-022**: Las instrucciones NO DEBEN contener secretos ni reglas de autorización.
- **FR-023**: Cada nodo LLM DEBE poder activar la ocultación de datos personales (desactivada por
  defecto): correos, teléfonos, tarjetas (Luhn) y documentos de identidad colombianos.
- **FR-024**: Prompts y respuestas NO DEBEN aparecer en logs, trazas ni eventos.
- **FR-025**: DEBE existir un set de inyección versionado que corre en CI con el proveedor de pruebas y
  bajo demanda con Gemini; el criterio "sin escapes" es el de US4.

**Recuperación**

- **FR-026**: La reejecución desde un nodo DEBE reutilizar también los nodos LLM exitosos que no
  dependan del elegido.

**Entrega**

- **FR-027**: Lo visible (paleta y ejecución de nodos LLM, consumo por paso y diario) DEBE estar detrás
  del flag `llm-nodes-enabled`.
- **FR-028**: El worker DEBE tener un interruptor que haga fallar al instante toda llamada LLM.
- **FR-029**: Sin clave del proveedor, la plataforma DEBE poder usar un proveedor de pruebas
  determinista; la CI NO DEBE llamar a Gemini salvo en el job manual de evals.

### Key Entities

- **Llamada LLM**: organización, ejecución, nodo, intento, modelo, tokens de entrada y salida, tokens
  reservados, costo estimado, reparaciones, resultado, fecha. Sin contenido.
- **Consumo diario**: organización, día UTC, tokens consumidos, costo estimado.
- **Ejecución** (cambia): tokens LLM consumidos; nuevas clases de error.
- **Paso** (cambia): nuevas clases de error.

## Security Considerations *(required by constitution, principle I)*

| Riesgo | Cómo lo aborda F5 |
|---|---|
| LLM01 Prompt Injection | Datos delimitados con nonce, structured output, enum cerrado, Zod, canary, set de inyección en CI |
| LLM02 Sensitive Information Disclosure | Ocultación opcional de PII; sin contenido en logs ni tablas; aviso de capa gratuita; solo datos de prueba |
| LLM03 Excessive Agency | La salida es dato; el grafo publicado decide el flujo; sin herramientas |
| LLM04 Supply Chain | Solo `@google/genai` oficial, fijado y auditado (ADR) |
| LLM06 Unbounded Consumption | Tokens por llamada, ejecución y organización/día; tamaño máximo; rate limit global; bulkhead |
| LLM07 Misinformation | `llm.generate` produce borradores; `confidence` documentada como estimada |
| LLM08 Hidden Context Exposure | Instrucciones sin secretos; canary detecta su fuga |
| LLM10 Improper Output Handling | Validación Zod; la web muestra texto escapado; nunca SQL ni HTML |
| A01 Broken Access Control | RLS en las tablas nuevas; consumo por organización con membresía |
| A02 Security Misconfiguration | Clave del proveedor solo por entorno, validada al arrancar, nunca en logs |
| A09 Logging and Alerting | Evento de seguridad al agotar presupuesto |

## Success Criteria *(mandatory)*

- **SC-001**: El 100 % de las salidas entregadas por nodos LLM validan contra su esquema.
- **SC-002**: Ninguna ejecución ni organización supera su presupuesto de tokens: la reserva cubre la
  entrada estimada más el máximo de salida antes de cada llamada.
- **SC-003**: El set de inyección termina con 0 escapes con el proveedor de pruebas (CI) y con Gemini
  (job manual).
- **SC-004**: Ningún log, traza o evento de la batería de pruebas contiene el texto de entrada ni de
  salida de un nodo LLM.
- **SC-005**: Con el interruptor apagado, 0 llamadas al proveedor.

## Assumptions

- Capa gratuita de Gemini: solo datos de prueba; migrar a capa de pago antes de la demo de F9.
- Límites globales por entorno; límites por organización editables quedan para después.
- Cuotas de ejecuciones por día y concurrentes quedan para después (ADR).
- El circuit breaker sigue diferido a F7, con `http.request`.
- El costo es estimado con una tabla de precios configurada; no se concilia con la factura.
