// Consumes mis.documents.scan-progress. Each message updates the
// scan_stage + progress_pct columns so the status endpoint reflects
// live progress (workflow doc §4, §6.4).
//
// Auto-commit (at-most-once). Losing a progress message only delays a
// UI tick — it never affects the verdict path.

import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Consumer, Kafka } from 'kafkajs';
import { loadConfig } from './config';
import { MongoService } from './mongo.service';
import type { ProgressEvent } from './types';

@Injectable()
export class ScanProgressConsumer implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(ScanProgressConsumer.name);
  private readonly config = loadConfig();
  private consumer?: Consumer;

  constructor(private readonly mongo: MongoService) {}

  async onModuleInit(): Promise<void> {
    if (this.config.kafka.brokers.length === 0) {
      this.log.warn('KAFKA_BROKERS unset — scan-progress consumer disabled');
      return;
    }
    const kafka = new Kafka({
      clientId: this.config.kafka.clientId,
      brokers: this.config.kafka.brokers,
    });
    // UX-only — auto-commit, no need to be strict.
    this.consumer = kafka.consumer({ groupId: 'document.scan-progress' });
    try {
      await this.consumer.connect();
      await this.consumer.subscribe({
        topic: this.config.topics.scanProgress,
        fromBeginning: false,
      });
      await this.consumer.run({
        eachMessage: async ({ message }) => {
          await this.handle(message.value);
        },
      });
      this.log.log(`subscribed to ${this.config.topics.scanProgress}`);
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
    let event: ProgressEvent;
    try {
      event = JSON.parse(raw.toString('utf8')) as ProgressEvent;
    } catch (err: any) {
      this.log.error(`bad progress event: ${err?.message ?? err}`);
      return;
    }
    this.log.debug(
      `progress.received doc=${event.document_id} stage=${event.stage} pct=${event.progress_pct}`,
    );
    await this.mongo.updateScanStage(
      event.document_id,
      event.stage,
      event.progress_pct,
      event.cuckoo_task_id,
    );
  }
}
