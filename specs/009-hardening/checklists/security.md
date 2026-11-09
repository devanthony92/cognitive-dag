# Security Requirements Checklist: Endurecimiento (F8)

**Purpose**: Comprobar que los requisitos de seguridad de la spec son completos, claros y medibles
antes de implementar (pruebas de los requisitos, no de la implementación).
**Created**: 2026-11-08
**Feature**: [spec.md](../spec.md)

## Cobertura de OWASP

- [X] CHK001 Las 10 filas de 6.1 y las 10 de 6.2 tienen un destino en la matriz (FR-001, research R1)
- [X] CHK002 Cada estado posible está definido y exige razón, dueño y revisión cuando aplica (FR-002)
- [X] CHK003 Las filas que dependen del despliegue tienen requisito y prueba prevista para F9 (FR-026, FR-027, research R9)
- [X] CHK004 La verificación contra la fuente primaria de OWASP LLM 2026 está pedida y define qué hacer si no hay acceso (FR-004, R1)
- [X] CHK005 Las desviaciones entre PLAN y código (A07, A08, A09) se corrigen en el PLAN (FR-004, FR-028)

## Autorización y agencia

- [X] CHK006 La regla de roles de ejecución es explícita para iniciar, cancelar y reejecutar (FR-005)
- [X] CHK007 Se define qué sigue abierto al viewer (lecturas) y cómo lo comunica la UI (FR-006, FR-007)
- [X] CHK008 El fallo cerrado ante un rol desconocido y la lectura del rol en cada petición están pedidos (FR-005)
- [X] CHK009 Hay un requisito que impide añadir una ruta que cambie estado sin decisión de rol (FR-008)
- [X] CHK010 El compilador nunca rellena url, cabeceras, cuerpo ni credencial, y la publicación se bloquea (FR-009, FR-010)
- [X] CHK011 Los casos de inyección dirigidos a los nodos de F7 y el umbral de evals están definidos (FR-011, SC-005)

## Configuración, suministro y criptografía

- [X] CHK012 Lo que se mide en A02, A03, A04 y A10 está enumerado (FR-024)
- [X] CHK013 Lo que NO se añade (SBOM, escaneo de imágenes) y su razón están escritos (FR-024, decisión 9C)
- [X] CHK014 La prohibición de `eval`, `new Function` y `dangerouslySetInnerHTML` tiene comprobación automática (FR-025)

## ZAP

- [X] CHK015 El alcance (pasivo, local, sin terceros), la ausencia de CI y el destino de cada alerta están definidos (FR-013 a FR-015)
- [X] CHK016 Lo que ZAP no cubre se difiere a F9 con requisito (historia 4, R5)

## Flags y kill switches

- [X] CHK017 Los ocho flags y sus issues están enumerados; los kill switches que se conservan también (FR-016, FR-017)
- [X] CHK018 El apagado de los nodos LLM sin flag está cubierto por `LLM_ENABLED` (historia 5, escenario 4)
- [X] CHK019 Está dicho que la autorización no cambia al eliminar los flags (FR-016, SC-006)

## Modelo de amenazas

- [X] CHK020 No quedan estados `planned:*` sin destino (FR-019, SC-003)
- [X] CHK021 Las afirmaciones del modelo se contrastan con el código (FR-020, ejemplo `approval.timed_out`)
- [X] CHK022 Los riesgos aceptados nuevos (MFA, auditoría, 8C, 9C) llevan razón y fase de revisión (FR-027, FR-028)

## Notes

- Los requisitos de F9 se registran, no se implementan, en F8.
- El comprobador de referencias (research R1) da evidencia automática de CHK020 y CHK021.
