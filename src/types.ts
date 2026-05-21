// Shared shapes. Field names mirror schema.dbml's mongo.documents and
// the Kafka event envelopes in document-upload-workflow.md §6.4 and §7.

// Coarse state machine — workflow doc §4. Monotonic; never moves backward.
export type TrackingStatus =
  | 'PENDING_SCAN'
  | 'SCANNING'
  | 'STORED'
  | 'REJECTED_MALICIOUS'
  | 'REJECTED_REVIEW'
  | 'REJECTED_TIMEOUT'
  | 'QUARANTINED_FOR_REVIEW';

// Sub-stage while tracking_status=SCANNING — workflow doc §4, §6.4.
export type ScanStage =
  | 'submitted'
  | 'cuckoo'
  | 'clamav'
  | 'yara'
  | 'suricata'
  | 'aggregating'
  | 'done';

// Business view (schema.dbml mongo.documents.doc_status).
export type DocStatus = 'ACTIVE' | 'QUARANTINED' | 'BLOCKED' | 'ARCHIVED' | 'DELETED';

export type Verdict = 'SAFE' | 'SUSPICIOUS' | 'MALICIOUS' | 'INCONCLUSIVE';

export interface DocumentRow {
  document_id: string;
  parent_type?: string;
  parent_ref?: string;
  doc_type?: string;
  original_filename: string;
  system_filename: string;
  file_extension?: string;
  file_size_bytes: number;
  sha256_hash: string;
  uploaded_at: string;
  uploaded_by?: string;
  notify_email?: string;
  correlation_id?: string;

  // Operational status (workflow §9.2)
  tracking_status: TrackingStatus;
  scan_stage?: ScanStage;
  progress_pct?: number;
  submission_id?: string;

  // Business view + verdict summary (mongo.documents per schema)
  doc_status: DocStatus;
  sandbox_classification?: Verdict;
  cuckoo_task_id?: string;
  clamav_result?: string;
  yara_matches?: string[];
  suricata_alerts?: string[];

  // Storage pointer — PoC: relative path on local FS.
  storage_path: string;
}

export interface ScannerResult {
  name: 'cuckoo' | 'clamav' | 'yara' | 'suricata';
  status: string;
  score?: number;
  evidence?: string[];
}

export interface VerdictEvent {
  schema: 'mis.documents.verdict.v1';
  correlation_id?: string;
  document_id: string;
  submission_id: string;
  verdict: Verdict;
  verdict_at: string;
  scanner_results: ScannerResult[];
  cuckoo_task_id?: string;
}

export interface ProgressEvent {
  schema: 'mis.documents.scan-progress.v1';
  correlation_id?: string;
  document_id: string;
  submission_id: string;
  stage: ScanStage;
  progress_pct: number;
  started_at: string;
  cuckoo_task_id?: string;
}

export interface NotificationEvent {
  schema: 'mis.notifications.v1';
  correlation_id?: string;
  channel: 'EMAIL' | 'SMS' | 'IN_APP' | 'WEBHOOK';
  template_ref: string;
  recipient_id: string;
  recipient_email?: string;
  payload: Record<string, unknown>;
  priority: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
}

export interface AuditEvent {
  schema: 'mis.audit.v1';
  correlation_id?: string;
  action: string;
  actor: string;
  resource: { type: string; id: string };
  severity: 'INFO' | 'WARN' | 'SEV-1';
  metadata?: Record<string, unknown>;
  emitted_at: string;
}
