# Feature Specification: Motor de ejecución (F3)

**Feature Branch**: `004-execution-engine`

**Created**: 2026-10-30

**Status**: Draft

**Input**: User description: "Fase F3 de docs/PLAN.md: ejecutar la versión activa de un workflow con un
intérprete durable del DAG en Temporal (definición completa en la entrada), nodos ejecutables en F3:
disparador manual, condición, merge y servicio simulado; workflows con nodos de fases posteriores no se
pueden ejecutar; registro de ejecuciones y pasos por nodo en la base de datos con aislamiento por
organización; contenido de entradas y salidas solo en Temporal; vista en vivo por SSE; cualquier
miembro puede ejecutar y ver; cancelar y reejecutar con la misma entrada; ramas no tomadas como
omitidas; fallo rápido; límite de ejecuciones simultáneas por organización."

## User Scenarios & Testing *(mandatory)*

Actores: miembros de una organización (owner, editor o viewer: todos pueden ejecutar y ver, decisión
del autor), miembros de otra organización (sin acceso).

### User Story 1 - Ejecutar un workflow (Priority: P1)

Un miembro abre un workflow publicado, completa el formulario de entrada del disparador manual y lo
ejecuta. El sistema ejecuta la versión activa de forma durable.

**Why this priority**: es la razón de ser de la fase.

**Independent Test**: ejecutar un workflow con disparador, condición, dos ramas y merge, y verificar
que termina con el resultado esperado.

**Acceptance Scenarios**:

1. **Given** un workflow con versión activa y solo nodos ejecutables en F3, **When** un miembro lo
   ejecuta con una entrada válida, **Then** se crea una ejecución ligada a esa versión y comienza.
2. **Given** el disparador manual con campos declarados, **When** se abre "Ejecutar", **Then** se
   muestra un formulario generado desde esos campos y se valida antes de enviar.
3. **Given** un workflow sin versión activa, **When** se intenta ejecutar, **Then** se rechaza.
4. **Given** un workflow cuya versión activa contiene nodos que se ejecutan desde F5 o F7, **When** se
   intenta ejecutar, **Then** la acción está deshabilitada con el motivo y el API la rechaza.
5. **Given** una ejecución en curso, **When** se publica una versión nueva, **Then** la ejecución sigue
   con la versión con la que empezó.

---

### User Story 2 - Semántica de ejecución (Priority: P1)

El motor recorre el DAG respetando conexiones, condiciones, ramas paralelas, merge y fallos.

**Why this priority**: define la corrección del motor.

**Independent Test**: una batería de DAGs de referencia con resultados esperados por nodo.

**Acceptance Scenarios**:

1. **Given** dos ramas independientes, **When** se ejecutan, **Then** corren en paralelo.
2. **Given** una condición, **When** se evalúa, **Then** solo continúa la rama correspondiente y los
   nodos de la otra quedan como omitidos.
3. **Given** un merge "todas", **When** una de sus ramas fue omitida, **Then** espera solo a las ramas
   ejecutadas.
4. **Given** un merge "cualquiera", **When** llega la primera rama, **Then** continúa sin esperar las
   demás.
5. **Given** un nodo que falla tras agotar sus reintentos, **When** ocurre, **Then** la ejecución
   falla, las ramas en curso se cancelan y el error queda asociado al nodo.
6. **Given** el servicio simulado configurado con latencia o fallos, **When** se ejecuta, **Then** se
   comporta según su configuración.
7. **Given** referencias a salidas de nodos anteriores, **When** un nodo se ejecuta, **Then** recibe
   los valores resueltos.
8. **Given** una caída del worker durante una ejecución, **When** vuelve, **Then** la ejecución
   continúa sin repetir nodos ya terminados.

---

### User Story 3 - Ver ejecuciones en vivo (Priority: P1)

Un miembro ve la lista de ejecuciones de un workflow y abre una para ver el estado de cada nodo
actualizándose en vivo sobre el grafo.

