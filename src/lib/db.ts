// IndexedDB persistence (via Dexie). Data lives in the reviewer's browser.
import Dexie, { type Table } from 'dexie';
import type { AuditEvent, CaseRecord, ClinicalStatement, DocumentRecord, Finding } from './types';

export interface StoredFile {
  id: string; // document id
  caseId: string;
  blob: Blob;
}

export class MedguardDB extends Dexie {
  cases!: Table<CaseRecord, string>;
  documents!: Table<DocumentRecord, string>;
  files!: Table<StoredFile, string>;
  statements!: Table<ClinicalStatement, string>;
  findings!: Table<Finding, string>;
  events!: Table<AuditEvent, string>;

  constructor(name = 'medguard') {
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

let instance: MedguardDB | null = null;
export function getDb(): MedguardDB {
  if (!instance) instance = new MedguardDB();
  return instance;
}
