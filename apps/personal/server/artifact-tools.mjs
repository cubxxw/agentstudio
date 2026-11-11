import { APIError } from './store.mjs';

const string = (maxLength = 4000) => ({ type: 'string', minLength: 1, maxLength });
const list = (maxItems = 32) => ({ type: 'array', items: string(240), maxItems });
const object = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const descriptor = (name, description, properties = {}, required = [], readOnlyHint = false) => ({ name, description, inputSchema: object(properties, required), annotations: { readOnlyHint, openWorldHint: false } });

export const ARTIFACT_TOOLS = [
  descriptor('artifact_list', 'List artifacts jointly visible to this conversation or authorized work. Returns only allowed versions.', {}, [], true),
  descriptor('artifact_read', 'Read selected UTF-8 files and SHA-256 hashes. During a work step, omitted artifactId reads your current staged files; outside work, choose a jointly visible artifact.', { artifactId: string(160), revisionId: string(160), paths: list(256) }, [], true),
  descriptor('creation_propose', 'Propose or join one shared artifact plan for the current owner message. Describe your own contribution and dependencies. This creates a review card, not permission to execute. Each participating agent should propose its own useful role.', { title: string(120), kind: { type: 'string', enum: ['document', 'website'] }, goal: string(), task: string(3000), writePaths: list(), dependsOnContacts: list(24), notes: string(3000), artifactId: string(160) }, ['title', 'kind', 'goal', 'task']),
  descriptor('creation_update', 'Update your contribution to an unapproved shared plan, using its current version.', { proposalId: string(160), version: { type: 'integer', minimum: 1 }, task: string(3000), notes: string(3000), writePaths: list(), dependsOnContacts: list(24) }, ['proposalId', 'version']),
  descriptor('permission_request', 'Ask the owner for a precise additional local artifact capability. The request never grants itself. Explain the target and reason.', { capability: { type: 'string', enum: ['artifact_read', 'artifact_write', 'participant'] }, reason: string(2000), artifactId: string(160), revisionId: string(160), paths: list(), contactId: string(160) }, ['capability', 'reason']),
  descriptor('collaboration_status', 'Read this work’s steps and shared handoff messages, or this conversation’s current proposal status.', {}, [], true),
  descriptor('task_claim', 'Confirm your assigned current step and its approved scope.', {}, [], true),
  descriptor('task_delegate', 'Queue a bounded child task for an already approved participant. Returns immediately. Delegate before writing incomplete files that depend on the child.', { contactId: string(160), task: string(3000), writePaths: list(), dependsOnStepIds: list(24) }, ['contactId', 'task']),
  descriptor('task_yield', 'Save a concise work checkpoint and release this model attempt while waiting for child steps. Submit your current changes first, or yield before writing. No private reasoning.', { waitForStepIds: list(24), checkpoint: string(3000) }, ['waitForStepIds', 'checkpoint']),
  descriptor('collaboration_message', 'Leave a bounded shared work note for an approved participant. This does not recursively send group chat messages.', { contactId: string(160), text: string(2000) }, ['contactId', 'text']),
  descriptor('artifact_write', 'Write or delete one relative UTF-8 file in your step workspace. Supply the current SHA-256 from artifact_read/artifact_write; null means create a new file. text:null deletes. After submitting, use a new child step for further edits.', { path: string(240), text: { type: ['string', 'null'], maxLength: 1_048_576 }, expectedHash: { type: ['string', 'null'], maxLength: 64 } }, ['path', 'text', 'expectedHash']),
  descriptor('artifact_submit', 'Submit your staged changes as an attributed contribution. The host merges and checks the complete candidate. A successful result contains a real revision ID.', { summary: string(2000) }, ['summary']),
  descriptor('artifact_check', 'Run host-owned integrity and relative-resource checks on your complete candidate. final:true additionally requires a website entry. Does not run shell commands.', { final: { type: 'boolean' } }),
  descriptor('task_complete', 'Request completion after your actual contribution was submitted and checked. The host validates completion after this executor exits.', { summary: string(2000) }, ['summary']),
];
const conversationNames = new Set(['artifact_list', 'artifact_read', 'creation_propose', 'creation_update', 'permission_request', 'collaboration_status']);
export const artifactTools = mode => ARTIFACT_TOOLS.filter(tool => mode === 'work' ? !['creation_propose', 'creation_update'].includes(tool.name) : conversationNames.has(tool.name));

export function validateArtifactInput(schema, value, path = 'arguments') {
  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  const type = value === null ? 'null' : Array.isArray(value) ? 'array' : Number.isInteger(value) ? 'integer' : typeof value;
  const fail = () => { throw new APIError(400, 'invalid_tool_input', `${path} 不符合工具参数要求`); };
  if (!types.includes(type)) fail();
  if (schema.enum && !schema.enum.includes(value)) fail();
  if (type === 'string' && (value.length < (schema.minLength || 0) || value.length > (schema.maxLength || 2_000_000))) fail();
  if (type === 'integer' && value < (schema.minimum || 0)) fail();
  if (type === 'array') { if (value.length > (schema.maxItems || 256)) fail(); value.forEach((item, i) => validateArtifactInput(schema.items, item, `${path}[${i}]`)); }
  if (type === 'object') {
    if (!value || (schema.required || []).some(key => !Object.hasOwn(value, key)) || Object.keys(value).some(key => !Object.hasOwn(schema.properties || {}, key))) fail();
    for (const [key, item] of Object.entries(value)) validateArtifactInput(schema.properties[key], item, `${path}.${key}`);
  }
}
