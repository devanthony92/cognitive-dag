# Feature Specification: Resiliencia (F4)

**Feature Branch**: `005-resilience`

**Created**: 2026-10-31

**Status**: Draft

**Input**: User description: "Fase F4 de docs/PLAN.md: taxonomía de errores aplicada por el motor;
políticas de reintento y tiempo máximo por tipo de nodo con ajustes acotados por nodo; rate limit
(token bucket) para los nodos con efecto, esperando sin ocupar el worker; idempotencia de efectos con
clave por ejecución y nodo y registro de efectos; inyección de fallos determinista en el servicio
simulado; reejecución desde cualquier nodo reutilizando las salidas de los nodos previos exitosos;
página de ejecuciones de la organización con filtros como cola de revisión; pruebas de caos ampliadas,
replay con historiales reales y demo de recuperación. Circuit breaker, granularidad por servicio,
cuotas diarias y bulkheads quedan para fases posteriores."

## User Scenarios & Testing *(mandatory)*

Actores: miembros de una organización (cualquier rol puede ejecutar, ver y reejecutar, como en F3),
el operador de la plataforma, miembros de otra organización (sin acceso).

### User Story 1 - Fallos clasificados y tratados según su clase (Priority: P1)

Cuando un nodo falla, el motor sabe si el fallo es transitorio, limitado, por tiempo o permanente, y
actúa en consecuencia: reintenta con espera creciente, espera lo indicado o falla sin reintentar. La
persona ve en el paso la clase del error y el motivo.

**Why this priority**: es la base de todo lo demás en la fase.

**Independent Test**: ejecutar el servicio simulado configurado con cada clase de fallo y comprobar
intentos, esperas y estado final.

**Acceptance Scenarios**:

1. **Given** un fallo transitorio, **When** ocurre, **Then** el nodo se reintenta con espera
   exponencial con variación aleatoria hasta su máximo de intentos.
2. **Given** un fallo permanente, **When** ocurre, **Then** el nodo falla en el primer intento, sin
   reintentos.
3. **Given** un fallo limitado que indica cuánto esperar, **When** ocurre, **Then** el siguiente
   intento respeta esa espera.
4. **Given** un nodo que supera su tiempo máximo, **When** ocurre, **Then** se clasifica como fallo por
   tiempo y se reintenta como transitorio.
5. **Given** cualquier fallo final, **When** se consulta el paso, **Then** muestra la clase, el código y
   un mensaje sin datos sensibles.

---

### User Story 2 - Ajustar reintentos y tiempos por nodo (Priority: P1)

Quien edita un workflow puede ajustar, dentro de límites, el máximo de intentos, el tiempo máximo y la
espera inicial de cada nodo con efecto. Si no los ajusta, se usan los valores del tipo de nodo.

**Why this priority**: cada servicio tolera fallos distintos; sin ajustes, el motor es rígido.

**Independent Test**: publicar un nodo con 5 intentos y espera inicial de 2 s y comprobar los intentos
y las esperas en la ejecución.

**Acceptance Scenarios**:

1. **Given** un nodo con efecto, **When** se abre su panel en el editor, **Then** se ven los valores
   por defecto del tipo y se pueden cambiar dentro de los límites.
2. **Given** un valor fuera de límites, **When** se valida el borrador, **Then** aparece un error en
   ese campo y no se puede publicar.
3. **Given** un nodo de lógica o un disparador, **When** se abre su panel, **Then** no ofrece ajustes de
   reintento.

---

### User Story 3 - Rate limit sin bloquear el motor (Priority: P1)

Los nodos con efecto respetan un límite de peticiones por organización y tipo de nodo. Cuando no hay
capacidad, el nodo espera su turno sin ocupar al worker; otras ejecuciones y nodos siguen avanzando.

**Why this priority**: protege a los servicios externos y a las demás organizaciones.

**Independent Test**: con un límite bajo, lanzar una ejecución con varios servicios simulados en
paralelo y comprobar que se ejecutan escalonados y todos terminan.

**Acceptance Scenarios**:

1. **Given** un límite de N por segundo, **When** se piden más de N en un segundo, **Then** los
   excedentes esperan y se ejecutan después, sin perderse.
2. **Given** dos organizaciones, **When** una agota su capacidad, **Then** la otra no se ve afectada.
3. **Given** un nodo que espera por el límite, **When** se consulta su paso, **Then** se ve que está
   esperando por el límite.
4. **Given** el almacén del límite no disponible, **When** un nodo pide capacidad, **Then** el fallo se
   trata como transitorio y se reintenta.

---

### User Story 4 - Efectos que no se repiten (Priority: P1)

Cada efecto de un nodo lleva una clave única por ejecución y nodo, igual en todos los reintentos. Si el
efecto ya se confirmó, un reintento o una recuperación tras una caída no lo repite.

**Why this priority**: es lo que hace seguros los reintentos y la recuperación.

**Independent Test**: matar el worker justo después de que el servicio simulado confirme su efecto y
comprobar, al reiniciar, que el efecto figura una sola vez.

