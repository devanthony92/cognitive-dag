import {
  NODE_CATALOG,
  NODE_TYPES,
  isNodeType,
  type ExecutableFrom,
  type NodeType,
} from '@cognitive-dag/dag-schema';

/** What the compiler tells the model about one node type (research R10). */
export interface CompilerNodeType {
  type: NodeType;
  /** False for triggers: no connection may end in them. */
  acceptsInput: boolean;
  handles: readonly string[];
  /** Top-level configuration fields. */
  fields: readonly string[];
  /** Fields the compiler never fills (research R12). */
  sensitiveFields: readonly string[];
  /** English instructions with the configuration shape and an example. */
  guide: string;
}

const TYPE_SYNTAX =
  'A field type is {"kind":"string"}, {"kind":"number"}, {"kind":"boolean"}, {"kind":"datetime"}, ' +
  '{"kind":"enum","values":["a","b"]}, {"kind":"list","item":<type>} or ' +
  '{"kind":"object","fields":{"<name>":<type>}}.';

const REFERENCE_SYNTAX =
  'Text fields may embed {{nodes.<id>.output.<field>}} to use the output of an earlier node.';

/**
 * Hand-written guides, in English (constitution IX). The field list and the handles come from the
 * node catalog; the guide adds the shape and an example the model can copy.
 */
const GUIDES: Readonly<Partial<Record<NodeType, string>>> = {
  'trigger.manual':
    'Starts the workflow by hand. config: {"inputSchema":[{"name":"<field>","type":<type>}]} ' +
    'declares the input fields (snake_case names); later nodes read them as ' +
    `nodes.<trigger_id>.output.<field>. ${TYPE_SYNTAX} ` +
    'Example config: {"inputSchema":[{"name":"email_body","type":{"kind":"string"}}]}',
  'logic.condition':
    'Chooses one of two branches: connect the next nodes from the handles "true" and "false". ' +
    'config: {"condition":<condition>}. A condition is ' +
    '{"op":"eq|neq|gt|gte|lt|lte","left":<operand>,"right":<operand>}, ' +
    '{"op":"in","value":<operand>,"options":[<literal>,...]}, {"op":"exists","operand":<ref>}, ' +
    '{"op":"and|or","operands":[<condition>,...]} or {"op":"not","operand":<condition>}. ' +
    'An operand is {"kind":"ref","path":"nodes.<id>.output.<field>"} (an earlier node) or ' +
    '{"kind":"literal","type":"string|number|boolean|datetime","value":<value>}; both sides must ' +
    'have the same type. Example config: {"condition":{"op":"eq","left":{"kind":"ref","path":' +
    '"nodes.classify.output.label"},"right":{"kind":"literal","type":"string","value":"spam"}}}',
  'logic.merge':
    'Joins several branches into one. config: {"strategy":"all"} waits for every incoming ' +
    'branch; {"strategy":"any"} continues with the first that finishes. Use "any" after the two ' +
    'branches of a condition. Example config: {"strategy":"any"}',
  'mock.service':
    'Simulated external service. Use it for every action the catalog has no real node for ' +
    '(send an email, store a record, notify someone, call a system) and name it in the label. ' +
    'config: {"latencyMs":0-30000,"failureRate":0-1,"failureKind":' +
    '"transient|permanent|timeout|rate_limited"}. Output: {"ok":boolean}. ' +
    'Example config: {"latencyMs":100,"failureRate":0,"failureKind":"transient"}',
  'llm.classify':
    'Assigns a text to exactly one of 2-20 distinct labels. config: {"text":"<text>",' +
    `"labels":["<label>",...]}. ${REFERENCE_SYNTAX} Output: {"label":<one of the labels>,` +
    '"confidence":0-1}. Example config: {"text":"{{nodes.start.output.email_body}}",' +
    '"labels":["spam","not_spam"]}',
  'llm.extract':
    'Extracts typed fields from a text. config: {"text":"<text>","fields":[{"name":"<field>",' +
    `"type":<type>}]} with 1-30 fields. ${REFERENCE_SYNTAX} ${TYPE_SYNTAX} Output: an object ` +
    'with those fields. Example config: {"text":"{{nodes.start.output.invoice}}","fields":' +
    '[{"name":"customer","type":{"kind":"string"}},{"name":"total","type":{"kind":"number"}}]}',
  'llm.generate':
    'Writes a text from an instruction. config: {"instruction":"<instruction>","language":' +
    `"<two-letter code>","maxLength":1-10000}. ${REFERENCE_SYNTAX} Output: {"text":string}. ` +
    'Example config: {"instruction":"Write a short reply to: {{nodes.start.output.email_body}}",' +
    '"language":"es","maxLength":500}',
  'trigger.webhook':
    'Starts the workflow when an HTTP request arrives. config: {"bodySchema":[{"name":"<field>",' +
    '"type":<type>}]} declares the fields the request body is expected to have (snake_case names; ' +
    'an empty list is allowed); later nodes read them as nodes.<trigger_id>.output.<field>. ' +
    `${TYPE_SYNTAX} Example config: {"bodySchema":[{"name":"order_id","type":{"kind":"string"}}]}`,
  'trigger.schedule':
    'Starts the workflow on a schedule. config: {"cron":"<5 fields: minute hour day month ' +
    'weekday>","timezone":"<IANA zone>"}. Use "UTC" unless the request names a place. Output: ' +
    '{"firedAt":datetime}. Example config: {"cron":"0 9 * * 1","timezone":"UTC"}',
  'human.approval':
    'Pauses the workflow until a person approves or rejects, or the time runs out. Connect the ' +
    'next nodes from the handles "approved", "rejected" and "timeout"; every handle needs a ' +
    'destination unless the flow ends there. config: {"message":"<text shown to the person>",' +
    `"timeoutSeconds":60-2592000}. ${REFERENCE_SYNTAX} Output: {"decision":"approved|rejected|` +
    'timeout","approvedBy":string}. Example config: {"message":"Approve the refund of ' +
    '{{nodes.start.output.amount}}","timeoutSeconds":86400}',
  'http.request':
    'Calls an external https API. config: {"method":"GET|POST|PUT|PATCH|DELETE"}. The url, ' +
    'headers, body and credentialId are sensitive: leave them out, the person fills them in. ' +
    'Output: {"status":number,"body":string}. Example config: {"method":"GET"}',
};

