# Quickstart: validar F6

```bash
docker compose up -d --wait && pnpm db:migrate && pnpm dev
```

`.env` con `nl-compiler-enabled` y `llm-nodes-enabled` encendidos y `LLM_PROVIDER=fake` (escenarios
1–11). Para el 12, `LLM_PROVIDER=gemini` y `GEMINI_API_KEY` en `.env` (nunca se commitea; solo datos
de prueba).

| # | Historia | Pasos | Resultado esperado |
|---|---|---|---|
| 1 | US1 | "Describir workflow" con una intención de 3–5 pasos | Estado en cola → compilando → listo; vista previa con nodos por capas sin solaparse |
| 2 | US1 | "Crear workflow con este borrador" | Workflow nuevo con ese borrador, sin versiones ni ejecuciones; se abre el editor |
| 3 | US2 | Desde un workflow, regenerar y "Reemplazar borrador" | Confirmación; borrador reemplazado; revisión +1; versiones intactas |
| 4 | US2 | Regenerar, cambiar el borrador en otra pestaña, aplicar | Conflicto de revisión; borrador sin cambios |
| 5 | US3 | `FakeProvider` con 1 DAG con ciclo y luego válido | Listo con 1 reparación |
| 6 | US3 | `FakeProvider` con 3 DAG inválidos que cumplen el esquema | Fallido `COMPILER_INVALID_DAG`; "Abrir el último intento como borrador" muestra los errores |
| 7 | US4/US5 | `pnpm eval:compiler` con `fake` | 100 % de éxito; 0 escapes en inyección |
| 8 | US5 | `llm-nodes-enabled=false` y compilar "clasifica y responde" | Sin nodos `llm.*` en el DAG o fallo `COMPILER_INVALID_DAG` |
| 9 | US6 | Intención de 2001 caracteres; 11 compilaciones en una hora | 400 `COMPILER_INTENT_TOO_LONG`; 429 `COMPILER_RATE_LIMITED` con `Retry-After` |
| 10 | US6 | Ver la compilación y "Consumo LLM de hoy" | Modelo, llamadas, reparaciones, tokens y costo; el consumo diario los incluye |
| 11 | US8 | `nl-compiler-enabled=false`; viewer; otra organización | 404 y sin entrada en la UI; 403; 404 |
| 12 | SC-001/002 | `pnpm eval:compiler` con Gemini (local o job `compiler-evals.yml`) | ≥ 80 % de éxito; 0 escapes; tokens y costo reportados |
