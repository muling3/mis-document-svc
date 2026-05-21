// Client-facing endpoints for the document-upload workflow.
//
//   POST /api/documents              — upload (multipart), returns 202 + document_id
//   GET  /api/documents/:id/status   — poll status + scan_stage + verdict
//   GET  /api/documents/:id          — metadata (download URL when STORED)
//
// Pre-flight checks per workflow doc §5: sniff filename → extension,
// SHA-256, known-bad blocklist. Quarantine write + insert document row,
// then hand off to the Sandbox Service; the rest of the flow runs
// through Kafka.

import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  NotFoundException,
  Param,
  Post,
  Req,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { createHash, randomUUID } from 'node:crypto';
import * as path from 'node:path';
import { BadHashBlocklist } from './bad-hash-blocklist.service';
import { MongoService } from './mongo.service';
import { QuarantineService } from './quarantine.service';
import { SandboxClient } from './sandbox-client.service';
import type { DocumentRow } from './types';

const SERVICE = 'mis-document-service';

interface UploadMetadata {
  parent_type?: string;
  parent_ref?: string;
  doc_type?: string;
  submitted_by?: string;
  notify_email?: string;
}

@Controller()
export class DocumentsController {
  private readonly log = new Logger(DocumentsController.name);

  constructor(
    private readonly mongo: MongoService,
    private readonly quarantine: QuarantineService,
    private readonly sandbox: SandboxClient,
    private readonly blocklist: BadHashBlocklist,
  ) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 50 * 1024 * 1024 } }))
  async upload(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() body: { metadata?: string | UploadMetadata },
    @Req() req: any,
  ) {
    if (!file) throw new BadRequestException('missing `file` field (multipart)');
    const metadata = parseMetadata(body?.metadata);

    const sha256 = createHash('sha256').update(file.buffer).digest('hex');
    if (this.blocklist.has(sha256)) {
      throw new ConflictException({
        error: 'known-bad-hash',
        sha256,
        message: 'this payload was previously flagged as malicious',
      });
    }

    const documentId = `doc_${randomUUID()}`;
    const correlationId =
      req.correlationId ?? req.headers?.['x-correlation-id'] ?? randomUUID();
    const extension = path.extname(file.originalname).replace(/^\./, '') || undefined;

    const storagePath = await this.quarantine.writeQuarantine(documentId, file.buffer);

    const row: DocumentRow = {
      document_id: documentId,
      parent_type: metadata.parent_type,
      parent_ref: metadata.parent_ref,
      doc_type: metadata.doc_type,
      original_filename: file.originalname,
      system_filename: documentId,
      file_extension: extension,
      file_size_bytes: file.size,
      sha256_hash: sha256,
      uploaded_at: new Date().toISOString(),
      uploaded_by: metadata.submitted_by,
      notify_email: metadata.notify_email,
      correlation_id: correlationId,
      tracking_status: 'PENDING_SCAN',
      scan_stage: undefined,
      progress_pct: 0,
      doc_status: 'QUARANTINED',
      storage_path: storagePath,
    };
    await this.mongo.insert(row);
    this.log.log(
      `document.submitted document_id=${documentId} sha256=${sha256.slice(0, 12)}…`,
    );

    // Hand off to Sandbox. Failure here is logged but not propagated —
    // the document row sits in PENDING_SCAN and a reaper (out of PoC
    // scope) would retry. We log loudly so the operator sees it.
    try {
      const accepted = await this.sandbox.submit({
        document_id: documentId,
        filename: file.originalname,
        content_type: file.mimetype,
        bytes: file.buffer,
        correlation_id: correlationId,
        submitted_by: metadata.submitted_by,
        parent_type: metadata.parent_type,
        parent_ref: metadata.parent_ref,
        notify_email: metadata.notify_email,
      });
      await this.mongo.attachSubmission(documentId, accepted.submission_id);
    } catch (err: any) {
      this.log.error(
        `sandbox submit failed doc=${documentId}: ${err?.message ?? err} — row stays PENDING_SCAN`,
      );
    }

    return {
      service: SERVICE,
      document_id: documentId,
      status_url: `/api/documents/${documentId}/status`,
      accepted_at: row.uploaded_at,
    };
  }

  @Get(':documentId/status')
  async status(@Param('documentId') documentId: string) {
    const row = await this.mongo.findById(documentId);
    if (!row) throw new NotFoundException(`unknown document_id=${documentId}`);
    return {
      service: SERVICE,
      document_id: documentId,
      tracking_status: row.tracking_status,
      doc_status: row.doc_status,
      scan_stage: row.scan_stage ?? null,
      progress_pct: row.progress_pct ?? 0,
      submission_id: row.submission_id,
      verdict:
        row.sandbox_classification && row.tracking_status !== 'SCANNING'
          ? {
              verdict: row.sandbox_classification,
              cuckoo_task_id: row.cuckoo_task_id,
              clamav_result: row.clamav_result,
              yara_matches: row.yara_matches ?? [],
              suricata_alerts: row.suricata_alerts ?? [],
            }
          : undefined,
    };
  }

  @Get(':documentId')
  async metadata(@Param('documentId') documentId: string) {
    const row = await this.mongo.findById(documentId);
    if (!row) throw new NotFoundException(`unknown document_id=${documentId}`);
    return {
      service: SERVICE,
      document_id: documentId,
      original_filename: row.original_filename,
      file_size_bytes: row.file_size_bytes,
      sha256_hash: row.sha256_hash,
      uploaded_at: row.uploaded_at,
      doc_status: row.doc_status,
      tracking_status: row.tracking_status,
      // PoC: storage_path is the relative FS path; production would
      // mint a signed S3 URL only when doc_status=ACTIVE.
      download_path: row.doc_status === 'ACTIVE' ? row.storage_path : undefined,
    };
  }
}

function parseMetadata(raw: unknown): UploadMetadata {
  if (!raw) return {};
  if (typeof raw === 'object') return raw as UploadMetadata;
  try {
    return JSON.parse(String(raw));
  } catch {
    throw new BadRequestException('metadata must be valid JSON');
  }
}
