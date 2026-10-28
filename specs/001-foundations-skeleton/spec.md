# Feature Specification: Fundaciones y walking skeleton (F0)

**Feature Branch**: `001-foundations-skeleton`

**Created**: 2026-10-28

**Status**: Draft

**Input**: User description: "Fase F0 de docs/PLAN.md: walking skeleton de punta a punta (web → API →
motor de workflows → worker → resultado visible), infraestructura transversal exigida por la
constitution (errores RFC 9457, Correlation-ID, logs estructurados con redacción, validación de
configuración, health checks, feature flags con proveedor estático), CI con gates de calidad y build
multi-arch sin publicar, herramientas de calidad del monorepo, ADRs en formato MADR, modelo de
amenazas STRIDE v1 y entorno local híbrido (infraestructura en contenedores, aplicaciones en el host)."

## User Scenarios & Testing *(mandatory)*

Actores de esta fase:
- **Desarrollador**: construye el proyecto (hoy, el autor; mañana, cualquiera que clone el repo).
- **Revisor**: persona que evalúa el repositorio público (reclutador, revisor técnico).
- **Operador**: quien vigila el estado del sistema en ejecución.

### User Story 1 - Entorno local en un comando (Priority: P1)

Un desarrollador clona el repositorio en una máquina con los prerrequisitos documentados, ejecuta
un comando para levantar los servicios de infraestructura y otro para levantar las aplicaciones, y
obtiene un entorno funcional sin pasos manuales adicionales.

**Why this priority**: sin un entorno reproducible no se puede construir ni verificar ninguna otra
historia; es la base de todo el proyecto.

**Independent Test**: en una máquina limpia con los prerrequisitos, seguir solo el README y
comprobar que todos los servicios reportan estado saludable.

**Acceptance Scenarios**:

1. **Given** un clon nuevo del repositorio y los prerrequisitos instalados, **When** el desarrollador
   ejecuta el comando de infraestructura y luego el de aplicaciones, **Then** la interfaz web, el API,
   el worker y la consola del motor de workflows quedan accesibles y saludables.
2. **Given** el entorno en ejecución, **When** el desarrollador modifica código de una aplicación,
   **Then** el cambio se refleja sin reiniciar manualmente el entorno.
3. **Given** el entorno detenido y reiniciado, **When** se consultan ejecuciones previas en la consola
   del motor de workflows, **Then** el historial de ejecuciones anteriores se conserva.
4. **Given** una variable de configuración obligatoria ausente o inválida, **When** se inicia una
   aplicación, **Then** esta se niega a arrancar e indica qué variable falla, sin revelar su valor.

---

### User Story 2 - Recorrido de punta a punta (walking skeleton) (Priority: P1)

Un usuario pulsa "Ejecutar ping" en la interfaz web. El sistema registra la solicitud, la ejecuta
como un workflow durable en el worker y la interfaz muestra el resultado, su estado y el
identificador de correlación.

**Why this priority**: demuestra que todas las piezas de la arquitectura están conectadas y
valida las decisiones técnicas antes de invertir en funcionalidad real.

**Independent Test**: ejecutar el ping desde la interfaz y verificar el resultado en pantalla y la
ejecución correspondiente en la consola del motor de workflows.

**Acceptance Scenarios**:

1. **Given** el entorno saludable, **When** el usuario ejecuta el ping, **Then** la interfaz muestra
   el estado "completado", el resultado y el identificador de correlación.
2. **Given** el worker detenido, **When** el usuario ejecuta el ping, **Then** la ejecución queda
   pendiente y, al reiniciar el worker, se completa sin intervención y sin duplicarse.
3. **Given** el worker se detiene a mitad de una ejecución, **When** vuelve a iniciar, **Then** la
   ejecución continúa y termina con un único resultado.
4. **Given** la misma solicitud de ping enviada dos veces con la misma clave de idempotencia,
   **When** el sistema la procesa, **Then** se crea una sola ejecución y ambas respuestas la
   referencian.

---

### User Story 3 - Errores y trazabilidad consistentes (Priority: P2)

Cualquier respuesta del API, exitosa o de error, se puede rastrear por un identificador de
correlación en todos los componentes. Los errores siguen un formato estándar con mensajes en
español y un código estable.

**Why this priority**: la constitution (principios V y VI) exige ambos desde la primera spec; sin
ellos, depurar las fases siguientes sería costoso.

**Independent Test**: provocar respuestas exitosas y de error y verificar el formato y que el
identificador aparece en la respuesta y en los logs de API y worker.

**Acceptance Scenarios**:

1. **Given** una solicitud sin identificador de correlación, **When** el API responde, **Then** la
   respuesta incluye un identificador nuevo en formato UUID.
