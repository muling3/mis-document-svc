// Typed env loader. Centralised so we don't sprinkle process.env reads.

import * as path from 'node:path';

export interface DocumentConfig {
  port: number;
  mongodb: { uri?: string; db: string; collection: string };
  kafka: { brokers: string[]; clientId: string; consumerGroup: string };
  sandbox: { url: string };
  storage: {
    quarantineDir: string;
    canonicalDir: string;
    forensicsDir: string;
  };
  topics: {
    scanProgress: string;
    verdict: string;
    notifications: string;
    audit: string;
  };
  security: { oncallEmail: string };
}

export function loadConfig(): DocumentConfig {
  const brokers = (process.env.KAFKA_BROKERS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  // PoC: local FS for the three storage tiers. Production points these
  // at S3 buckets with separate IAM policies (workflow doc §2).
  const storageRoot = process.env.STORAGE_ROOT ?? path.resolve(process.cwd(), 'var');

  return {
    port: Number(process.env.PORT) || 3007,
    mongodb: {
      uri: process.env.MONGODB_URI || undefined,
      db: process.env.MONGODB_DB || 'mis_document',
      collection: 'documents',
    },
    kafka: {
      brokers,
      clientId: 'mis-document-service',
      // Manual offset commit on the verdict topic — see workflow doc §7.
      // "consumer-group offset commit after promote/reject completes."
      consumerGroup: 'document.documents-verdict',
    },
    sandbox: {
      url: process.env.SANDBOX_SERVICE_URL ?? 'http://localhost:3004',
    },
    storage: {
      quarantineDir: path.join(storageRoot, 'quarantine'),
      canonicalDir: path.join(storageRoot, 'canonical'),
      forensicsDir: path.join(storageRoot, 'forensics'),
    },
    topics: {
      scanProgress: 'mis.documents.scan-progress',
      verdict: 'mis.documents.verdict',
      notifications: 'mis.notifications',
      audit: 'mis.audit',
    },
    security: {
      oncallEmail: process.env.SECURITY_ONCALL_EMAIL ?? 'security-oncall@mis.local',
    },
  };
}
