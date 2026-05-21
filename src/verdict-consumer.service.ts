// Consumes mis.documents.verdict — the workflow's terminal-action driver.
//
// Per workflow doc §8:
//   SAFE        → promote quarantine→canonical, tracking_status=STORED,
//                 doc_status=ACTIVE, notify submitter (success).
//   MALICIOUS   → blocklist SHA, quarantine→forensics, BLOCKED,
//                 sanitised email to submitter + URGENT alert to security
//                 on-call, SEV-1 audit event.
//   SUSPICIOUS  → QUARANTINED_FOR_REVIEW (Admin Service ticket — out of
//   / INCONCLUSIVE  scope for the PoC).
//
// Manual offset commit AFTER each terminal action completes (at-least-
// once delivery). A redelivery is safe because every step except the
// blob move is idempotent, and the FS move is wrapped in try/catch so a
// retry against an already-moved blob still records the audit event.

import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Consumer, Kafka } from 'kafkajs';
import { BadHashBlocklist } from './bad-hash-blocklist.service';
import { KafkaProducerService } from './kafka-producer.service';
import { MongoService } from './mongo.service';
import { QuarantineService } from './quarantine.service';
import { loadConfig } from './config';
import type {
  AuditEvent,
  DocStatus,
  NotificationEvent,
  TrackingStatus,
  Verdict,
  VerdictEvent,
} from './types';