2. **Given** una solicitud con un identificador UUID válido, **When** el API responde, **Then** se
   reutiliza ese mismo identificador en la respuesta, los logs y la ejecución del workflow.
3. **Given** una solicitud con un identificador inválido (no UUID, demasiado largo o con caracteres
   de control), **When** el API la procesa, **Then** el identificador se descarta y se genera uno
   nuevo.
4. **Given** una solicitud con datos inválidos, **When** el API responde, **Then** devuelve estado
   422 en formato de error estándar con `status`, `title`, `detail` en español, `code`,
   `correlationId` y la lista `errors[]` por campo.
5. **Given** un fallo inesperado interno, **When** el API responde, **Then** devuelve estado 500 en
   formato estándar sin trazas de pila ni detalles internos, y el detalle completo queda en los logs
   asociado al identificador de correlación.
6. **Given** un log que contiene un campo sensible (credencial, token, contraseña), **When** se
   escribe, **Then** el valor aparece redactado.

---

### User Story 4 - Calidad automatizada en cada cambio (Priority: P2)

Cada pull request ejecuta automáticamente los controles de calidad y seguridad. Un cambio que no
los supera no puede integrarse a la rama principal.

**Why this priority**: materializa el flujo de desarrollo de la constitution y protege el
repositorio público desde el primer commit.

**Independent Test**: abrir pull requests de prueba que violen cada control y verificar que el
merge queda bloqueado.

**Acceptance Scenarios**:

1. **Given** un pull request que viola reglas de estilo, tipos o pruebas, **When** se ejecuta la
   integración continua, **Then** el control correspondiente falla y el merge queda bloqueado.
2. **Given** un pull request que introduce un secreto de prueba, **When** se ejecuta el escaneo,
   **Then** el control falla e identifica el archivo y la línea.
3. **Given** una dependencia con vulnerabilidad conocida de severidad alta o crítica, **When** se
   ejecuta la auditoría, **Then** el control falla.
4. **Given** un pull request válido, **When** se ejecuta la integración continua, **Then** se
   construyen las imágenes de contenedor para arquitecturas x86-64 y ARM64 sin publicarlas, y todas
   las pruebas pasan también en ARM64.
5. **Given** un mensaje de commit que no sigue Conventional Commits, **When** el desarrollador
   intenta confirmarlo localmente, **Then** el commit es rechazado con una explicación.

---

### User Story 5 - Funcionalidad controlada por feature flags (Priority: P3)

La capacidad de ping está detrás de un feature flag. Al desactivarlo, la funcionalidad deja de
estar disponible sin cambiar ni redesplegar código.

**Why this priority**: establece el mecanismo exigido por el principio VIII antes de que exista
funcionalidad real que proteger.

**Independent Test**: alternar el flag por configuración y verificar el comportamiento en ambos
estados.

**Acceptance Scenarios**:

1. **Given** el flag del ping desactivado, **When** un usuario solicita un ping, **Then** el API
   responde en formato de error estándar con un código estable que indica funcionalidad no
   disponible, y la interfaz oculta o deshabilita la acción.
2. **Given** el flag activado, **When** un usuario solicita un ping, **Then** el ping funciona como
   en la historia 2.
3. **Given** que el proveedor de flags no puede evaluar un flag, **When** se consulta, **Then** se
   usa el valor por defecto seguro (desactivado).

---

### User Story 6 - Decisiones y amenazas documentadas (Priority: P3)

Un revisor abre el repositorio y encuentra un README en inglés con instrucciones de arranque, las
decisiones de arquitectura registradas y un modelo de amenazas inicial.

**Why this priority**: es la evidencia de diseño que el proyecto quiere demostrar como portafolio;
no bloquea el funcionamiento.

**Independent Test**: revisar que cada decisión cerrada de `docs/PLAN.md` tiene su registro y que
el modelo de amenazas cubre cada componente del diagrama.

**Acceptance Scenarios**:

1. **Given** las decisiones cerradas D1–D10 de `docs/PLAN.md`, **When** el revisor consulta los
   registros de decisión, **Then** cada una tiene un registro con contexto, opciones consideradas,
   decisión y consecuencias.
2. **Given** el diagrama de arquitectura, **When** el revisor consulta el modelo de amenazas, **Then**
   cada componente y flujo de datos tiene sus amenazas analizadas por categoría STRIDE con
   mitigación o estado.

---

### Edge Cases

- El motor de workflows no está disponible al iniciar el API: el API arranca, el chequeo de
  disponibilidad (readiness) reporta no listo y las solicitudes de ping devuelven error estándar 503.
- La base de datos no está disponible: readiness reporta no listo indicando la dependencia caída;
  liveness sigue reportando vivo.
- Un puerto requerido por la infraestructura local ya está ocupado: el arranque falla con un mensaje
  que indica el puerto en conflicto.
