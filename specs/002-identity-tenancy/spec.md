# Feature Specification: Identidad y multi-tenant (F1)

**Feature Branch**: `002-identity-tenancy`

**Created**: 2026-10-29

**Status**: Draft

**Input**: User description: "Fase F1 de docs/PLAN.md: registro, verificación de email, inicio y
cierre de sesión con sesiones opacas en cookie, recuperación y cambio de contraseña, organizaciones
con membresías y roles (owner, editor, viewer), organización personal al registrarse, aislamiento
entre organizaciones en dos capas (aplicación y Row-Level Security), eventos de seguridad en logs
estructurados, rate limit progresivo por cuenta e IP, mensajes genéricos que no revelan si un email
existe, contraseñas de 8 a 25 caracteres sin reglas de composición y con rechazo de contraseñas
comunes, correo de desarrollo capturado localmente. MFA queda para F8."

## User Scenarios & Testing *(mandatory)*

Actores:
- **Visitante**: persona sin cuenta.
- **Usuario**: persona con cuenta verificada.
- **Owner**, **editor**, **viewer**: rol de un usuario dentro de una organización concreta.
- **Atacante**: intenta adivinar contraseñas, enumerar cuentas o acceder a otra organización.

### User Story 1 - Registro y verificación de email (Priority: P1)

Un visitante se registra con nombre, email y contraseña. El sistema crea su cuenta y una
organización personal de la que es owner, y le envía un correo de verificación. Solo puede iniciar
sesión después de verificar su email.

**Why this priority**: sin cuentas no existe ninguna otra historia; la verificación evita cuentas
con emails ajenos.

**Independent Test**: registrarse, abrir el enlace del correo capturado en el entorno local,
verificar e iniciar sesión.

**Acceptance Scenarios**:

1. **Given** un visitante, **When** se registra con datos válidos, **Then** recibe un correo de
   verificación y la respuesta le indica que revise su correo.
7. **Given** el formulario de registro, **When** el visitante lo abre, **Then** el nombre de la
   organización personal viene propuesto como "Organización de <nombre>", puede editarlo antes de
   enviar y la organización se crea con el nombre enviado (1–100 caracteres). Si el API no recibe
   nombre, usa el valor por defecto.
8. **Given** el formulario de registro, restablecimiento o cambio de contraseña, **When** la
   contraseña y su confirmación no coinciden, **Then** la web lo indica en español y no envía la
   petición; la confirmación nunca viaja al API.