**Why this priority**: es lo que hace visible y demostrable al motor.

**Independent Test**: abrir una ejecución con un servicio simulado lento y ver cambiar los estados sin
recargar.

**Acceptance Scenarios**:

1. **Given** un workflow, **When** se abre "Ejecuciones", **Then** se listan con estado, versión,
   quién la inició, inicio y duración, de la más reciente a la más antigua y paginadas.
2. **Given** una ejecución en curso, **When** se abre su detalle, **Then** el grafo de su versión
   muestra el estado de cada nodo (pendiente, en curso, completado, fallido, omitido, cancelado) y se
   actualiza en vivo.
3. **Given** el detalle de un nodo, **When** se consulta, **Then** se ven su estado, intentos,
   duración, error y, mientras Temporal lo conserve, su entrada y salida.
4. **Given** una conexión en vivo que se corta, **When** ocurre, **Then** la vista se recupera sola sin
   perder estados.
5. **Given** un miembro de otra organización, **When** pide una ejecución o su flujo en vivo, **Then**
   recibe recurso inexistente.

---

### User Story 4 - Cancelar y reejecutar (Priority: P2)

Un miembro cancela una ejecución en curso o reejecuta una terminada con la misma entrada.

**Independent Test**: cancelar una ejecución con un nodo lento; reejecutar una fallida.

**Acceptance Scenarios**:

1. **Given** una ejecución en curso, **When** se cancela, **Then** termina como cancelada y los nodos
   en curso quedan cancelados.
2. **Given** una ejecución terminada cuya entrada aún existe en Temporal, **When** se reejecuta,
   **Then** se crea una ejecución nueva con la misma entrada sobre la versión activa actual, enlazada a
   la original.
3. **Given** una ejecución cuya entrada ya no existe por la retención, **When** se intenta reejecutar,
   **Then** se informa que no es posible.

---

### User Story 5 - Límite de ejecuciones simultáneas (Priority: P2)

Cada organización tiene un máximo de ejecuciones en curso.

**Independent Test**: fijar el límite en 1, iniciar una ejecución lenta y luego otra.

**Acceptance Scenarios**:

1. **Given** el límite alcanzado, **When** se inicia otra ejecución, **Then** se rechaza indicando el
   límite.
2. **Given** que una ejecución termina, **When** se inicia otra, **Then** se acepta.
3. **Given** el límite por defecto (5), **When** el operador lo cambia para una organización, **Then**
   se aplica a sus siguientes ejecuciones.

### Edge Cases

- Workflow archivado con ejecuciones en curso: las ejecuciones terminan; no se pueden iniciar nuevas.
- Entrada que no cumple los campos del disparador: rechazo con errores por campo.
- Temporal no disponible al iniciar: error 503 y ninguna ejecución registrada como iniciada.
- Ejecución que supera su duración máxima: termina como vencida.
- Dos inicios simultáneos que superarían el límite: solo se acepta hasta el límite.

## Requirements *(mandatory)*

### Functional Requirements

**Ejecución**

- **FR-001**: Solo se DEBE poder ejecutar la versión activa de un workflow no archivado.
- **FR-002**: Una versión con algún nodo cuyo `executableFrom` sea posterior a F3 NO DEBE poder
  ejecutarse.
- **FR-003**: La ejecución DEBE usar la definición exacta de la versión con la que empezó.
- **FR-004**: La entrada DEBE validarse contra los campos del disparador manual.
- **FR-005**: Ramas independientes DEBEN ejecutarse en paralelo.
- **FR-006**: Los nodos de una rama no tomada DEBEN quedar como omitidos; un merge "todas" DEBE esperar
  solo a sus ramas ejecutadas.
- **FR-007**: Un nodo que falla tras sus reintentos DEBE hacer fallar la ejecución y cancelar las ramas
  en curso.