**Acceptance Scenarios**:

1. **Given** un nodo con efecto, **When** se reintenta, **Then** usa la misma clave de idempotencia.
2. **Given** un efecto ya confirmado, **When** la activity se vuelve a ejecutar, **Then** devuelve el
   resultado sin repetir el efecto.
3. **Given** un efecto iniciado y no confirmado, **When** la activity se reintenta, **Then** el efecto se
   intenta de nuevo con la misma clave.

---

### User Story 5 - Reejecutar desde un nodo (Priority: P2)

Un miembro abre una ejecución terminada, elige un nodo y la reejecuta desde ahí. Los nodos con efecto
exitosos que no dependen del elegido se reutilizan sin volver a ejecutarse; el elegido y todo lo que
depende de él se ejecutan de nuevo.

**Why this priority**: permite corregir un fallo sin repetir el trabajo ya hecho.

**Independent Test**: en una ejecución fallida en el tercer servicio de una cadena de cuatro,
reejecutar desde ese nodo y comprobar que los dos primeros aparecen como reutilizados.

**Acceptance Scenarios**:

1. **Given** una ejecución terminada, **When** se reejecuta desde un nodo, **Then** se crea una
   ejecución nueva, enlazada a la original e indicando el nodo, sobre la misma versión que la original.
2. **Given** nodos con efecto exitosos que no dependen del elegido, **When** corre la nueva ejecución,
   **Then** aparecen como reutilizados, con la salida de la original y sin intentos.
3. **Given** la lógica (condiciones y merge), **When** corre la nueva ejecución, **Then** se vuelve a
   evaluar con las salidas reutilizadas.
4. **Given** una ejecución cuyas salidas ya no existen por la retención, **When** se intenta reejecutar
   desde un nodo, **Then** se informa que no es posible.
5. **Given** un nodo que no existe en la versión de la ejecución, **When** se pide reejecutar desde él,
   **Then** se rechaza.

---

### User Story 6 - Ejecuciones de la organización como cola de revisión (Priority: P2)

Un miembro abre una página con todas las ejecuciones de su organización, filtra por estado y por
workflow, y desde las fallidas ve el error clasificado y puede reejecutar o reejecutar desde un nodo.

**Independent Test**: provocar fallos en dos workflows y filtrarlos desde la página.

**Acceptance Scenarios**:

1. **Given** varias ejecuciones, **When** se abre "Ejecuciones" de la organización, **Then** se listan
   de la más reciente a la más antigua, paginadas, con workflow, estado, versión, quién la inició,
   inicio y duración.
2. **Given** el filtro "Fallidas", **When** se aplica, **Then** solo aparecen fallidas, con el nodo y la
   clase del error.
3. **Given** el filtro por workflow, **When** se aplica, **Then** solo aparecen las de ese workflow.

---

### User Story 7 - Recuperación demostrable (Priority: P2)

El operador puede demostrar con un comando que las ejecuciones sobreviven a caídas del worker, de
Temporal y de los almacenes de apoyo, y la CI verifica que los cambios del motor no rompen ejecuciones
ya registradas.

**Independent Test**: ejecutar la demo de recuperación y la batería de caos.

**Acceptance Scenarios**:

1. **Given** una ejecución en curso, **When** se mata el worker y se reinicia, **Then** termina sin
   repetir pasos ni efectos.
2. **Given** una ejecución en curso, **When** se reinicia Temporal, **Then** termina al volver.
3. **Given** Valkey caído un momento, **When** un nodo pide capacidad o publica eventos, **Then** la
   ejecución termina y la vista en vivo se recupera.
4. **Given** PostgreSQL caído un momento, **When** el motor registra un paso, **Then** el registro se
   reintenta y queda completo.
5. **Given** historiales reales guardados, **When** corre la CI, **Then** se reproducen con el código
   actual sin errores de determinismo.

### Edge Cases

- Reejecutar desde un nodo omitido en la original: se ejecuta normalmente si su rama se toma.
- Reejecutar desde un disparador: equivale a reejecutar completo con la misma entrada, sobre la misma
  versión.
- Rate limit con espera mayor que el tiempo total del nodo: el nodo falla como limitado.
- Un efecto registrado como iniciado cuya activity ya no se reintenta (ejecución cancelada): queda
  iniciado; no se confirma.
- Reejecución desde un nodo de una ejecución en curso: se rechaza; solo ejecuciones terminadas.

## Requirements *(mandatory)*

### Functional Requirements

**Taxonomía**

- **FR-001**: Todo fallo de un nodo con efecto DEBE clasificarse en una clase: transitorio, limitado,
  tiempo o permanente (salida inválida de LLM y presupuesto llegan en F5).
- **FR-002**: Transitorio y tiempo DEBEN reintentarse con espera exponencial con variación aleatoria;
  limitado DEBE esperar lo indicado; permanente NO DEBE reintentarse.
- **FR-003**: El motor NO DEBE interpretar errores crudos: cada nodo con efecto traduce los suyos a la
  taxonomía.
