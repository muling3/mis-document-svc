// HTTP client to the Sandbox Service.
//
// Posts a multipart submission and returns the submission_id stamped by
// the Sandbox Service. In production this is gRPC SandboxService.SubmitFile
// (workflow doc §6, arch 03 §4.2); the PoC uses HTTP because document-svc
// is the only producer and the wire format isn't load-bearing.

import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { loadConfig } from './config';

interface SubmitArgs {
  document_id: string;
  filename: string;
  content_type?: string;
  bytes: Buffer;
  correlation_id?: string;
  submitted_by?: string;
  parent_type?: string;
  parent_ref?: string;
  notify_email?: string;
}

interface SandboxAcceptResponse {
  submission_id: string;
  sha256: string;
}

@Injectable()
export class SandboxClient {
  private readonly log = new Logger(SandboxClient.name);
  private readonly config = loadConfig();

  async submit(args: SubmitArgs): Promise<SandboxAcceptResponse> {
    const boundary = `----mis${randomUUID().replace(/-/g, '')}`;
    const metadata = {
      document_id: args.document_id,
      filename: args.filename,
      content_type: args.content_type,
      submitted_by: args.submitted_by,
      parent_type: args.parent_type,
      parent_ref: args.parent_ref,
      notify_email: args.notify_email,
    };
    const head = Buffer.from(
      `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="metadata"\r\n` +
        `Content-Type: application/json\r\n\r\n` +
        JSON.stringify(metadata) +
        `\r\n--${boundary}\r\n` +
        `Content-Disposition: form-data; name="file"; filename="${args.filename}"\r\n` +
        `Content-Type: ${args.content_type ?? 'application/octet-stream'}\r\n\r\n`,
    );
    const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
    const body = Buffer.concat([head, args.bytes, tail]);

    const url = `${this.config.sandbox.url}/api/sandbox/submissions`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'X-Correlation-ID': args.correlation_id ?? '',
      },
      body,
    });
    if (res.status !== 202) {
      const text = await res.text().catch(() => '');
      throw new Error(`sandbox submit failed: HTTP ${res.status} ${text.slice(0, 200)}`);
    }
    const data = (await res.json()) as SandboxAcceptResponse;
    this.log.debug(`sandbox accepted submission_id=${data.submission_id} doc=${args.document_id}`);
    return data;
  }
}
