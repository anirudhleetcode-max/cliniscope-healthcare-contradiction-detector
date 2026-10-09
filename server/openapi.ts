// OpenAPI 3.1 description of the MEDGUARD API, served at GET /api/openapi.json.
// tests/unit/backend.test.ts checks that every registered route appears here and vice versa.

const ok = (description: string) => ({ description, content: { 'application/json': { schema: { type: 'object' } } } });
const err = { $ref: '#/components/responses/Error' };
const auth = [{ bearer: [] }];
const id = (name: string, description: string) => ({ name, in: 'path', required: true, schema: { type: 'string' }, description });
const caseId = id('caseId', 'Case identifier (case_…)');
const findingId = id('findingId', 'Finding identifier (fd_…)');
const q = (name: string, description: string, schema: object = { type: 'string' }) => ({ name, in: 'query', required: false, schema, description });
const STATUS = ['unreviewed', 'in_review', 'confirmed', 'resolved', 'dismissed', 'needs_info', 'expected_change', 'undetermined'];

export const OPENAPI = {
  openapi: '3.1.0',
  info: {
    title: 'MEDGUARD API',
    version: '1.2.0',
    description: 'Shared-workspace API for the MEDGUARD healthcare record contradiction detector. Synthetic data only; not for clinical use. Errors are JSON: {"error": string, "code": string}.',
  },
  components: {
    securitySchemes: { bearer: { type: 'http', scheme: 'bearer', description: 'Opaque session token from /api/auth/login or /api/auth/register.' } },
    responses: {
      Error: { description: 'Error', content: { 'application/json': { schema: { type: 'object', properties: { error: { type: 'string' }, code: { type: 'string' } }, required: ['error', 'code'] } } } },
    },
  },
  paths: {
    '/health': { get: { summary: 'Liveness (alias without the /api prefix)', responses: { 200: ok('Service is running') } } },
    '/ready': { get: { summary: 'Readiness (alias)', responses: { 200: ok('Database reachable and migrated'), 503: err } } },
    '/api/health': { get: { summary: 'Liveness, version, AI and registration configuration (no secrets)', responses: { 200: ok('Service is running') } } },
    '/api/ready': { get: { summary: 'Readiness: database reachable and at the expected schema version', responses: { 200: ok('Ready'), 503: err } } },
    '/api/openapi.json': { get: { summary: 'This document', responses: { 200: ok('OpenAPI document') } } },

    '/api/auth/register': { post: { summary: 'Create an account (only when MEDGUARD_ALLOW_REGISTRATION=true)', requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['email', 'password', 'displayName'], properties: { email: { type: 'string', format: 'email' }, password: { type: 'string', minLength: 10 }, displayName: { type: 'string', maxLength: 80 } } } } } }, responses: { 200: ok('Session and user'), 400: err, 403: err, 409: err } } },
    '/api/auth/login': { post: { summary: 'Sign in', requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['email', 'password'], properties: { email: { type: 'string' }, password: { type: 'string' } } } } } }, responses: { 200: ok('Session and user'), 400: err, 401: err, 429: err } } },
    '/api/auth/logout': { post: { summary: 'Revoke the current session', security: auth, responses: { 200: ok('Signed out'), 401: err } } },
    '/api/auth/me': { get: { summary: 'Current user', security: auth, responses: { 200: ok('User'), 401: err } } },

    '/api/cases': {
      get: { summary: 'List cases you are a member of', security: auth, parameters: [q('limit', '1–100, default 50', { type: 'integer' }), q('offset', 'default 0', { type: 'integer' }), q('q', 'Label contains'), q('includeArchived', 'true to include archived cases', { type: 'boolean' })], responses: { 200: ok('{cases, total, limit, offset}'), 400: err, 401: err } },
      post: { summary: 'Create a case (you become its owner)', security: auth, requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['label'], properties: { id: { type: 'string', pattern: '^case_[A-Za-z0-9]{6,40}$' }, label: { type: 'string', maxLength: 80 } } } } } }, responses: { 200: ok('Case snapshot'), 400: err, 401: err, 409: err } },
    },
    '/api/cases/{caseId}': {
      get: { summary: 'Full case snapshot: case, members, documents, statements, findings, events', security: auth, parameters: [caseId], responses: { 200: ok('Snapshot'), 401: err, 404: err } },
      patch: { summary: 'Update label and/or archive or restore (owner only; audited)', security: auth, parameters: [caseId], requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { label: { type: 'string', maxLength: 80 }, archived: { type: 'boolean' } } } } } }, responses: { 200: ok('Snapshot'), 400: err, 403: err, 404: err } },
    },
    '/api/cases/{caseId}/members': { post: { summary: 'Add a collaborator (owner only)', security: auth, parameters: [caseId], requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['email', 'role'], properties: { email: { type: 'string' }, role: { enum: ['reviewer', 'viewer'] } } } } } }, responses: { 200: ok('Snapshot'), 403: err, 404: err, 409: err } } },
    '/api/cases/{caseId}/members/{userId}': { delete: { summary: 'Remove a collaborator (owner only)', security: auth, parameters: [caseId, id('userId', 'User identifier')], responses: { 200: ok('Snapshot'), 403: err, 404: err } } },
    '/api/cases/{caseId}/snapshot': { put: { summary: 'Merge documents, statements and findings computed by the client. Evidence quotes are re-verified against the stored text (422 if tampered). Review status is never taken from a snapshot.', security: auth, parameters: [caseId], responses: { 200: ok('Snapshot'), 400: err, 403: err, 409: err, 422: err } } },
    '/api/cases/{caseId}/documents': { get: { summary: 'Document metadata for a case (extracted text omitted; textLength given)', security: auth, parameters: [caseId], responses: { 200: ok('{documents}'), 404: err } } },
    '/api/cases/{caseId}/documents/{documentId}': { get: { summary: 'One document’s metadata; include=text adds the extracted text', security: auth, parameters: [caseId, id('documentId', 'Document identifier'), q('include', '"text" to include extracted text')], responses: { 200: ok('{document}'), 404: err } } },
    '/api/cases/{caseId}/documents/{documentId}/file': {
      put: { summary: 'Store the original file bytes (size-limited; kind must match the document record)', security: auth, parameters: [caseId, id('documentId', 'Document identifier')], requestBody: { required: true, content: { 'application/octet-stream': { schema: { type: 'string', format: 'binary' } } } }, responses: { 200: ok('Stored'), 400: err, 404: err, 413: err } },
      get: { summary: 'Download the original file (members only)', security: auth, parameters: [caseId, id('documentId', 'Document identifier')], responses: { 200: { description: 'File bytes' }, 404: err } },
    },
    '/api/cases/{caseId}/findings': { get: { summary: 'Findings for a case', security: auth, parameters: [caseId, q('status', 'Review status', { enum: STATUS }), q('type', 'Finding type'), q('category', 'Category'), q('includeStale', 'true to include superseded findings', { type: 'boolean' })], responses: { 200: ok('{findings}'), 400: err, 404: err } } },
    '/api/cases/{caseId}/activity': { get: { summary: 'Case activity, newest first (append-only log)', security: auth, parameters: [caseId, q('limit', '1–200, default 50', { type: 'integer' }), q('before', 'Return events with seq lower than this (pagination)', { type: 'integer' })], responses: { 200: ok('{events, nextBefore}'), 400: err, 404: err } } },
    '/api/activity': { get: { summary: 'Recent activity across all of your cases', security: auth, parameters: [q('limit', '1–200, default 50', { type: 'integer' })], responses: { 200: ok('{events}'), 401: err } } },
    '/api/findings/{findingId}': { get: { summary: 'One finding', security: auth, parameters: [findingId], responses: { 200: ok('{finding}'), 404: err } } },
    '/api/findings/{findingId}/evidence': { get: { summary: 'Evidence references, each re-verified against the stored document text', security: auth, parameters: [findingId], responses: { 200: ok('{findingId, evidence[]}'), 404: err } } },
    '/api/findings/{findingId}/history': { get: { summary: 'Review decisions and notes for a finding, oldest first', security: auth, parameters: [findingId], responses: { 200: ok('{findingId, reviewStatus, history[]}'), 404: err } } },
    '/api/findings/{findingId}/transition': { post: { summary: 'Record a review decision (validated state machine; reason required for resolve, dismiss, expected change, unable to determine and reopen)', security: auth, parameters: [findingId], requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['to'], properties: { to: { enum: STATUS }, reason: { type: 'string', maxLength: 2000 }, expectedStatus: { enum: STATUS } } } } } }, responses: { 200: ok('Snapshot'), 403: err, 404: err, 409: err, 422: err } } },
    '/api/findings/{findingId}/notes': { post: { summary: 'Add a reviewer note', security: auth, parameters: [findingId], requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['note'], properties: { note: { type: 'string', maxLength: 4000 } } } } } }, responses: { 200: ok('Snapshot'), 400: err, 403: err, 404: err } } },
    '/api/ai/analyze': { post: { summary: 'Optional AI-assisted analysis (requires a configured provider key on the server and explicit consent in the client)', security: auth, responses: { 200: ok('Verified AI findings'), 400: err, 429: err, 503: err } } },
  },
} as const;
