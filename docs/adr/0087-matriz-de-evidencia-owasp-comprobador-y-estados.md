---
status: accepted
date: 2026-11-09
decision-makers: autor
---

# Matriz de evidencia OWASP, comprobador y estados del modelo de amenazas

## Contexto y problema

`docs/PLAN.md` §6 lista los riesgos de OWASP Top 10:2025 y de OWASP Top 10 for LLM Applications
2026, pero no dice qué control los mitiga ni cómo se comprueba. Sin evidencia reproducible, un
"verificado" es solo una afirmación. El modelo de amenazas usaba estados como `mitigated`,
`accepted` o `planned:<fase>` sin ninguna comprobación automática, y podía quedar una ruta rota o
un estado sin cerrar sin que nada lo avisara. La constitución (principios I y III) exige que cada
control aplicado tenga al menos una prueba que lo demuestre.

## Opciones consideradas

- Tabla en la documentación sin comprobador: barata, pero una ruta renombrada o una fila sin
  estado pasa desapercibida.
- Matriz en YAML o JSON que se convierte en tabla: añade un paso de generación y dos fuentes que
  mantener sincronizadas.
- Matriz en Markdown con un comprobador que valida sus rutas y sus estados (elegida).

## Decisión

- `docs/security/owasp-evidence.md` contiene dos tablas: 6.1 (LLM01 a LLM10) y 6.2 (A01 a A10),
  20 filas en total. Columnas: riesgo, aplica, control, ubicación, evidencia, resultado y fecha,
  y estado.
- Los cuatro estados son los mismos en la matriz y en el modelo de amenazas v2.0:
  - `verified`: la evidencia cita un comando o una prueba ejecutable desde un clon limpio que
    falla si el control se retira. Una fila sin prueba no puede ser `verified`.
  - `accepted`: razón, dueño y fase de revisión.
  - `deferred:F9`: requisito concreto para F9 y prueba prevista.
  - `not-applicable`: razón y el cambio que la activaría.
- `scripts/security/check-evidence.ts`, expuesto como `pnpm security:evidence`, lee la matriz y
  `docs/threat-model.md`. Falla si:
  - una ruta entre comillas inversas que parece archivo (`*.test.ts`, `*.md`, `src/...`) no existe;
  - una fila no tiene uno de los cuatro estados;
  - una fila `verified` no cita evidencia;
  - queda `planned:F4` o `planned:F8`.
- El comprobador no usa red. Corre dentro de `pnpm test` en el job `integration` que ya existe, así
  que no añade ningún check de CI.
- El orden y los nombres de OWASP LLM 2026 se contrastan con la fuente primaria
  (genai.owasp.org). La matriz anota la fecha y la URL. Si la fuente no está accesible, la fila no
  se da por verificada y la matriz registra la razón.

## Consecuencias

- Bueno: cualquiera puede repetir la evidencia de una fila con el comando que la acompaña.
- Bueno: renombrar un archivo citado o dejar un estado fuera de vocabulario rompe `pnpm test`.
- Bueno: sin check nuevo de CI ni coste de minutos adicionales.
- Malo: el comprobador valida que las rutas existen y que los estados son válidos. No valida que
  la prueba sea buena ni que el control esté bien implementado; eso sigue siendo revisión humana.
- Malo: solo se comprueban las rutas escritas entre comillas inversas. Una referencia sin ellas
  no se detecta.

## Confirmación

`pnpm security:evidence` dentro de `pnpm test` en el job `integration`. Al cerrar la fase, el
autor toma cinco filas al azar y ejecuta su evidencia; si alguna no reproduce, la fila pasa a no
verificada.

## Enlaces

- [ADR-0088](0088-riesgos-aceptados-y-diferidos-a-f9.md): riesgos aceptados y diferidos a F9.
- [ADR-0086](0086-zap-baseline-pasivo-como-script-manual.md): evidencia de ZAP que cita la matriz.
- [ADR-0038](0038-eventos-de-seguridad-en-logs.md): eventos de seguridad en logs.
- [Modelo de amenazas](../threat-model.md) y [plan técnico](../PLAN.md) §6.
- [Research F8](../../specs/009-hardening/research.md) (R1 y R8) y
  [spec](../../specs/009-hardening/spec.md) (FR-001 a FR-004).
