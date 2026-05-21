// Known-bad SHA-256 blocklist. Hit on every upload pre-flight so a
// previously-rejected payload is short-circuited without re-running the
// scan pipeline (workflow doc §5).
//
// Production: Redis set `mis:document:bad-hashes` with 30 d TTL per entry,
// shared across all Document Service replicas. PoC: in-process Map, lost
// on restart — fine because the verdict consumer reinserts on every
// MALICIOUS verdict.

import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class BadHashBlocklist {
  private readonly log = new Logger(BadHashBlocklist.name);
  private readonly hashes = new Map<string, { addedAt: string; documentId: string }>();

  has(sha256: string): boolean {
    return this.hashes.has(sha256);
  }

  add(sha256: string, documentId: string): void {
    if (this.hashes.has(sha256)) return;
    this.hashes.set(sha256, { addedAt: new Date().toISOString(), documentId });
    this.log.warn(`blocklist.added sha256=${sha256.slice(0, 12)}… doc=${documentId}`);
  }
}