- **FR-008**: Cada nodo con efecto DEBE tener tiempo máximo y política de reintentos explícitos; la
  ejecución completa DEBE tener una duración máxima.
- **FR-009**: Las condiciones DEBEN evaluarse con el AST tipado de F2, sin evaluación de código.
- **FR-010**: Una caída del worker NO DEBE repetir nodos terminados ni perder la ejecución.

**Registro**

- **FR-011**: Cada ejecución DEBE registrarse con su workflow, versión, estado, quién la inició,
  identificador de correlación, inicio, fin y error resumido.
- **FR-012**: Cada nodo DEBE registrar estado, intentos, inicio, fin, duración y error resumido, sin el
  contenido de entradas y salidas (decisión del autor: el contenido vive solo en Temporal y desaparece
  con su retención).
- **FR-013**: Los registros DEBEN estar aislados por organización en la aplicación y en la base de
  datos.

**Vista en vivo**

- **FR-014**: Los cambios de estado DEBEN llegar al navegador en vivo, con recuperación automática si
  la conexión se corta.
- **FR-015**: El flujo en vivo DEBE exigir sesión y membresía en la organización de la ejecución.

**Control**

- **FR-016**: Cualquier miembro DEBE poder ejecutar, ver, cancelar y reejecutar (decisión del autor).
  Revisar en F7, cuando existan nodos con efectos externos.
- **FR-017**: Reejecutar DEBE crear una ejecución nueva con la misma entrada, enlazada a la original,
  sobre la versión activa actual.

**Límites**

- **FR-018**: Cada organización DEBE tener un máximo de ejecuciones en curso (5 por defecto), que solo
  cambia el operador de la plataforma.

**Entrega**

- **FR-019**: Iniciar, cancelar y reejecutar DEBEN emitir eventos de seguridad.
- **FR-020**: Todo F3 DEBE estar detrás del flag `execution-enabled`.

### Key Entities

- **Ejecución**: organización, workflow, versión, estado, quién la inició, correlación, inicio, fin,
  error resumido, ejecución original si es una reejecución.
- **Paso**: ejecución, nodo, tipo, estado, intentos, inicio, fin, duración, error resumido.

## Security Considerations *(required by constitution, principle I)*

| Riesgo | Cómo lo aborda F3 |
|---|---|
| A01 Broken Access Control | RLS en ejecuciones y pasos; membresía verificada en API y en el flujo en vivo; 404 ante ejecuciones ajenas |
| A04 Cryptographic Failures | Sin contenido de datos en la base; Temporal solo en red local |
| A05 Injection | Condiciones como AST; referencias resueltas sin evaluación |
| A06 Insecure Design | Límite de ejecuciones simultáneas; duración máxima; nodos de fases futuras bloqueados |
| A10 Mishandling of Exceptional Conditions | Fallo rápido; estados terminales explícitos; 503 si Temporal no está disponible |
| Decisión aceptada | Viewer puede ejecutar (FR-016); riesgo nulo en F3, a revisar en F7 |

## Success Criteria *(mandatory)*

- **SC-001**: Un DAG de 10 nodos con ramas paralelas, condición y merge termina con los estados
  esperados por nodo en el 100 % de los casos de la batería de referencia.
- **SC-002**: Los cambios de estado aparecen en la vista en vivo en menos de 1 segundo.
- **SC-003**: Tras matar el worker a mitad de una ejecución, el 100 % de las ejecuciones terminan sin
  repetir nodos completados.
- **SC-004**: El 100 % de los accesos entre organizaciones a ejecuciones y flujos en vivo se rechazan.
- **SC-005**: Nunca hay más ejecuciones en curso que el límite de la organización.

## Assumptions

- La retención del historial de Temporal en desarrollo es la del servidor local; en producción se
  define en F9.
- Reejecutar desde un nodo y las cuotas avanzadas llegan en F4.
- Los disparadores webhook y programado llegan en F7.
