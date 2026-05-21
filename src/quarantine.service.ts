// Local-FS implementation of the three storage tiers (workflow doc §2):
//   var/quarantine/  — PENDING_SCAN / SCANNING blobs
//   var/canonical/   — STORED (envelope-encrypted in prod; plaintext in PoC)
//   var/forensics/   — REJECTED_MALICIOUS, legal hold
//
// Production swaps this for an S3 client with three buckets and distinct
// IAM policies. The interface stays the same.

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { loadConfig } from './config';

@Injectable()
export class QuarantineService implements OnModuleInit {
  private readonly log = new Logger(QuarantineService.name);
  private readonly config = loadConfig();

  async onModuleInit(): Promise<void> {
    for (const dir of [
      this.config.storage.quarantineDir,
      this.config.storage.canonicalDir,
      this.config.storage.forensicsDir,
    ]) {
      await fs.mkdir(dir, { recursive: true });
    }
    this.log.log(
      `storage ready — q=${this.config.storage.quarantineDir} canonical=${this.config.storage.canonicalDir} forensics=${this.config.storage.forensicsDir}`,
    );
  }

  // Returns the relative path stored on the document row.
  async writeQuarantine(documentId: string, bytes: Buffer): Promise<string> {
    const dest = path.join(this.config.storage.quarantineDir, documentId);
    await fs.writeFile(dest, bytes);
    return path.relative(process.cwd(), dest);
  }

  async readQuarantine(documentId: string): Promise<Buffer> {
    return fs.readFile(path.join(this.config.storage.quarantineDir, documentId));
  }

  async promoteToCanonical(documentId: string): Promise<string> {
    const src = path.join(this.config.storage.quarantineDir, documentId);
    const dest = path.join(this.config.storage.canonicalDir, documentId);
    // PoC: rename (atomic when same FS). Production: read, envelope-
    // encrypt with Vault Transit DEK, write to canonical bucket, delete
    // quarantine object. The doc-svc DOES NOT envelope-encrypt in PoC.
    await fs.rename(src, dest);
    return path.relative(process.cwd(), dest);
  }

  async quarantineToForensics(documentId: string): Promise<string> {
    const src = path.join(this.config.storage.quarantineDir, documentId);
    const dest = path.join(this.config.storage.forensicsDir, documentId);
    await fs.rename(src, dest);
    return path.relative(process.cwd(), dest);
  }
}
