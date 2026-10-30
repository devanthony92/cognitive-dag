# @cognitive-dag/dag-schema

The DAG model of CognitiveDAG: definition schema, node catalog, reference type system, templates,
condition AST and deterministic semantic validation. One implementation, used unchanged by the
browser editor, the API and (from F3) the worker.

- Runtime dependency: `zod` only. No Node-only APIs, so it runs in the browser and in Node.
- Nothing in a definition is ever executed: no `eval`, no `new Function`, no template engine.
  Templates are split by a hand-written tokenizer and conditions are a typed tree.
- User-facing messages are in Spanish; codes are stable identifiers.

## Public API

```ts
import {
  validateDefinition,
  DagDefinitionSchema,
  NODE_CATALOG,
  DEFAULT_LIMITS,
} from '@cognitive-dag/dag-schema';

const result = validateDefinition(input, { limits: DEFAULT_LIMITS });
if (!result.valid) {
  for (const e of result.errors) console.log(e.code, e.message, e.location);
}
```

| Export                                                                       | Purpose                                                                                                                                         |
| ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `validateDefinition(input, { limits? })`                                     | Full validation. Returns `{ valid, errors, definition? }`. Errors carry `code`, Spanish `message` and `location`.                               |
| `DagDefinitionSchema`, `DagNodeSchema`, `DagEdgeSchema`                      | Strict Zod schemas (unknown fields are rejected at every level).                                                                                |
| `emptyDefinition()`, `SCHEMA_VERSION`, `NodeIdSchema`                        | Helpers for new drafts. Node ids match `^[a-z][a-z0-9_]{0,39}$`.                                                                                |
| `NODE_CATALOG`, `NODE_TYPES`, `isNodeType`                                   | The 11 node types: `configSchema`, `defaultConfig()`, `outputSchema(config)`, `handles`, `templatableFields`, `executableFrom`, `acceptsInput`. |
| `DagType`, `FieldTypeSchema`, `isAssignable`, `isTextConvertible`            | Reference type system (`string`, `number`, `boolean`, `datetime`, `enum`, `object`, `list`).                                                    |
| `parseReference`, `resolveReference`                                         | `nodes.<id>.output.<field>` paths, checked for existence, ancestry, field and type.                                                             |
| `tokenizeTemplate`                                                           | Splits `{{reference}}` markers from literal text; evaluates nothing.                                                                            |
| `ConditionSchema`, `checkCondition`, `measureCondition`                      | Condition AST (`eq neq gt gte lt lte in exists and or not`), depth ≤ 5, ≤ 20 operations.                                                        |
| `DEFAULT_LIMITS`, `ABSOLUTE_LIMITS`, `DagLimitsSchema`, `definitionByteSize` | Per-organization size limits (50 / 100 / 256 KB by default) and the ceilings nobody can exceed.                                                 |

## Validation order

1. Strict schema (also rejects secret-like fields, non-https URLs and authorization headers)
2. Unique node and connection ids
3. Exactly one trigger, without incoming connections
4. Connections point to existing nodes and existing output handles
5. Cycles (reported with the nodes that form each cycle)
6. Every node reachable from the trigger
7. References and templates (existence, ancestor, field, type)
8. Limits

A schema failure stops the run; the other steps all report. Errors always come out in the same
order, so browser and server agree.

## Scripts

```bash
pnpm --filter @cognitive-dag/dag-schema test
pnpm --filter @cognitive-dag/dag-schema typecheck
pnpm --filter @cognitive-dag/dag-schema build
```
