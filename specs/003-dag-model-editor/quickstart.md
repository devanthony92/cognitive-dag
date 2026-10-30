# Quickstart: validar F2

Contratos: [contracts/api.openapi.yaml](./contracts/api.openapi.yaml). Modelo:
[data-model.md](./data-model.md).

```bash
docker compose up -d --wait && pnpm db:migrate && pnpm dev
```

| # | Historia | Pasos | Resultado esperado |
|---|---|---|---|
| 1 | US1 | Como editor, crear el workflow "Reembolsos", arrastrar disparador manual, `llm.classify`, condición y `http.request`, conectarlos y guardar | Tras recargar, el grafo y la configuración se conservan |
| 2 | US1 | Abrir el mismo workflow como viewer | Solo lectura: sin paleta, Guardar ni Publicar |
| 3 | US1 | Usuario de otra organización abre la URL del workflow | 404 |
| 4 | US2 | Crear un ciclo; borrar el disparador; dejar un nodo suelto | Error en cada caso sobre el nodo afectado y en la lista de problemas |
| 5 | US2 | Referenciar un campo de un nodo posterior o de tipo incompatible | Error sobre el campo |
| 6 | US2 | Guardar con errores y luego intentar publicar | Guarda; publicar se rechaza |
| 7 | US3 | Publicar v1, editar, publicar v2, reactivar v1 | v1 activa, v2 intacta, borrador con los cambios |
| 8 | US3 | Comparar `definition_hash` de v1 antes y después del paso 7 | Igual |
| 9 | US4 | Insertar una referencia en el cuerpo de `http.request`; armar la condición `label = "enojado" Y confidence > 0.8` | Ambas validadas; la condición se guarda como AST |
| 10 | US5 | Abrir el borrador en dos navegadores y guardar en ambos | El segundo recibe 409 y la opción de recargar |
| 11 | US6 | Desordenar el grafo, pulsar Ordenar, exportar JSON | Grafo en capas; el JSON valida con el esquema |
| 12 | US7 | `pnpm ops:set-limits <orgId> --max-nodes 3` y agregar un 4.º nodo | Rechazo por límite; otra organización sigue con 50 |
| 13 | US7 | Intentar cambiar límites desde el API como owner | No existe endpoint de escritura |
| 14 | FR-025 | `dag-editor-enabled=false` | Endpoints 404 `FEATURE_NOT_AVAILABLE`; el editor no aparece |
