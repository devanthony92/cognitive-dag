# Quickstart: validar F5

```bash
docker compose up -d --wait && pnpm db:migrate && pnpm dev
```

`.env` con `llm-nodes-enabled` encendido y `LLM_PROVIDER=fake` (escenarios 1–12). Para el 13,
`LLM_PROVIDER=gemini` y `GEMINI_API_KEY` en `.env` (nunca se commitea). Límites bajos para los
escenarios 6–7: `LLM_MAX_TOKENS_PER_RUN=2000`, `LLM_MAX_TOKENS_PER_ORG_DAY=5000`.

| # | Historia | Pasos | Resultado esperado |
|---|---|---|---|
| 1 | US1 | Manual → Clasificar (positivo/negativo) → Condición sobre `label` → Generar | Completado; etiqueta de la lista, confianza en [0,1], rama correcta, texto ≤ longitud máxima |
| 2 | US1 | Extraer datos con `nombre: string`, `monto: number` | Salida con exactamente esos campos y tipos |
| 3 | US1 | Abrir el paso de un nodo LLM | Modelo, tokens de entrada/salida, costo estimado, "Confianza estimada"; sin prompt |
| 4 | US2 | `FakeProvider` con 1 salida inválida y luego válida | Completado; 1 reparación en el paso |
| 5 | US2 | `FakeProvider` con 3 salidas inválidas; luego con bloqueo | Fallido `invalid_output` sin reintentos (`LLM_INVALID_OUTPUT`; `LLM_CONTENT_BLOCKED`) |
| 6 | US3 | Ejecutar hasta superar `LLM_MAX_TOKENS_PER_RUN` | Fallido `budget_exhausted` (`LLM_RUN_BUDGET_EXHAUSTED`); sin llamada extra; evento `llm.budget_exhausted` en logs |
| 7 | US3 | Ejecutar varias veces hasta superar el límite diario; otra organización ejecuta | La primera falla `LLM_DAILY_BUDGET_EXHAUSTED`; la otra completa |
| 8 | US3 | Página de la organización | "Consumo LLM de hoy" con usados/límite y costo; estados de carga, vacío y error |
| 9 | US4 | `pnpm --filter @cognitive-dag/llm test` (set de inyección) | 0 escapes |
| 10 | US5 | `redactPii: true` con correo y tarjeta en el texto | El `FakeProvider` registra `[EMAIL_1]` y `[CARD_1]`; logs sin el texto |
| 11 | US6 | `llm-nodes-enabled=false`; luego `LLM_ENABLED=false` en el worker | Nodos LLM no ejecutables y 404 en consumo; con el interruptor, fallo `LLM_DISABLED` sin llamada |
| 12 | US7 | Clasificar → servicio simulado fallido; reejecutar desde el servicio | Clasificar "reutilizado", sin tokens nuevos |
| 13 | SC-003 | `pnpm eval:llm` con Gemini (local o job manual `llm-evals.yml`) | 0 escapes; salidas válidas; tokens y costo reportados |