@Injectable()
export class VerdictConsumer implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(VerdictConsumer.name);
  private readonly config = loadConfig();
  private consumer?: Consumer;

  constructor(
    private readonly mongo: MongoService,
    private readonly quarantine: QuarantineService,
    private readonly blocklist: BadHashBlocklist,
    private readonly producer: KafkaProducerService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (this.config.kafka.brokers.length === 0) {
      this.log.warn('KAFKA_BROKERS unset — verdict consumer disabled');
      return;
    }
    const kafka = new Kafka({
      clientId: this.config.kafka.clientId,
      brokers: this.config.kafka.brokers,
    });
    this.consumer = kafka.consumer({ groupId: this.config.kafka.consumerGroup });
    try {
      await this.consumer.connect();
      await this.consumer.subscribe({
        topic: this.config.topics.verdict,
        fromBeginning: false,
      });
      // autoCommit disabled — we commit manually after handle() succeeds.
      await this.consumer.run({
        autoCommit: false,
        eachMessage: async ({ topic, partition, message }) => {
          await this.handle(message.value);
          if (this.consumer && message.offset !== undefined) {
            await this.consumer.commitOffsets([
              {
                topic,
                partition,
                offset: (BigInt(message.offset) + 1n).toString(),
              },
            ]);
          }
        },
      });
      this.log.log(
        `subscribed to ${this.config.topics.verdict} group=${this.config.kafka.consumerGroup}`,
      );
    } catch (err: any) {
      this.log.error(`consumer init failed: ${err?.message ?? err}`);
      this.consumer = undefined;
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.consumer) await this.consumer.disconnect().catch(() => undefined);
  }

  private async handle(raw: Buffer | null): Promise<void> {
    if (!raw) return;
    let event: VerdictEvent;
    try {
      event = JSON.parse(raw.toString('utf8')) as VerdictEvent;
    } catch (err: any) {
      this.log.error(`bad verdict event: ${err?.message ?? err}`);
      return;
    }
    const row = await this.mongo.findById(event.document_id);
    if (!row) {
      // Could happen if the verdict arrives before the document row is
      // visible (eventual consistency). In a real deploy we'd retry; PoC
      // logs and drops.
      this.log.warn(`verdict for unknown document_id=${event.document_id}`);
      return;
    }

    this.log.log(
      `verdict.received doc=${event.document_id} verdict=${event.verdict} ` +
        `submission=${event.submission_id}`,
    );

    switch (event.verdict) {
      case 'SAFE':
        await this.onSafe(event);
        break;
      case 'MALICIOUS':
        await this.onMalicious(event, row.sha256_hash, row.notify_email, row.uploaded_by);
        break;
      case 'SUSPICIOUS':
      case 'INCONCLUSIVE':
        await this.onSuspicious(event);
        break;
    }
  }

  // ── SAFE ──────────────────────────────────────────────────────────
  private async onSafe(event: VerdictEvent): Promise<void> {
    // Production: Vault Transit datakey → AES-256-CBC → write to
    // canonical bucket. PoC: plain FS rename.
    let storagePath: string | undefined;
    try {
      storagePath = await this.quarantine.promoteToCanonical(event.document_id);
    } catch (err: any) {
      this.log.error(`promote failed doc=${event.document_id}: ${err?.message ?? err}`);
    }
    await this.applyVerdict(event, 'STORED', 'ACTIVE', storagePath);
    await this.emitAudit(event, 'document.promoted', 'INFO');
  }

  // ── MALICIOUS ─────────────────────────────────────────────────────
  private async onMalicious(
    event: VerdictEvent,
    sha256: string,
    notifyEmail: string | undefined,
    submitter: string | undefined,
  ): Promise<void> {
    this.blocklist.add(sha256, event.document_id);

    let storagePath: string | undefined;
    try {
      storagePath = await this.quarantine.quarantineToForensics(event.document_id);
    } catch (err: any) {
      // Already moved on a redelivery — fine.
      this.log.debug(`forensics move skipped doc=${event.document_id}: ${err?.message ?? err}`);
    }
    await this.applyVerdict(event, 'REJECTED_MALICIOUS', 'BLOCKED', storagePath);

    // Sanitised email to the submitter.
    if (notifyEmail) {
      const userNotification: NotificationEvent = {
        schema: 'mis.notifications.v1',
        correlation_id: event.correlation_id,
        channel: 'EMAIL',
        template_ref: 'document-rejected-malicious',
        recipient_id: submitter ?? notifyEmail,
        recipient_email: notifyEmail,
        payload: {
          document_id: event.document_id,
          submitted_at: event.verdict_at,
          support_contact: 'security@mis.local',
        },
        priority: 'HIGH',
      };
      await this.producer.publishNotification(userNotification);
    }

    // Full IOC detail to security on-call.
    const oncallNotification: NotificationEvent = {
      schema: 'mis.notifications.v1',
      correlation_id: event.correlation_id,
      channel: 'EMAIL',
      template_ref: 'document-rejected-malicious-internal',
      recipient_id: 'security-oncall',
      recipient_email: this.config.security.oncallEmail,
      payload: {
        document_id: event.document_id,
        cuckoo_task_id: event.cuckoo_task_id,
        scanner_results: event.scanner_results,
      },
      priority: 'URGENT',
    };
    await this.producer.publishNotification(oncallNotification);
    await this.emitAudit(event, 'document.rejected.malicious', 'SEV-1');
  }

  // ── SUSPICIOUS / INCONCLUSIVE ─────────────────────────────────────
  private async onSuspicious(event: VerdictEvent): Promise<void> {
    await this.applyVerdict(event, 'QUARANTINED_FOR_REVIEW', 'QUARANTINED', undefined);
    await this.emitAudit(event, 'document.quarantined.for_review', 'WARN');
  }

  private async applyVerdict(
    event: VerdictEvent,
    tracking: TrackingStatus,
    docStatus: DocStatus,
    storagePath: string | undefined,
  ): Promise<void> {
    await this.mongo.applyVerdict({
      documentId: event.document_id,
      tracking,
      docStatus,
      verdict: event.verdict as Verdict,
      scannerResults: event.scanner_results,
      cuckooTaskId: event.cuckoo_task_id,
      storagePath,
    });
  }

  private async emitAudit(
    event: VerdictEvent,
    action: string,
    severity: AuditEvent['severity'],
  ): Promise<void> {
    await this.producer.publishAudit({
      schema: 'mis.audit.v1',
      correlation_id: event.correlation_id,
      action,
      actor: 'mis-document-service',
      resource: { type: 'document', id: event.document_id },
      severity,
      metadata: { verdict: event.verdict, submission_id: event.submission_id },
      emitted_at: new Date().toISOString(),
    });
  }
}
