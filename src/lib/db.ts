// IndexedDB persistence (via Dexie). Data lives in the reviewer's browser.
import Dexie, { type Table } from 'dexie';
import type { AuditEvent, CaseRecord, ClinicalStatement, DocumentRecord, Finding } from './types';

export interface StoredFile {
  id: string; // document id
  caseId: string;
  blob: Blob;
}

export class CliniscopeDB extends Dexie {
  cases!: Table<CaseRecord, string>;
  documents!: Table<DocumentRecord, string>;
  files!: Table<StoredFile, string>;
  statements!: Table<ClinicalStatement, string>;
  findings!: Table<Finding, string>;
  events!: Table<AuditEvent, string>;

  constructor(name = 'cliniscope') {
    super(name);
    this.version(1).stores({
      cases: 'id, createdAt',
      documents: 'id, caseId, [caseId+contentHash]',
      files: 'id, caseId',
      statements: 'id, caseId, documentId',
      findings: 'id, caseId, [caseId+fingerprint]',
      events: 'id, caseId, findingId, at',
    });
  }
}

let instance: CliniscopeDB | null = null;
export function getDb(): CliniscopeDB {
  if (!instance) instance = new CliniscopeDB();
  return instance;
}