/** Node types executable in the given phases, in catalog order (research R10). */
export function nodeTypesExecutableIn(phases: readonly ExecutableFrom[]): NodeType[] {
  return NODE_TYPES.filter((type) => phases.includes(NODE_CATALOG[type].executableFrom));
}

/**
 * Types the compiler may offer to an organization: F3 and F7, plus F5 with `llm-nodes-enabled`
 * (F8 decision 3A; the nodes of F7 no longer depend on any flag). Destinations, headers, bodies and
 * credentials of `http.request` stay out of the model's hands through `sensitiveFields`.
 */
export function allowedNodeTypes(flags: { llmNodesEnabled: boolean }): NodeType[] {
  return nodeTypesExecutableIn(flags.llmNodesEnabled ? ['F3', 'F5', 'F7'] : ['F3', 'F7']);
}

/** The catalog the prompt shows. Unknown types or types without a guide are a programming error. */
export function compilerCatalog(types: readonly string[]): CompilerNodeType[] {
  return types.map((type) => {
    if (!isNodeType(type)) throw new RangeError(`Unknown node type for the compiler: ${type}`);
    const guide = GUIDES[type];
    if (!guide) throw new RangeError(`Node type without a compiler guide: ${type}`);
    const entry = NODE_CATALOG[type];
    return {
      type,
      acceptsInput: entry.acceptsInput,
      handles: entry.handles,
      fields: Object.keys(entry.fieldLabels),
      sensitiveFields: entry.sensitiveFields ?? [],
      guide,
    };
  });
}