- Solicitud con cuerpo mayor al límite permitido: error estándar 413 sin procesar el contenido.
- Ruta inexistente: error estándar 404 con identificador de correlación.
- El ping excede su tiempo máximo: la ejecución termina en estado "fallido por tiempo" y la
  interfaz lo muestra.

## Requirements *(mandatory)*

### Functional Requirements

**Entorno local**

- **FR-001**: El repositorio DEBE permitir levantar toda la infraestructura local (base de datos,
  almacén clave-valor y motor de workflows con su consola) con un único comando.
- **FR-002**: El repositorio DEBE permitir levantar API, worker e interfaz web con un único comando,
  con recarga automática ante cambios de código.
- **FR-003**: El estado del motor de workflows local DEBE persistir entre reinicios del entorno.
- **FR-004**: El README DEBE listar los prerrequisitos con versiones exactas y los pasos de arranque.

**Walking skeleton**

- **FR-005**: La interfaz web DEBE ofrecer una acción para ejecutar un ping y mostrar estado,
  resultado e identificador de correlación.
- **FR-006**: El API DEBE recibir la solicitud de ping, iniciar un workflow durable y permitir
  consultar su estado.
- **FR-007**: El worker DEBE ejecutar el workflow de ping con al menos una actividad, con tiempo
  máximo y política de reintentos explícitos.
- **FR-008**: Las solicitudes de ping DEBEN aceptar una clave de idempotencia; dos solicitudes con
  la misma clave DEBEN resolverse a una única ejecución.
- **FR-009**: Una ejecución en curso DEBE completarse tras la caída y reinicio del worker sin
  duplicar efectos.

**Configuración y salud**

- **FR-010**: Cada aplicación DEBE validar su configuración al arrancar y negarse a iniciar si es
  inválida, indicando la variable sin revelar su valor.
- **FR-011**: El API DEBE exponer un chequeo de vida (liveness) y uno de disponibilidad (readiness);
  readiness DEBE reflejar el estado de la base de datos, el almacén clave-valor y el motor de
  workflows.
- **FR-012**: El worker DEBE exponer su estado de salud de forma verificable por el operador.

**Errores (principio V)**

- **FR-013**: Toda respuesta de error del API DEBE usar el formato problem+json de RFC 9457 con los
  campos `status`, `title`, `detail` (español), `code` y `correlationId`; `errors[]` solo en errores
  de validación; sin `type` ni `instance`.
- **FR-014**: El manejo de errores DEBE ser centralizado; ningún controlador DEBE construir
  respuestas de error por su cuenta.
- **FR-015**: Las respuestas 5xx NO DEBEN exponer trazas de pila, nombres de clases, consultas ni
  rutas internas.
- **FR-016**: El API DEBE rechazar cuerpos que superen un tamaño máximo configurable con error 413.

**Trazabilidad (principio VI)**

- **FR-017**: El API DEBE aceptar `X-Correlation-Id` entrante solo si es un UUID válido; en otro
  caso DEBE generar uno nuevo.
- **FR-018**: El identificador DEBE devolverse en el header de toda respuesta y en todo cuerpo de
  error.
- **FR-019**: El identificador DEBE propagarse a la ejecución del workflow, quedar registrado como
  atributo buscable en el motor de workflows y aparecer en todos los logs de API y worker
  relacionados.

**Logs**

- **FR-020**: API y worker DEBEN emitir logs estructurados (una línea JSON por evento) con nivel,
  marca de tiempo, componente e identificador de correlación.
- **FR-021**: Los logs DEBEN redactar automáticamente campos sensibles (contraseñas, tokens,
  credenciales, headers de autorización y cookies).

**Feature flags (principio VIII)**

- **FR-022**: El sistema DEBE evaluar feature flags mediante una interfaz estándar con un proveedor
  estático basado en configuración, reemplazable sin cambiar el código que consulta los flags.
- **FR-023**: La capacidad de ping DEBE estar detrás de un flag; si el flag no puede evaluarse, DEBE
  aplicarse el valor desactivado.
- **FR-024**: Los flags que afecten workflows DEBEN evaluarse fuera del código determinista del
  workflow (en el API o en actividades).

**Calidad y CI**

- **FR-025**: Cada pull request DEBE ejecutar: lint, verificación de tipos, pruebas, auditoría de
  dependencias (falla con severidad alta o crítica) y escaneo de secretos.
- **FR-026**: La integración continua DEBE construir imágenes de contenedor para x86-64 y ARM64 sin
  publicarlas, y ejecutar las pruebas también en ARM64.
- **FR-027**: Las imágenes DEBEN basarse en una distribución con glibc (no Alpine), con imagen base
  fijada por digest y ejecución con usuario sin privilegios.