- **FR-004**: El paso fallido DEBE registrar la clase, el código y un mensaje resumido sin datos de la
  entrada.

**Políticas**

- **FR-005**: Cada tipo de nodo con efecto DEBE tener valores por defecto de intentos, tiempo máximo
  por intento y espera inicial.
- **FR-006**: Cada nodo con efecto PUEDE ajustar esos valores dentro de límites: intentos 1–10, tiempo
  máximo 1–120 s, espera inicial 0,1–30 s; la validación del DAG DEBE rechazar valores fuera de límites.
- **FR-007**: Cada nodo con efecto DEBE tener un tiempo total máximo, que incluye esperas y reintentos.

**Rate limit**

- **FR-008**: Los nodos con efecto DEBEN pedir capacidad a un token bucket por organización y tipo de
  nodo antes de ejecutar su efecto.
- **FR-009**: Sin capacidad, el nodo DEBE reprogramarse para cuando haya, sin ocupar el worker mientras
  espera.
- **FR-010**: La capacidad y la tasa de reposición por tipo de nodo DEBEN ser configuración de la
  plataforma.

**Idempotencia**

- **FR-011**: Cada efecto DEBE llevar la clave `runId:nodeId`, igual en todos sus reintentos.
- **FR-012**: Los efectos DEBEN registrarse como iniciados antes de ejecutarse y como confirmados
  después; un efecto confirmado NO DEBE repetirse.

**Inyección de fallos**

- **FR-013**: El servicio simulado DEBE poder simular fallos limitados con espera indicada, además de
  transitorios, permanentes y por tiempo.
- **FR-014**: El servicio simulado DEBE poder fallar de forma determinista los primeros N intentos.

**Recuperación**

- **FR-015**: Se DEBE poder reejecutar desde cualquier nodo de una ejecución terminada, sobre la misma
  versión de la original.
- **FR-016**: La reejecución desde un nodo DEBE reutilizar las salidas de los nodos con efecto
  exitosos que no dependan del nodo elegido, y marcarlos como reutilizados.
- **FR-017**: La lógica DEBE volver a evaluarse en la nueva ejecución.
- **FR-018**: Si las salidas necesarias ya no existen, la reejecución desde un nodo DEBE rechazarse.

**Revisión**

- **FR-019**: DEBE existir un listado de ejecuciones de la organización, paginado y filtrable por
  estado y workflow.

**Verificación**

- **FR-020**: DEBE haber pruebas de caos que maten el worker, reinicien Temporal y corten Valkey y
  PostgreSQL durante ejecuciones.
- **FR-021**: La CI DEBE reproducir historiales reales guardados para detectar no determinismo.
- **FR-022**: DEBE existir un comando de demo de recuperación.

**Entrega**

- **FR-023**: Lo nuevo visible (ajustes de reintento en el editor, reejecutar desde un nodo y la
  página de ejecuciones de la organización) DEBE estar detrás del flag `resilience-enabled`.

### Key Entities

- **Efecto**: organización, ejecución, nodo, clave de idempotencia, estado (iniciado o confirmado),
  cuándo se inició y cuándo se confirmó. Sin contenido.
- **Paso** (cambia): nuevo estado "reutilizado"; clase del error.
- **Ejecución** (cambia): nodo desde el que se reejecutó.

## Security Considerations *(required by constitution, principle I)*

| Riesgo | Cómo lo aborda F4 |
|---|---|
| A01 Broken Access Control | RLS en efectos; reejecución y listado verifican membresía; 404 ante ejecuciones ajenas |
| A04 Cryptographic Failures | Sin contenido en efectos ni pasos; las salidas reutilizadas viajan solo entre el API y Temporal |
| A06 Insecure Design | Rate limit por organización; límites de reintentos y tiempos acotados; reejecución solo sobre la misma versión |
| A10 Mishandling of Exceptional Conditions | Taxonomía explícita; fallos de Valkey y PostgreSQL tratados como transitorios; pruebas de caos |
| Decisión aceptada | Cualquier miembro reejecuta desde un nodo (como en F3), a revisar en F7 |

## Success Criteria *(mandatory)*

- **SC-001**: El 100 % de los fallos de la batería de referencia terminan con la clase y el número de
  intentos esperados.
- **SC-002**: Con un límite de N por segundo, nunca se ejecutan más de N efectos por segundo por
  organización y tipo de nodo.
- **SC-003**: En la batería de caos, el 100 % de las ejecuciones terminan y ningún efecto confirmado se
  repite.
- **SC-004**: Una reejecución desde un nodo no vuelve a ejecutar ningún nodo reutilizable.
- **SC-005**: La CI reproduce sin errores todos los historiales guardados.

## Assumptions

- Circuit breaker, su granularidad y su comportamiento (decisión 3C: esperar hasta un máximo y luego
  fallar) llegan con los conectores reales de F5/F7.
- Cuotas diarias y de tokens llegan en F5; bulkheads (colas separadas) llegan en F5.
- El rate limit usa por ahora la organización y el tipo de nodo como clave; la granularidad por
  servicio se decide con el circuit breaker.
