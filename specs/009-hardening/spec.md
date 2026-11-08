# Feature Specification: Endurecimiento (F8)

**Feature Branch**: `009-hardening`

**Created**: 2026-11-08

**Status**: Draft

**Input**: User description: "Fase F8 de docs/PLAN.md: revisión completa de OWASP Top 10:2025 y OWASP
Top 10 for LLM Applications 2026 (tablas 6.1 y 6.2) con evidencia por fila, OWASP ZAP baseline y
revisión y cierre del modelo de amenazas. Incluye los pendientes de F7: issue #55 (eliminar el flag
`triggers-enabled` y que el compilador ofrezca los nodos de F7), `credentialId` en `sensitiveFields`
de `http.request`, el riesgo de ADR-0053 (un viewer puede iniciar, cancelar y reejecutar ejecuciones),
las filas `accepted` o `planned:F8` del modelo de amenazas y las desviaciones de F7 diferidas a F8."

## User Scenarios & Testing *(mandatory)*

Actores: el autor y revisor de seguridad de la plataforma (cierra la fase y firma el modelo de
amenazas), el owner, el editor y el viewer de una organización, el compilador de lenguaje natural
(F6), el operador de la plataforma, un atacante autenticado con rol viewer, un atacante sin sesión que
sondea la API y la web (lo que ve ZAP), un atacante que inyecta instrucciones en una intención o en el
cuerpo de un webhook.

### User Story 1 - Matriz de evidencia de OWASP (Priority: P1)

El autor abre un único documento con una fila por riesgo de las tablas 6.1 (LLM01–LLM10) y 6.2
(A01–A10) de `docs/PLAN.md`. Cada fila dice si aplica, qué control la mitiga, dónde está ese control
en el código o la configuración, qué prueba o comando lo demuestra, el resultado de ejecutarlo en esta
fase y el estado final (`verified`, `accepted` con su razón, o `deferred:F9` con su motivo). Una fila
sin evidencia reproducible no se cuenta como verificada.

**Why this priority**: es el criterio de terminado de la fase: "todas las filas de las tablas 6.1 y 6.2
verificadas con evidencia".

**Independent Test**: tomar al azar 5 filas de la matriz, ejecutar el comando de evidencia de cada una
y comprobar que el resultado coincide con lo registrado.

**Acceptance Scenarios**:

1. **Given** las 10 filas de 6.1 y las 10 de 6.2, **When** se revisa la matriz, **Then** las 20 tienen
   estado, control citado, evidencia ejecutable y fecha de verificación; ninguna queda vacía.