- **FR-028**: Los commits DEBEN validarse localmente contra Conventional Commits.
- **FR-029**: Las actualizaciones de dependencias DEBEN proponerse automáticamente mediante pull
  requests.
- **FR-030**: La versión de Node.js DEBE estar fijada y ser la misma en desarrollo, CI e imágenes.

**Documentación**

- **FR-031**: Cada decisión cerrada de `docs/PLAN.md` (D1–D10) DEBE tener un registro de decisión
  de arquitectura en formato MADR.
- **FR-032**: DEBE existir un modelo de amenazas v1 con análisis STRIDE por componente y flujo de
  datos del diagrama de arquitectura.
- **FR-033**: El README DEBE estar en inglés; la documentación interna, en español.

### Key Entities

- **Ejecución de ping**: identificador, identificador de correlación, clave de idempotencia,
  estado (pendiente, en curso, completado, fallido, fallido por tiempo), resultado, marcas de
  tiempo de inicio y fin.
- **Identificador de correlación**: UUID que une solicitud, respuesta, logs y ejecución.
- **Feature flag**: clave, valor por defecto seguro, dueño, issue de eliminación.
- **Registro de decisión (ADR)**: título, estado, contexto, opciones, decisión, consecuencias.
- **Amenaza**: componente o flujo, categoría STRIDE, descripción, mitigación, estado.

## Security Considerations *(required by constitution, principle I)*

| Riesgo OWASP Top 10:2025 | Cómo lo aborda F0 |
|---|---|
| A02 Security Misconfiguration | Headers de seguridad, CORS restringido al origen de la web, sin trazas en errores, configuración validada al arrancar, consola del motor de workflows sin exposición pública |
| A03 Software Supply Chain Failures | Lockfile, auditoría de dependencias, escaneo de secretos, imágenes base fijadas por digest, actualizaciones automatizadas |
| A05 Injection | Validación de toda entrada en el borde; identificador de correlación validado antes de usarse en logs |
| A09 Security Logging and Alerting Failures | Logs estructurados con correlación y redacción de datos sensibles |
| A10 Mishandling of Exceptional Conditions | Filtro global de errores, fallo cerrado en configuración y en flags |

- OWASP LLM Top 10: no aplica en F0 (no hay uso de LLM).
- A01 y A07 (control de acceso y autenticación) quedan fuera de alcance: se abordan en F1. Mientras
  tanto, el sistema solo se ejecuta en local y no se despliega públicamente.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Un desarrollador con los prerrequisitos instalados obtiene el entorno completo
  funcionando en menos de 15 minutos desde el clon, siguiendo solo el README.
- **SC-002**: En condiciones normales, el resultado del ping aparece en la interfaz en menos de
  5 segundos desde que el usuario lo solicita.
- **SC-003**: El 100 % de las ejecuciones de ping interrumpidas por la caída del worker se completan
  tras su reinicio, con exactamente un resultado cada una.
- **SC-004**: El 100 % de las respuestas del API incluyen identificador de correlación, y el 100 %
  de las respuestas de error cumplen el formato estándar definido.
- **SC-005**: Dado un identificador de correlación, se localizan todos los eventos relacionados de
  API y worker en menos de 1 minuto.
- **SC-006**: Cada control de calidad (estilo, tipos, pruebas, auditoría, secretos) bloquea el merge
  cuando falla, verificado con al menos un pull request de prueba por control.
- **SC-007**: La integración continua completa todos los controles de un pull request en menos de
  15 minutos.
- **SC-008**: El 100 % de las decisiones cerradas D1–D10 tienen registro de decisión, y el 100 % de
  los componentes del diagrama tienen amenazas analizadas.

## Assumptions

- Prerrequisitos del desarrollador: Node.js 24 LTS, pnpm (vía corepack), Docker Desktop y git.
  Sistema principal de desarrollo: Windows; también debe funcionar en Linux y macOS.
- El entorno local usa el modo de desarrollo del motor de workflows (un contenedor con
  persistencia en volumen); el despliegue de producción con motor completo es parte de F9.
- En F0 no existe autenticación ni multi-tenancy; el ping es accesible sin credenciales solo en el
  entorno local.
- La base de datos se levanta y su conectividad se verifica en readiness, pero el esquema de datos
  de la aplicación y la elección de ORM pertenecen a F1.
- La ejecución de ping se consulta desde el motor de workflows; no se persiste en la base de datos
  de la aplicación en esta fase.
- El repositorio público `cognitive-dag` se crea en GitHub al aprobar esta spec y antes de
  implementarla, para que la primera pull request ya pase por la integración continua.
- Los runners ARM64 de GitHub Actions son gratuitos para repositorios públicos.
- Las imágenes no se publican en ningún registro en F0; la publicación pertenece a F9.
