// Thin Kafka producer wrapper — publishes mis.notifications and mis.audit
// from the verdict consumer. Tolerant of an unreachable broker so the
// service still boots without infra.

import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Kafka, Producer } from 'kafkajs';
import { loadConfig } from './config';
import type { AuditEvent, NotificationEvent } from './types';

@Injectable()
export class KafkaProducerService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(KafkaProducerService.name);
  private readonly config = loadConfig();
  private producer?: Producer;

  async onModuleInit(): Promise<void> {
    if (this.config.kafka.brokers.length === 0) {
      this.log.warn('KAFKA_BROKERS unset — notifications/audit dropped (PoC mode)');
      return;
    }
    const kafka = new Kafka({
      clientId: this.config.kafka.clientId,
      brokers: this.config.kafka.brokers,
    });
    this.producer = kafka.producer({ idempotent: true, allowAutoTopicCreation: false });
    try {
      await this.producer.connect();
      this.log.log(`kafka producer connected`);
    } catch (err: any) {
      this.log.error(`kafka connect failed: ${err?.message ?? err}`);
      this.producer = undefined;
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.producer) await this.producer.disconnect().catch(() => undefined);
  }

  async publishNotification(event: NotificationEvent): Promise<void> {
    await this.publish(this.config.topics.notifications, event.recipient_id, event);
  }

  async publishAudit(event: AuditEvent): Promise<void> {
    await this.publish(this.config.topics.audit, event.resource.id, event);
  }

  private async publish(topic: string, key: string, value: unknown): Promise<void> {
    if (!this.producer) {
      this.log.debug(`[drop] ${topic} key=${key}`);
      return;
    }
    try {
      await this.producer.send({
        topic,
        messages: [{ key, value: JSON.stringify(value) }],
      });
    } catch (err: any) {
      this.log.error(`kafka publish ${topic} failed: ${err?.message ?? err}`);
    }
  }
}