2. **Given** una fila cuya mitigación descrita en `docs/PLAN.md` no coincide con lo implementado
   (por ejemplo, "access token corto + refresh rotado" frente a la sesión opaca de ADR-0027, o "log de
   auditoría por tenant" frente a los eventos en logs de ADR-0038), **When** se revisa, **Then** la
   fila registra la desviación, la decisión del autor y el texto de `docs/PLAN.md` se corrige para que
   describa lo que existe.
3. **Given** que el orden y los nombres de OWASP LLM 2026 en `docs/PLAN.md` se tomaron de una fuente
   secundaria, **When** se cierra la fase, **Then** se contrastan con la fuente primaria
   (genai.owasp.org) y la tabla se corrige o se confirma con la fecha de la consulta.
4. **Given** una fila no verificable en local porque depende del despliegue (TLS, redacción en el
   proxy, SPF/DKIM/DMARC, autenticación de Temporal, PostgreSQL y Valkey), **When** se revisa,
   **Then** queda `deferred:F9` con el requisito concreto que F9 debe cumplir y una prueba prevista.

---

### User Story 2 - Un viewer no puede provocar efectos externos (Priority: P1)

Hoy `runs.controller` no restringe por rol: un viewer puede iniciar, cancelar y reejecutar
ejecuciones (ADR-0053). Con `http.request` eso permite llamadas salientes con las credenciales de la
organización. La fase cierra ese riesgo según la decisión del autor y deja la regla probada en cada
ruta de ejecución, incluidas las de reejecución desde un nodo y el listado.

**Why this priority**: es el riesgo abierto de mayor impacto heredado de F7 y una barrera de A01 y
LLM03 que hoy depende solo de una decisión de producto.

**Independent Test**: con las tres cuentas de roles distintos, llamar a cada ruta de ejecución y
comprobar la respuesta esperada por rol.

**Acceptance Scenarios**:

1. **Given** que solo owner y editor pueden iniciar, cancelar y reejecutar, **When** un viewer llama a
   esas rutas, **Then** recibe 403 `FORBIDDEN` y no se inicia ni se cambia nada; existe una prueba por
   ruta y por rol.
2. **Given** la regla vigente, **When** un viewer lee ejecuciones, pasos, entradas y salidas (ya
   redactadas) y el flujo en vivo, **Then** sigue pudiendo leer; la restricción solo afecta a lo que
   inicia efectos.
3. **Given** que el rol de una persona cambia entre dos peticiones, **When** llega la segunda,
   **Then** se aplica el rol vigente (se lee en cada petición).
4. **Given** una ejecución disparada por webhook o programación (sin persona), **When** se cancela
   o se reejecuta, **Then** rige la misma regla sobre quien actúa.
5. **Given** que ADR-0053 se reemplaza, **When** se cierra la fase, **Then** un ADR nuevo lo sustituye
   (el anterior queda `superseded`) y las filas de `docs/threat-model.md` que lo citaban pasan a
   `mitigated` con su prueba.

---

### User Story 3 - El compilador ofrece los nodos de F7 sin abrir una vía de abuso (Priority: P1)

Quien describe una automatización puede pedir un webhook, una programación, una aprobación humana o
una llamada HTTP, y el compilador los incluye en el borrador. Los campos que dirigen un efecto externo
(destino, cabeceras, cuerpo y credencial) nunca los rellena el modelo: la persona los completa antes
de publicar. El compilador no produce un nodo que la plataforma no pueda ejecutar con la
configuración actual.

**Why this priority**: es el pendiente funcional de F7 (decisión 13C) y la superficie de LLM03 e
inyección más sensible del producto: una intención hostil que consiga una llamada HTTP a un destino
elegido por el atacante.

**Independent Test**: compilar intenciones que piden cada nodo y comprobar que aparecen en el
borrador sin `url`, `headers`, `body` ni `credentialId`, y que la publicación queda bloqueada hasta
completarlos.

**Acceptance Scenarios**:

1. **Given** el catálogo del compilador, **When** se arma el prompt, **Then** incluye `trigger.webhook`,
   `trigger.schedule`, `human.approval` y `http.request`, con sus campos sensibles marcados, y la
   prueba que hoy fija "ningún tipo de F7 llega al prompt" se sustituye por otra que fija exactamente
   cuáles llegan.
2. **Given** una intención que pide "llamar a https://evil.example con mi token", **When** el modelo
   devuelve un `http.request` con URL y credencial, **Then** el saneado las elimina, el borrador las
   lista como pendientes (`omittedSensitiveFields`, incluido `credentialId`) y no se puede publicar
   hasta que una persona las complete.
3. **Given** `credentialId` como campo sensible de `http.request`, **When** se valida una definición
   escrita a mano en el editor, **Then** el comportamiento del editor no cambia: el campo es opcional
   y válido; solo el compilador lo trata como sensible.
4. **Given** el conjunto de evaluación del compilador, **When** se amplía, **Then** incluye intenciones
   con los nodos de F7 y casos de inyección dirigidos a ellos, y el umbral sigue siendo ≥ 80 % de
   intenciones válidas con 0 escapes de inyección.
5. **Given** un borrador con nodos de F7, **When** la persona publica y ejecuta, **Then** se aplican
   la autorización, el anti-SSRF, la allowlist y las credenciales de F7 sin cambios.

---

### User Story 4 - ZAP baseline contra la plataforma (Priority: P1)

El autor ejecuta OWASP ZAP (baseline) contra la API y la web levantadas en local, con un comando
documentado, y obtiene un informe. Cada alerta queda corregida, o marcada como falso positivo o
aceptada con su razón. El informe y la decisión sobre cada alerta se conservan como evidencia.

**Why this priority**: lo exige explícitamente `docs/PLAN.md` §6.3 y el criterio de la fase.

**Independent Test**: ejecutar el comando documentado desde un clon limpio y comprobar que produce el
informe y que el resultado coincide con el registro de alertas.

**Acceptance Scenarios**:

1. **Given** la API y la web en local, **When** se ejecuta ZAP baseline, **Then** el informe se genera
   sin intervención manual y recorre las rutas públicas de la API (salud, flags, autenticación y
   webhook) y la web.
2. **Given** alertas de nivel medio o alto, **When** termina el análisis, **Then** no queda ninguna
   sin corregir ni documentada como falso positivo o riesgo aceptado con razón.
3. **Given** que ZAP en modo baseline es pasivo, **When** se documenta su alcance, **Then** queda dicho
   que no hay análisis activo ni con sesión iniciada en F8 (decisión Q6) y que se valora contra staging
   en F9; el análisis nunca apunta a servicios de terceros ni a Gemini.
4. **Given** una alerta que exige un cambio (cabecera, cookie, caché, divulgación de versión), **When**
   se corrige, **Then** hay una prueba de regresión que la fija.
5. **Given** que no existe un staging hasta F9, **When** se documenta el análisis, **Then** queda
   dicho que se hizo contra el entorno local y qué debe repetirse contra staging en F9.

---

### User Story 5 - Eliminar los flags de producto (Priority: P2)

Con las funciones de F1 a F7 verificadas, los ocho flags de producto dejan de existir
(`ping-enabled`, `identity-enabled`, `dag-editor-enabled`, `execution-enabled`, `resilience-enabled`,
`llm-nodes-enabled`, `nl-compiler-enabled` y `triggers-enabled`; issues #2, #14, #21, #27, #32, #39,
#48 y #55): los endpoints, la UI y las fases ejecutables quedan siempre activos y la ruta F0 de ping
sin organización desaparece. Los kill switches del worker (`LLM_ENABLED`, `TRIGGERS_ENABLED`,
`HTTP_ENABLED`) se conservan, porque son interruptores de operación. La autorización no cambia.

**Why this priority**: la constitución (principio VIII) exige que cada flag tenga un issue de
eliminación y desaparezca cuando la función es estable; llegar a F9 con ocho flags apagables es
superficie sin uso.

**Independent Test**: buscar los ocho nombres (guion, camelCase y constante) en el repositorio: no
queda ninguna referencia viva; las pruebas de F1–F7 siguen en verde sin ellos.

**Acceptance Scenarios**:

1. **Given** los flags eliminados, **When** se llama a los endpoints de F1–F7, **Then** responden como
   antes con los flags encendidos, y la autorización por rol y organización sigue aplicándose.
2. **Given** los flags eliminados, **When** se publica una versión con cualquier nodo del catálogo,
   **Then** se ejecuta sin depender de `executablePhases` condicionado por un flag.
3. **Given** las pruebas que hoy comprueban un flag apagado (404 `FEATURE_NOT_AVAILABLE`), **When** se
   eliminan, **Then** la cobertura de autorización, aislamiento y kill switches del worker se
   mantiene.
4. **Given** `LLM_ENABLED` apagado, **When** un nodo LLM o el compilador se ejecuta, **Then** falla
   `LLM_DISABLED` sin llamar al modelo (el kill switch de LLM sustituye a `llm-nodes-enabled`).
5. **Given** el catálogo de flags vacío, **When** se pide `GET /api/v1/features`, **Then** responde un
   objeto vacío y la infraestructura de flags sigue disponible para futuras fases.
6. **Given** los ocho cambios, **When** se cierra la fase, **Then** los ocho issues se cierran con la
   PR y la documentación (`docs/PLAN.md`, README, ADR-0080) refleja que los flags ya no existen.

---

### User Story 6 - Cierre del modelo de amenazas (Priority: P1)

`docs/threat-model.md` pasa a su versión de cierre. Ninguna fila queda `planned:F8` ni `planned:F4` o
anterior sin revisar; cada fila `accepted` tiene una razón vigente, un dueño y la fase en que se
vuelve a mirar; las filas que dependen del despliegue pasan a `deferred:F9` con su requisito; y lo
que el documento afirma coincide con el código.

**Why this priority**: el modelo "se revisa en cada fase y se cierra en F8" (`docs/PLAN.md` §10).

**Independent Test**: recorrer todas las tablas del documento y comprobar que cada estado es uno de los
permitidos y que cada afirmación de evidencia apunta a una prueba o archivo que existe.

**Acceptance Scenarios**:

1. **Given** las filas `planned:F4` de Valkey (E6) que ya no corresponden a la realidad, **When** se
   revisan, **Then** cada una pasa a `mitigated`, `accepted` o `deferred:F9` con su evidencia.
2. **Given** una afirmación que el código ya no cumple o nunca cumplió (por ejemplo, el evento
   `approval.timed_out` citado como mitigado cuando ADR-0074 dice que no existe), **When** se revisa,
   **Then** se corrige el documento o se implementa lo que falta, según la decisión del autor.
3. **Given** cada archivo de prueba citado como evidencia, **When** se comprueba, **Then** existe en el
   repositorio; las referencias rotas se corrigen.
4. **Given** el resumen de riesgos abiertos, **When** se cierra la fase, **Then** lista solo los
   riesgos aceptados vigentes y los requisitos de F9, sin párrafos por fase.
5. **Given** la lista de elementos y flujos, **When** se revisa el diagrama, **Then** incluye todo lo
   añadido desde F0 (sesiones, correo, Gemini, emisores de webhooks y destinos HTTP) y los elementos
   que F9 añadirá (Caddy, backups, observabilidad) como `planned:F9`.

---

### User Story 7 - Desviaciones de F7 resueltas o aceptadas con fecha (Priority: P2)

Cada desviación que F7 dejó para esta fase se corrige o se acepta de forma explícita. Se corrigen:
ausencia de los eventos `approval.timed_out`, `circuit.closed` y `schedule.caught_up`; reconciliador de
programaciones sin tope de intentos; `allowedNodeTypes` con un parámetro `triggersEnabled?` ignorado;
y las pruebas web que fallan por tiempo bajo carga paralela. Desaparece con los flags: el 401 antes que
404 con el flag apagado. Quedan `accepted` con razón, dueño y revisión: ejecución `failed` cuando
Temporal falla tras insertar la fila de un webhook, disparos descartados fuera del catch-up sin métrica
y ausencia de frecuencia mínima de la cron.

**Why this priority**: son deudas conocidas con riesgo bajo; si no se cierran se vuelven historia.

**Independent Test**: para cada desviación, comprobar que existe la corrección con su prueba o la
fila aceptada con su razón en el modelo de amenazas y el ADR.

**Acceptance Scenarios**:

1. **Given** cada desviación de la lista, **When** se cierra la fase, **Then** tiene exactamente uno de
   estos desenlaces: corregida con prueba, o aceptada con razón, dueño y fecha de revisión.
2. **Given** que se corrigen las pruebas web inestables, **When** corre `pnpm test` en paralelo,
   **Then** no hay fallos por tiempo de espera en tres ejecuciones seguidas.

---

### User Story 8 - Cadena de suministro, configuración y cabeceras revisadas (Priority: P2)

El autor repasa A02, A03 y A04 con comprobaciones concretas: cabeceras y CORS reales de la API y de la
web estática, configuración que falla al arrancar, ausencia de stack traces, dependencias (auditoría,
Renovate, digests, scripts denegados, `minimumReleaseAge`), secretos (gitleaks y el patrón del
repositorio) y cifrado (parámetros de Argon2id y AES-256-GCM). Lo que falte se corrige o se acepta con
razón.

**Why this priority**: son las filas de OWASP más cercanas a configuración, donde el riesgo es olvidar
algo, no construir algo nuevo.

**Independent Test**: ejecutar los comandos de la matriz para A02, A03 y A04 y comparar con el registro.

**Acceptance Scenarios**:

1. **Given** la API y la web en local, **When** se piden sus respuestas, **Then** las cabeceras de
   seguridad, la política de contenido, CORS y las cookies coinciden con lo declarado en la matriz.
2. **Given** `pnpm audit` y el estado de Renovate, **When** se ejecutan, **Then** no hay
   vulnerabilidades altas ni críticas abiertas; las excepciones (multer, NestJS 12) tienen issue y
   razón vigente.
3. **Given** una variable de configuración inválida o ausente, **When** arranca el API y el worker,
   **Then** el proceso termina nombrando solo las variables, nunca valores.
4. **Given** un volcado de PostgreSQL sin las variables de entorno del proceso, **When** se inspecciona,
   **Then** no hay secretos legibles (contraseñas con Argon2id, credenciales cifradas, tokens como
   SHA-256).

---

### User Story 9 - LLM: inyección, consumo y divulgación revisados con el catálogo completo (Priority: P2)

Con los cuatro nodos de F7 disponibles para el compilador y los nodos cognitivos de F5, el autor repasa
LLM01, LLM02, LLM03, LLM06, LLM08 y LLM10 con el conjunto de inyecciones y las pruebas de presupuesto,
y comprueba que ninguna salida de un modelo decide acciones ni se ejecuta, interpola o renderiza.

**Why this priority**: la superficie de LLM crece con los nodos nuevos y conviene medirla antes del
despliegue.

**Independent Test**: ejecutar `pnpm eval:llm` y `pnpm eval:compiler` y las pruebas de presupuesto y
redacción; comparar con el umbral.

**Acceptance Scenarios**:

1. **Given** el conjunto de inyecciones de F5 y F6, **When** se ejecuta con respuestas grabadas,
   **Then** hay 0 escapes; el resultado contra Gemini real se ejecuta una vez al cerrar la fase y se
   registra en el ADR de evals.
2. **Given** las salidas del LLM y del compilador, **When** se busca su uso, **Then** no hay `eval`,
   `new Function`, interpolación en SQL ni renderizado como HTML (comprobación estática y pruebas).
3. **Given** los prompts de sistema, **When** se revisan, **Then** no contienen secretos ni lógica de
   autorización.
4. **Given** que la capa gratuita de Gemini puede usar el contenido enviado, **When** se cierra la
   fase, **Then** el riesgo sigue `accepted` hasta la demo pública, con el requisito de migrar a la
   capa de pago antes de F9 escrito en el modelo de amenazas.

### Edge Cases

- ZAP encuentra una alerta en una ruta que solo existe con un flag encendido: se prueba con el estado
  final de los flags de la fase.
- El análisis de ZAP provoca el rate limit de login o del webhook: se documenta y se ejecuta con
  límites relajados solo en el entorno de pruebas, sin cambiar los de producción.
- El alcance de la restricción por rol deja sin poder probar un workflow a un viewer: la web
  deshabilita las acciones y explica el motivo en lugar de mostrar un 403.
- Una ejecución en curso iniciada por alguien que después pierde el rol: sigue su curso; solo cambia lo
  que esa persona puede hacer a partir de ahora.
- La eliminación del flag deja ejecuciones antiguas con datos de la fase `F7`: siguen siendo legibles.
- El compilador recibe una intención que pide un webhook y una aprobación: el borrador queda con un
  trigger y la aprobación; el token del webhook se genera después, al activar.
- La matriz cita un archivo de prueba renombrado en una fase posterior: la comprobación de referencias
  rotas lo detecta.
- Una fila de OWASP aplica "No" (LLM09, LLM05 bajo): se registra por qué no aplica y qué cambio la
  activaría (por ejemplo, agregar pgvector).

## Requirements *(mandatory)*

### Functional Requirements

**Matriz de evidencia**

- **FR-001**: El repositorio MUST contener una matriz que cubra las 10 filas de `docs/PLAN.md` §6.1 y
  las 10 de §6.2, con control, ubicación en el código, evidencia ejecutable, resultado, fecha y estado
  (`verified`, `accepted`, `deferred:F9` o `not-applicable`).
- **FR-002**: Cada fila `verified` MUST citar un comando o prueba que se pueda ejecutar desde un clon
  limpio y que falle si el control se retira. Las filas `accepted` MUST llevar razón, dueño y fase de
  revisión. Las filas `deferred:F9` MUST llevar el requisito y la prueba prevista.
- **FR-003**: Un comprobador automático MUST verificar que cada archivo de prueba, ADR y ruta citados
  por la matriz y por `docs/threat-model.md` existen.
- **FR-004**: Las descripciones de `docs/PLAN.md` §6.1 y §6.2 que no coincidan con lo implementado
  MUST corregirse (A07 sesiones, A09 auditoría, A08 webhook sin HMAC) y el orden y nombres de OWASP
  LLM 2026 MUST contrastarse con la fuente primaria.

**Autorización de ejecuciones**

- **FR-005**: El inicio, la cancelación y la reejecución de ejecuciones (incluida la reejecución desde
  un nodo) MUST exigir el rol owner o editor, validado en cada petición con el rol vigente y
  fallando cerrado ante un rol desconocido; el viewer recibe 403.
- **FR-006**: Las rutas de lectura de ejecuciones, pasos, entradas y salidas redactadas y flujo en
  vivo MUST seguir abiertas a cualquier miembro.
- **FR-007**: La web MUST deshabilitar (no ocultar sin explicación) las acciones que el rol no puede
  hacer y explicar el motivo.
- **FR-008**: Una prueba MUST recorrer cada ruta del controlador de ejecuciones con cada rol y con un
  no miembro, y fallar si se añade una ruta sin decisión de rol explícita.

**Compilador**

- **FR-009**: El catálogo del compilador MUST incluir los cuatro nodos de F7 y MUST tratar como
  sensibles `url`, `headers`, `body` y `credentialId` de `http.request`.
- **FR-010**: El saneado MUST eliminar los campos sensibles de la salida del modelo y MUST bloquear la
  publicación hasta que una persona los complete, igual que en F6.
- **FR-011**: El conjunto de evaluación del compilador MUST incluir intenciones con los nodos de F7 y
  casos de inyección dirigidos a ellos; el umbral (≥ 80 % válidas, 0 escapes) MUST mantenerse.
- **FR-012**: Las definiciones escritas a mano MUST validarse igual que antes; `credentialId` MUST
  seguir siendo opcional para el editor.

**ZAP**

- **FR-013**: El repositorio MUST incluir un script documentado y reproducible que ejecute ZAP baseline
  contra la API y la web locales y deje el informe como evidencia, sin llamar a servicios de terceros.
  No habrá workflow de CI para ZAP ni un check requerido nuevo.
- **FR-014**: Cada alerta de nivel medio o alto MUST terminar corregida, marcada como falso positivo o
  aceptada, con una regla de ZAP versionada que lo registre y razón por alerta.
- **FR-015**: Las correcciones que salgan de ZAP MUST tener una prueba de regresión.

**Flag**

- **FR-016**: Los ocho flags de producto (`ping-enabled`, `identity-enabled`, `dag-editor-enabled`,
  `execution-enabled`, `resilience-enabled`, `llm-nodes-enabled`, `nl-compiler-enabled` y
  `triggers-enabled`) MUST eliminarse del código, el catálogo de flags, los endpoints, la web, el
  compilador, la configuración de ejemplo y la documentación, junto con la ruta F0 de ping sin
  organización; la autorización MUST seguir aplicándose igual.
- **FR-017**: Los kill switches del worker `LLM_ENABLED`, `TRIGGERS_ENABLED` y `HTTP_ENABLED` MUST
  conservarse con su documentación de operación (principio VIII: nodos LLM y conectores).
- **FR-018**: Las pruebas que dependían del flag MUST sustituirse por pruebas de los kill switches y de
  la autorización, sin reducir la cobertura.

**Modelo de amenazas**

- **FR-019**: `docs/threat-model.md` MUST pasar a una versión de cierre sin filas `planned:F8` ni
  `planned:F4` o anteriores, con cada `accepted` con razón, dueño y fase de revisión, y cada
  dependiente del despliegue como `deferred:F9`.
- **FR-020**: Toda afirmación del modelo sobre eventos, pruebas o controles MUST coincidir con el
  código; las discrepancias MUST corregirse en el documento o en el código.
- **FR-021**: El diagrama y las listas de elementos y flujos MUST reflejar el sistema actual y marcar
  los elementos de F9.

**Desviaciones de F7**

- **FR-022**: Cada desviación de F7 listada en la historia 7 MUST cerrarse como corregida con prueba
  (eventos, tope del reconciliador, parámetro ignorado, pruebas web) o aceptada con razón, dueño y
  revisión (ejecución `failed` tras fallo de Temporal, disparos fuera del catch-up, cron mínima).
- **FR-023**: Las pruebas web inestables bajo carga paralela MUST estabilizarse o aislarse con
  concurrencia explícita documentada.

**Revisión de configuración, cadena de suministro y LLM**

- **FR-024**: La matriz MUST registrar la medición de cabeceras, CORS, cookies, errores y arranque
  (A02, A10), de dependencias, digests, secretos y Renovate (A03, sin SBOM ni escaneo de imágenes) y de
  criptografía (A04), con prueba que falle si el control se retira.
- **FR-025**: La matriz MUST registrar el resultado de `pnpm eval:llm` y `pnpm eval:compiler` con el
  catálogo final y las pruebas de presupuesto, redacción y salida; y una comprobación estática MUST
  impedir `eval`, `new Function` y `dangerouslySetInnerHTML`.
- **FR-027**: Temporal, PostgreSQL y Valkey sin autenticación fuerte ni TLS MUST quedar
  `deferred:F9` en el modelo de amenazas y en `docs/PLAN.md` §9, con razón, requisito y prueba prevista;
  F8 no cambia su configuración.
- **FR-028**: La política de contraseñas de 8–25 y la ausencia de MFA MUST quedar `accepted` con razón
  y revisión posterior a F9; `docs/PLAN.md` §6.2 A07 y A09 MUST describir las sesiones opacas y los
  eventos en logs.
- **FR-026**: Los requisitos de F9 que salgan de la revisión MUST quedar en `docs/PLAN.md` §9 con
  prueba prevista (por ejemplo: redacción en Caddy, TLS, autenticación de Temporal, PostgreSQL y
  Valkey, SPF/DKIM/DMARC, retención de logs de seguridad, migración a la capa de pago de Gemini).

### Key Entities

- **Fila de la matriz de evidencia**: riesgo OWASP, aplicabilidad, control, ubicación, evidencia
  ejecutable, resultado, fecha y estado.
- **Alerta de ZAP**: regla, severidad, ruta, decisión (corregida, falso positivo, aceptada), razón y
  prueba de regresión.
- **Riesgo aceptado**: fila del modelo de amenazas con razón, dueño y fase de revisión.
- **Regla de roles de ejecución**: qué rol puede iniciar, cancelar y reejecutar.
- **Campo sensible del catálogo**: campo de un nodo que el compilador nunca rellena.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 20 de 20 filas de las tablas 6.1 y 6.2 tienen estado y evidencia; 0 filas `verified`
  cuya evidencia no se pueda reproducir (el comprobador y la revisión por muestreo lo confirman).
- **SC-002**: 0 alertas de ZAP de nivel medio o alto sin decisión documentada; 100 % de las alertas
  corregidas tienen una prueba de regresión.
- **SC-003**: 0 filas `planned:F8` o `planned:F4` o anteriores en `docs/threat-model.md`; 0
  referencias a pruebas, ADR o rutas inexistentes.
- **SC-004**: Con cada uno de los tres roles y un no miembro, el 100 % de las rutas de ejecución
  responden lo que fija la regla; añadir una ruta sin decisión de rol hace fallar una prueba.
- **SC-005**: El compilador cumple el umbral (≥ 80 % de intenciones válidas, 0 escapes de inyección)
  con el catálogo que incluye los nodos de F7, tanto con respuestas grabadas como contra Gemini una vez.
- **SC-006**: 0 referencias vivas a los ocho flags de producto; todas las pruebas de F1–F7 en verde sin ellos.
- **SC-007**: Cada desviación de F7 tiene un desenlace (corregida o aceptada con razón); tres
  ejecuciones seguidas de la suite web en paralelo sin fallos por tiempo de espera.
- **SC-008**: Los 6 checks de CI de la PR de cierre pasan y la matriz se genera y se comprueba
  automáticamente en uno de ellos.

## Assumptions

- Los controles y pruebas de F0–F7 se reutilizan; esta fase mide, corrige y documenta, y solo
  construye lo que cierre un hueco concreto de la matriz o un pendiente heredado.
- No existe staging ni despliegue público hasta F9: ZAP se ejecuta contra el entorno local, y todo lo
  que dependa de TLS, proxy, correo real o red de producción queda `deferred:F9` con su requisito.
- El webhook con token en la URL y sin HMAC (decisión 2B, ADR-0072) se mantiene; esta fase no lo
  reabre salvo que ZAP o la revisión encuentren un fallo nuevo.
- Los kill switches del worker (`LLM_ENABLED`, `TRIGGERS_ENABLED`, `HTTP_ENABLED`) no son flags de producto.
- Los textos de la UI y los mensajes de la API van en español; los códigos en inglés.
- Cualquier nueva tabla o columna se rige por las reglas de F1–F7 (RLS forzado, sin `DELETE` para
  `app_runtime`, migraciones compatibles hacia atrás); el diseño exacto se decide en el plan.
- La infraestructura de flags (OpenFeature y `GET /api/v1/features`) se conserva aunque el catálogo
  quede vacío, para futuras fases (principio VIII); el plan decide su forma exacta.
- Fuera de alcance: MFA/TOTP, tabla de auditoría por tenant, firma HMAC del webhook, rotación de la
  llave maestra de credenciales, rate limit por host, SBOM y escaneo de imágenes, autenticación de
  Temporal, PostgreSQL y Valkey, despliegue, Caddy, backups y observabilidad (F9), e integraciones
  (F10).

## Clarifications

### Session 2026-11-08

Decisiones del autor: 1A 2B 3A 4A 5A 6A 7A 8C 9C

- Q1 → **A**. Solo owner y editor inician, cancelan y reejecutan ejecuciones (incluida la reejecución
  desde un nodo). El viewer solo lee. Reemplaza a ADR-0053.
- Q2 → **B**. Se eliminan todos los flags de producto: `ping-enabled`, `identity-enabled`,
  `dag-editor-enabled`, `execution-enabled`, `resilience-enabled`, `llm-nodes-enabled`,
  `nl-compiler-enabled` y `triggers-enabled` (issues #2, #14, #21, #27, #32, #39, #48 y #55). Se
  conservan los kill switches del worker `LLM_ENABLED`, `TRIGGERS_ENABLED` y `HTTP_ENABLED`. Se retira
  también la ruta F0 de ping sin organización (#14).
- Q3 → **A**. El compilador ofrece los cuatro nodos de F7 (`trigger.webhook`, `trigger.schedule`,
  `human.approval`, `http.request`).
- Q4 → **A**. Sin MFA/TOTP en F8. La política de contraseñas de 8–25 (ADR-0026) sigue `accepted`, con
  revisión posterior a F9 y no "cuando llegue MFA en F8".
- Q5 → **A**. La auditoría sigue siendo eventos en logs (ADR-0038); se corrige `docs/PLAN.md` §6.2 A09
  y la retención se decide en F9.
- Q6 → **A**. ZAP baseline pasivo con un script documentado que se ejecuta a mano y deja el informe
  como evidencia. No hay workflow `zap.yml` ni check nuevo.
- Q7 → **A**. Se corrigen las desviaciones baratas de F7: eventos `approval.timed_out`,
  `circuit.closed` y `schedule.caught_up`, tope de intentos del reconciliador, parámetro ignorado de
  `allowedNodeTypes` y pruebas web inestables. Quedan `accepted` con razón: disparos fuera del
  catch-up sin métrica, ejecución `failed` si Temporal falla tras insertar la fila del webhook y
  frecuencia mínima de la cron.
- Q8 → **C**. Temporal, PostgreSQL y Valkey sin autenticación fuerte ni TLS pasan a `deferred:F9`, sin
  tocar código en F8. El modelo de amenazas y `docs/PLAN.md` §9 registran la razón (no hay
  despliegue; la configuración depende del entorno) y la fase de revisión (F9).
- Q9 → **C**. Sin extras de cadena de suministro: A03 se verifica con `pnpm audit`, gitleaks, Renovate,
  digests y `minimumReleaseAge` ya existentes. SBOM y escaneo de imágenes quedan fuera, con razón
  escrita en el modelo de amenazas y en `docs/PLAN.md` (el PLAN los marca opcionales) y revisión en F9
  con las imágenes finales.
