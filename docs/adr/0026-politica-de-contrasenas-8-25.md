---
status: accepted
date: 2026-10-29
decision-makers: autor
---

# Política de contraseñas de 8 a 25 caracteres (desviación de NIST 800-63B-4)

## Contexto y problema

El diseño original de F1 seguía NIST 800-63B-4 para contraseña como único factor: mínimo 15 caracteres y máximo de al menos 64 (se eligió 128). Tras probar la interfaz, el autor decidió el 2026-10-29 un rango de 8 a 25 caracteres.

## Opciones consideradas

- Mantener 15–128 (cumple NIST 800-63B-4).
- 8–25 caracteres, sin reglas de composición, con lista de contraseñas comunes (decisión del autor).

## Decisión

Mínimo 8 y máximo 25 puntos de código tras NFKC, cualquier carácter Unicode (incluidos espacios), sin reglas de composición y con rechazo contra una lista de 100 000 contraseñas comunes de 8 a 25 caracteres (SecLists `Pwdb_top-1000000`, licencia MIT, en `apps/api/src/auth/common-passwords.txt`, sin llamadas externas). Se aplica al registro, al restablecimiento y al cambio. El login sigue aceptando hasta 128 caracteres para no revelar la política.

**Desviación aceptada.** NIST 800-63B-4 exige para un solo factor un mínimo de 15 caracteres y que el verificador acepte al menos 64. El rango elegido queda fuera de ambas reglas.

## Consecuencias

- Bueno: Contraseñas más fáciles de recordar y de escribir.
- Bueno: Sin reglas de composición ni caducidad, como recomienda NIST.
- Malo: Riesgo residual: una contraseña corta (8–14) soporta menos intentos de adivinación fuera de línea si se filtra el hash, y el máximo de 25 impide frases largas y a algunos gestores de contraseñas con claves generadas largas.
- Malo: Mitigaciones: lista de contraseñas comunes; rate limit progresivo por cuenta e IP (SC-006: no más de 50 intentos evaluados en la primera hora); Argon2id con los parámetros de OWASP ([ADR-0025](0025-argon2id-para-contrasenas.md)); respuestas anti-enumeración.
- Malo: Revisión: cuando llegue MFA en F8, volver a evaluar el rango (un segundo factor permite los mínimos de NIST para contraseñas con MFA).

## Confirmación

`packages/contracts/test/auth.test.ts` y `apps/api/test/unit/password-policy.test.ts` (7 rechazada, 8 y 25 aceptadas, 26 rechazada); `register.test.ts`.

## Enlaces

- `specs/002-identity-tenancy/spec.md` FR-002.
- `docs/threat-model.md`, E2 (S) y flujo F1.