9. **Given** cualquier campo de contraseña de la web, **When** el usuario pulsa el icono de ojo,
   **Then** la contraseña se muestra u oculta y el botón tiene una etiqueta accesible ("Mostrar
   contraseña" / "Ocultar contraseña").
2. **Given** un email que ya tiene cuenta, **When** alguien se registra con él, **Then** la
   respuesta es idéntica a la de un registro nuevo y el titular de la cuenta recibe un correo
   avisándole del intento.
3. **Given** una contraseña de menos de 8 caracteres, de más de 25 o incluida en la lista de
   contraseñas comunes, **When** el visitante se registra, **Then** el registro se rechaza con un
   mensaje que explica la regla incumplida.
4. **Given** un enlace de verificación válido, **When** el usuario lo abre, **Then** su email queda
   verificado y el enlace deja de servir.
5. **Given** un enlace de verificación vencido o ya usado, **When** se abre, **Then** se rechaza y
   se ofrece reenviar el correo.
6. **Given** una cuenta sin verificar, **When** intenta iniciar sesión, **Then** no se crea sesión
   y la respuesta no distingue este caso de credenciales inválidas.

---

### User Story 2 - Inicio y cierre de sesión (Priority: P1)

Un usuario inicia sesión con email y contraseña y obtiene una sesión que dura mientras la use, con
un límite absoluto. Puede cerrar sesión en cualquier momento. Los intentos fallidos repetidos se
frenan progresivamente.

**Why this priority**: es la puerta de entrada a toda funcionalidad protegida.

**Independent Test**: iniciar sesión, acceder a un recurso protegido, cerrar sesión y verificar
que el recurso deja de ser accesible.

**Acceptance Scenarios**:

1. **Given** credenciales válidas de una cuenta verificada, **When** el usuario inicia sesión,
   **Then** obtiene una sesión nueva y cualquier identificador de sesión previo del navegador deja
   de ser válido.
2. **Given** credenciales inválidas, un email inexistente o una cuenta sin verificar, **When** se
   intenta iniciar sesión, **Then** la respuesta es la misma en los tres casos.
3. **Given** varios intentos fallidos seguidos para la misma cuenta o desde la misma IP, **When**
   llega otro intento, **Then** el sistema exige una espera creciente antes de evaluarlo e indica
   cuándo reintentar.
4. **Given** una sesión activa, **When** el usuario cierra sesión, **Then** la sesión queda
   revocada de inmediato en el servidor.
5. **Given** una sesión sin actividad durante más del tiempo de inactividad, o que superó su
   duración máxima, **When** se usa, **Then** se rechaza como no autenticada.
6. **Given** una petición que cambia estado sin la protección contra falsificación de peticiones
   entre sitios, **When** llega con una sesión válida, **Then** se rechaza.

---

### User Story 3 - Aislamiento entre organizaciones (Priority: P1)

Cada petición autenticada opera sobre una organización activa. Un usuario solo ve y modifica datos
de organizaciones de las que es miembro, aunque manipule identificadores o la organización activa.

**Why this priority**: es el control de seguridad central del producto multi-tenant (OWASP A01).

**Independent Test**: con dos usuarios de organizaciones distintas, intentar cada operación de un
usuario sobre recursos del otro y verificar que todas fallan.

**Acceptance Scenarios**:

1. **Given** un usuario miembro de la organización A, **When** elige A como organización activa,
   **Then** sus operaciones afectan solo datos de A.
2. **Given** un usuario que no es miembro de B, **When** indica B como organización activa,
   **Then** la petición se rechaza como recurso inexistente, sin revelar que B existe.
3. **Given** un usuario de A que conoce el identificador de un recurso de B, **When** lo consulta o
   modifica, **Then** la respuesta es de recurso inexistente.
4. **Given** un defecto en la capa de aplicación que omita el filtro por organización, **When** se
   consulta la base de datos, **Then** la segunda capa de aislamiento sigue impidiendo leer o
   escribir datos de otra organización.
5. **Given** un usuario miembro de varias organizaciones, **When** cambia de organización activa
   desde la interfaz, **Then** ve solo los datos de la organización elegida.

---

### User Story 4 - Recuperación y cambio de contraseña (Priority: P2)

Un usuario que olvidó su contraseña la restablece con un enlace por correo. Un usuario autenticado
cambia su contraseña indicando la actual. Ambos cierran las demás sesiones abiertas.

**Why this priority**: necesario para operar cuentas reales; depende de US1 y US2.

**Independent Test**: solicitar el restablecimiento, usar el enlace del correo capturado y comprobar
que la contraseña nueva funciona y las sesiones anteriores quedan revocadas.

**Acceptance Scenarios**:

1. **Given** cualquier email, exista o no, **When** se solicita restablecer la contraseña, **Then**
   la respuesta es la misma y solo el titular de una cuenta existente recibe el correo.
2. **Given** un enlace de restablecimiento válido, **When** el usuario define una contraseña que
   cumple la política, **Then** la contraseña cambia, el enlace deja de servir y todas sus sesiones
   quedan revocadas.
3. **Given** un enlace vencido o ya usado, **When** se usa, **Then** se rechaza.
4. **Given** un usuario autenticado, **When** cambia su contraseña con la contraseña actual
   correcta, **Then** el cambio se aplica, se revocan sus otras sesiones y la actual sigue activa.
5. **Given** una contraseña actual incorrecta, **When** intenta cambiarla, **Then** se rechaza y
   cuenta como intento fallido para el rate limit.

---

### User Story 5 - Miembros y roles (Priority: P2)

Un owner invita personas por email, cambia roles y quita miembros. Editores y viewers ven la lista
de miembros pero no la modifican.

**Why this priority**: completa el modelo multi-usuario; F2 y siguientes asignan permisos con
estos roles.

**Independent Test**: un owner invita a un segundo usuario, este acepta, el owner cambia su rol y
luego lo quita; se verifica cada estado.

**Acceptance Scenarios**:

1. **Given** un owner, **When** invita un email con un rol, **Then** se envía un correo con un
   enlace de invitación de un solo uso y con vencimiento.
2. **Given** una invitación válida, **When** la persona invitada la acepta con una cuenta
   verificada de ese mismo email, **Then** queda como miembro con el rol indicado.
3. **Given** una invitación para un email sin cuenta, **When** se abre el enlace, **Then** se
   ofrece registrarse y la invitación se acepta al verificar el email.
4. **Given** un owner, **When** cambia el rol de un miembro o lo quita, **Then** el cambio se
   aplica y las sesiones de ese miembro dejan de tener acceso a la organización.
5. **Given** que una organización tiene un único owner, **When** alguien intenta quitarlo o
   cambiarle el rol, **Then** se rechaza.
6. **Given** un editor o un viewer, **When** intenta invitar, cambiar roles o quitar miembros,
   **Then** se rechaza por falta de permisos.
7. **Given** cualquier miembro, **When** abre la página de miembros, **Then** ve nombres, emails y
   roles de los miembros de la organización activa.
8. **Given** un owner, **When** renombra la organización (1–100 caracteres), **Then** el nuevo
   nombre se ve de inmediato en el selector y en las cabeceras, y las invitaciones pendientes
   muestran el nombre actual.
9. **Given** un editor o un viewer, **When** intenta renombrar la organización, **Then** se rechaza
   con 403; si no es miembro, con 404.

---

### User Story 6 - Eventos de seguridad registrados (Priority: P3)

Cada acción de seguridad queda registrada en los logs estructurados del sistema, con usuario,
organización, momento, origen e identificador de correlación, para que un operador pueda
investigarla. La consulta de estos eventos por los owners desde la aplicación queda fuera de F1.

**Why this priority**: es la evidencia mínima que exige OWASP A09; no bloquea el uso del producto.

**Independent Test**: realizar cada acción y verificar que su evento aparece en los logs con los
campos esperados y sin datos sensibles.

**Acceptance Scenarios**:

1. **Given** cualquier acción de FR-026, **When** ocurre, **Then** se registra un evento con tipo,
   resultado, momento, IP, identificador de correlación y, si aplica, usuario y organización.
2. **Given** un evento registrado, **When** se revisa, **Then** no contiene contraseñas, tokens ni
   identificadores de sesión.

### Edge Cases

- Dos registros simultáneos con el mismo email: se crea una sola cuenta.
- Un usuario quitado de una organización que era su organización activa: la siguiente petición se
  rechaza y la interfaz le lleva a otra organización de la que sea miembro.
- Un usuario expulsado de todas las organizaciones compartidas conserva siempre su organización
  personal, que no puede abandonar (ver supuestos).
- Invitación a un email que ya es miembro: se rechaza con un mensaje claro para el owner.
- Varias pestañas con distinta organización activa: cada petición indica su organización activa y
  se valida de forma independiente.
- El almacén de sesiones no está disponible: las peticiones autenticadas fallan cerradas con error
  503, nunca se tratan como autenticadas.
- El servicio de correo no está disponible: el registro y la recuperación responden igual, el
  envío se reintenta y el fallo queda registrado.
- Rate limit alcanzado: respuesta 429 en formato de error estándar con el tiempo de espera.

## Requirements *(mandatory)*

### Functional Requirements

**Cuentas y contraseñas**

- **FR-001**: El sistema DEBE permitir registrarse con nombre, email, contraseña y, opcionalmente,
  el nombre de la organización personal (1–100 caracteres, recortado; por defecto "Organización de
  <nombre>"), y crear en la misma operación esa organización con el usuario como owner.
- **FR-002**: Las contraseñas DEBEN tener entre 8 y 25 caracteres (puntos de código tras NFKC),
  aceptar cualquier carácter Unicode (incluidos espacios), no exigir reglas de composición y
  rechazarse si figuran en una lista de contraseñas comunes incluida en el proyecto (sin llamadas
  externas). El inicio de sesión sigue aceptando hasta 128 caracteres para no revelar la política.
  Este rango es decisión del autor (2026-10-29) y se aparta de NIST 800-63B-4 (mínimo 15 para un
  solo factor, máximo de al menos 64): desviación aceptada y documentada en ADR-0026 y en el modelo
  de amenazas, a revisar cuando llegue MFA (F8).
- **FR-003**: Las contraseñas DEBEN almacenarse solo como hash con un algoritmo resistente a
  ataques por fuerza bruta y parámetros vigentes de OWASP.
- **FR-004**: El email DEBE normalizarse (minúsculas, sin espacios) y ser único entre cuentas.
- **FR-005**: El sistema DEBE enviar un correo de verificación con un enlace de un solo uso que
  vence en 24 horas, y permitir reenviarlo con rate limit.
- **FR-006**: Una cuenta sin email verificado NO DEBE poder iniciar sesión.

**Sesiones**

- **FR-007**: El inicio de sesión exitoso DEBE crear una sesión nueva con identificador aleatorio de
  al menos 128 bits, entregado solo en una cookie `HttpOnly`, `Secure` y `SameSite=Lax`, y
  almacenado en el servidor únicamente como hash.
- **FR-008**: Las sesiones DEBEN expirar tras 2 horas sin actividad y a las 12 horas desde su
  creación, lo que ocurra primero. Si el registro de actividad se pierde, la sesión DEBE tratarse
  como expirada.
- **FR-009**: Cerrar sesión, cambiar o restablecer la contraseña DEBEN revocar las sesiones
  correspondientes en el servidor de forma inmediata.
- **FR-010**: Toda petición que cambie estado DEBE exigir protección contra CSRF además de la
  cookie de sesión.
- **FR-011**: Si el almacén de sesiones no responde, el sistema DEBE fallar cerrado (503) y nunca
  aceptar la petición como autenticada.

**Protección contra abuso**

- **FR-012**: El inicio de sesión DEBE aplicar rate limit por cuenta y por IP con espera
  progresiva: a partir del 5.º fallo en 15 minutos, cada intento adicional exige una espera que se
  duplica desde 1 segundo hasta un máximo de 15 minutos.
- **FR-013**: Registro, reenvío de verificación, solicitud de restablecimiento e invitaciones DEBEN
  tener rate limit por IP y por email destino.
- **FR-014**: Las respuestas de registro, inicio de sesión y solicitud de restablecimiento NO DEBEN
  revelar si un email tiene cuenta, ni por contenido ni por código de estado.
- **FR-015**: Los rechazos por rate limit DEBEN responder 429 en formato RFC 9457 con el tiempo de
  espera.

**Organizaciones y aislamiento**

- **FR-016**: Un usuario DEBE poder pertenecer a varias organizaciones con un rol por organización:
  `owner`, `editor` o `viewer`.
- **FR-017**: Toda petición autenticada a recursos de una organización DEBE indicar la organización
  activa, y el sistema DEBE verificar la membresía en cada petición.
- **FR-018**: El acceso a una organización de la que el usuario no es miembro, o a un recurso de
  otra organización, DEBE responder como recurso inexistente (404).
- **FR-019**: El aislamiento DEBE aplicarse en dos capas independientes: la aplicación y la base de
  datos. La capa de base de datos DEBE impedir el acceso entre organizaciones aunque la aplicación
  omita el filtro.
- **FR-020**: La cuenta con la que se ejecuta la aplicación NO DEBE poder saltarse la capa de
  aislamiento de la base de datos ni modificar el esquema.
- **FR-021**: Todos los endpoints del API, excepto salud, flags públicos y los de autenticación,
  DEBEN exigir sesión. El ping de F0 pasa a requerir sesión y organización activa.

**Miembros e invitaciones**

- **FR-022**: Solo un owner DEBE poder invitar, cambiar roles y quitar miembros.
- **FR-023**: Las invitaciones DEBEN ser de un solo uso, vencer a los 7 días, estar ligadas al email
  invitado y poder revocarse.
- **FR-024**: Una organización NO DEBE poder quedarse sin owner.
- **FR-025**: Un cambio de rol o una expulsión DEBE aplicarse en la siguiente petición del miembro
  afectado.

**Eventos de seguridad**

- **FR-026**: El sistema DEBE registrar en los logs estructurados: registro, verificación de email,
  inicio de sesión exitoso y fallido, cierre de sesión, bloqueo por rate limit, solicitud y uso de
  restablecimiento, cambio de contraseña, invitación enviada, aceptada y revocada, cambio de rol y
  expulsión y renombrado de organización (`org.renamed`).
- **FR-027**: Cada evento DEBE incluir tipo, momento, resultado, IP, identificador de correlación y,
  si aplica, usuario y organización. NO DEBE incluir contraseñas, tokens ni identificadores de sesión.
- **FR-028**: Los eventos DEBEN tener un nombre de tipo estable para poder filtrarlos.
- **FR-029**: *(Diferido)* La consulta de eventos por los owners desde la aplicación queda para una
  fase posterior.

**Correo**

- **FR-030**: El envío de correo DEBE hacerse a través de una interfaz reemplazable; en desarrollo
  los correos DEBEN capturarse localmente y verse en una interfaz web, sin salir a internet.
- **FR-031**: Los enlaces de verificación, restablecimiento e invitación DEBEN contener tokens
  aleatorios de al menos 128 bits, almacenados solo como hash.

**Interfaz web**

- **FR-032**: La web DEBE ofrecer: registro, verificación de email, inicio y cierre de sesión,
  solicitud y restablecimiento de contraseña, cambio de contraseña, selector de organización activa
  y página de miembros (lista para todos; invitar, cambiar rol y quitar solo para owners), y
  ajustes de la organización (renombrar, solo owners).
- **FR-034**: Los formularios de registro, restablecimiento y cambio de contraseña DEBEN pedir la
  contraseña nueva dos veces y validar la coincidencia solo en el navegador; la confirmación no se
  envía al API.
- **FR-035**: Todo campo de contraseña de la web DEBE ofrecer un botón de icono para mostrar u
  ocultar el texto, con etiqueta accesible.
- **FR-036**: Un owner DEBE poder renombrar una organización (1–100 caracteres, recortado).
  `PATCH /api/v1/organizations/{organizationId}` exige CSRF, responde 403 a editor y viewer y 404 a
  quien no es miembro, y registra el evento `org.renamed`. No cambia el modelo de datos.

**Entrega**

- **FR-033**: Mientras la spec esté incompleta en `main`, la funcionalidad nueva DEBE permanecer
  detrás de un feature flag apagado por defecto; activar el flag NO DEBE desactivar ningún control
  de seguridad existente.

### Key Entities

- **Usuario**: nombre, email normalizado, hash de contraseña, momento de verificación del email y
  momento de creación. Preparado para añadir un segundo factor.
- **Organización**: nombre, indicador de organización personal, momento de creación.
- **Membresía**: usuario, organización, rol; única por par usuario–organización.
- **Sesión**: hash del identificador, usuario, momentos de creación y expiración absoluta,
  revocación, IP y agente de usuario de origen. La inactividad se controla fuera de la base de datos.
- **Invitación**: organización, email invitado, rol, hash del token, quién invita, vencimiento,
  estado (pendiente, aceptada, revocada, vencida).
- **Token de un solo uso**: propósito (verificación o restablecimiento), usuario, hash, vencimiento,
  momento de uso.

## Security Considerations *(required by constitution, principle I)*

| Riesgo OWASP Top 10:2025 | Cómo lo aborda F1 |
|---|---|
| A01 Broken Access Control | Membresía verificada en cada petición; 404 ante organizaciones o recursos ajenos; aislamiento en aplicación y base de datos; cuenta de ejecución sin privilegios para saltar el aislamiento; pruebas de acceso cruzado por endpoint |
| A02 Security Misconfiguration | Cookies `HttpOnly`, `Secure`, `SameSite=Lax`; CORS restringido; correo de desarrollo sin salida a internet |
| A04 Cryptographic Failures | Hash de contraseñas resistente a fuerza bruta; identificadores de sesión y tokens aleatorios ≥ 128 bits guardados como hash |
| A05 Injection | Validación de toda entrada con los contratos compartidos; consultas parametrizadas |
| A06 Insecure Design | Mensajes genéricos anti-enumeración; organización que nunca queda sin owner; invitaciones ligadas al email |
| A07 Authentication Failures | Política de contraseñas de 8–25 caracteres, sin composición y con lista de comunes (desviación aceptada de NIST 800-63B-4, ADR-0026; mitigada por la lista, el rate limit progresivo y Argon2id); rate limit progresivo; rotación de sesión al iniciar; revocación al cerrar sesión y al cambiar contraseña; expiración por inactividad y absoluta; CSRF |
| A03 Software Supply Chain / A08 Integrity | Sin dependencias nuevas de ejecución en el cierre; el icono de ojo es un SVG propio |
| A09 Security Logging and Alerting Failures | Eventos de seguridad en logs estructurados, con tipo estable, correlación y sin datos sensibles |
| A10 Mishandling of Exceptional Conditions | Fallo cerrado si el almacén de sesiones o la base de datos no responden |

- OWASP LLM Top 10: no aplica (sin uso de LLM en F1).
- MFA: fuera de alcance; planificado para F8. El modelo de usuario queda preparado.
- Renombrar una organización es un cambio de un campo visible; solo lo hace el owner (A01) y usa la
  política de RLS `organizations_update` existente.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Un visitante completa registro, verificación de email e inicio de sesión en menos de
  3 minutos.
- **SC-002**: El 100 % de los intentos de acceso entre organizaciones de la suite de pruebas
  (cada endpoint protegido × cada combinación de organización ajena) se rechazan.
- **SC-003**: Con la capa de aplicación deshabilitada en una prueba dedicada, el 100 % de las
  lecturas y escrituras entre organizaciones siguen bloqueadas.
- **SC-004**: Para un email existente y uno inexistente, las respuestas de registro, inicio de
  sesión y restablecimiento tienen el mismo código de estado y el mismo cuerpo, y su tiempo medio
  difiere en menos de 50 ms.
- **SC-005**: Una sesión revocada (cierre de sesión o cambio de contraseña) es rechazada en la
  siguiente petición, en menos de 1 segundo.
- **SC-006**: Un atacante que prueba contraseñas contra una cuenta no supera 50 intentos evaluados
  en la primera hora.
- **SC-007**: El 100 % de las acciones de FR-026 generan un evento de seguridad en los logs con
  todos los campos de FR-027.
- **SC-008**: Los correos de desarrollo aparecen en la interfaz local en menos de 10 segundos.

## Assumptions

- La organización personal no puede eliminarse ni abandonarse en F1; borrar cuentas y
  organizaciones queda fuera de alcance.
- Las organizaciones adicionales a la personal se crean desde la interfaz por cualquier usuario,
  que queda como owner.
- Permisos de editor y viewer sobre workflows se definen en F2; en F1 ambos solo leen la lista de
  miembros.
- Los tiempos de sesión (2 h de inactividad, 12 h absolutas) son valores por defecto
  configurables.
- Un reinicio del almacén de sesiones cierra todas las sesiones activas; es aceptable porque falla
  cerrado.
- La retención de logs y la anonimización de usuarios borrados lógicamente se deciden en F9.
- La IP del cliente se toma de la conexión directa; el soporte para proxies de confianza se define
  con el despliegue (F9).
- El proveedor de correo real se elige en F9; F1 solo usa el entorno local de captura.
- La interfaz no se traduce: textos en español, igual que los mensajes de error.
