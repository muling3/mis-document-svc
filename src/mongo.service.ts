// MongoClient + documents collection helpers. Tolerant of unreachable
// Mongo (logs, returns null) so the service still boots without infra.

import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Collection, MongoClient } from 'mongodb';
import { loadConfig } from './config';
import type {
  DocStatus,
  DocumentRow,
  ScanStage,
  ScannerResult,
  TrackingStatus,
  Verdict,
} from './types';

@Injectable()
export class MongoService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(MongoService.name);
  private readonly config = loadConfig();
  private client?: MongoClient;
  private collection?: Collection<DocumentRow>;

  async onModuleInit(): Promise<void> {
    if (!this.config.mongodb.uri) {
      this.log.warn('MONGODB_URI unset — document rows will be dropped (PoC mode)');
      return;
    }
    try {
      this.client = new MongoClient(this.config.mongodb.uri);
      await this.client.connect();
      const db = this.client.db(this.config.mongodb.db);
      this.collection = db.collection<DocumentRow>(this.config.mongodb.collection);
      await this.collection.createIndex({ document_id: 1 }, { unique: true });
      await this.collection.createIndex({ submission_id: 1 });
      await this.collection.createIndex({ sha256_hash: 1 });
      this.log.log(
        `mongo connected — ${this.config.mongodb.db}.${this.config.mongodb.collection}`,
      );
    } catch (err: any) {
      this.log.error(`mongo connect failed: ${err?.message ?? err}`);
      this.client = undefined;
      this.collection = undefined;
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client) await this.client.close().catch(() => undefined);
  }

  private require(): Collection<DocumentRow> {
    if (!this.collection) throw new Error('mongo: documents collection unavailable');
    return this.collection;
  }

  async insert(row: DocumentRow): Promise<void> {
    await this.require().insertOne({ ...row });
  }

  async findById(documentId: string): Promise<DocumentRow | null> {
    if (!this.collection) return null;
    return this.collection.findOne({ document_id: documentId });
  }

  async findBySubmission(submissionId: string): Promise<DocumentRow | null> {
    if (!this.collection) return null;
    return this.collection.findOne({ submission_id: submissionId });
  }

  // Idempotent — used by the scan-progress consumer (latest stage wins).
  // Deliberately does NOT touch tracking_status: that's owned by the
  // upload path (PENDING_SCAN → SCANNING at attachSubmission) and the
  // verdict consumer (SCANNING → terminal). Otherwise a late "done"
  // progress event could clobber a verdict that's already landed.
  async updateScanStage(
    documentId: string,
    stage: ScanStage,
    progressPct: number,
    cuckooTaskId?: string,
  ): Promise<void> {
    if (!this.collection) return;
    const set: Partial<DocumentRow> = {
      scan_stage: stage,
      progress_pct: progressPct,
    };
    if (cuckooTaskId) set.cuckoo_task_id = cuckooTaskId;
    await this.collection.updateOne({ document_id: documentId }, { $set: set });
  }

  // Used by submit() to write submission_id after sandbox accepts.
  async attachSubmission(documentId: string, submissionId: string): Promise<void> {
    if (!this.collection) return;
    await this.collection.updateOne(
      { document_id: documentId },
      { $set: { submission_id: submissionId, tracking_status: 'SCANNING' as TrackingStatus } },
    );
  }

  // Terminal transition driven by the verdict consumer.
  async applyVerdict(args: {
    documentId: string;
    tracking: TrackingStatus;
    docStatus: DocStatus;
    verdict: Verdict;
    scannerResults: ScannerResult[];
    cuckooTaskId?: string;
    storagePath?: string;
  }): Promise<void> {
    if (!this.collection) return;
    const findResult = (name: string) =>
      args.scannerResults.find((r) => r.name === name);

    const set: Partial<DocumentRow> = {
      tracking_status: args.tracking,
      doc_status: args.docStatus,
      scan_stage: 'done',
      progress_pct: 100,
      sandbox_classification: args.verdict,
      clamav_result: findResult('clamav')?.evidence?.[0],
      yara_matches: findResult('yara')?.evidence ?? [],
      suricata_alerts: findResult('suricata')?.evidence ?? [],
    };
    if (args.cuckooTaskId) set.cuckoo_task_id = args.cuckooTaskId;
    if (args.storagePath) set.storage_path = args.storagePath;
    await this.collection.updateOne({ document_id: args.documentId }, { $set: set });
  }
}
