import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { JetstreamMessageResult } from './jetstream.js';

export type IngestStatus = {
	started_at: string;
	updated_at: string;
	connected: boolean;
	seen: number;
	accepted: number;
	rejected: number;
	ignored: number;
	last_event?: {
		kind: JetstreamMessageResult['kind'];
		uri?: string;
		reason?: string;
		text?: string;
	};
};

export function default_status_path(): string {
	return fileURLToPath(
		new URL('../../../.data/ingest-status.json', import.meta.url),
	);
}

export function create_ingest_status_writer(
	path = process.env.BSKY_AI_FEED_STATUS_PATH ??
		default_status_path(),
) {
	const status: IngestStatus = {
		started_at: new Date().toISOString(),
		updated_at: new Date().toISOString(),
		connected: false,
		seen: 0,
		accepted: 0,
		rejected: 0,
		ignored: 0,
	};

	function write() {
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, `${JSON.stringify(status, null, 2)}\n`);
	}

	return {
		connected() {
			status.connected = true;
			status.updated_at = new Date().toISOString();
			write();
		},
		record(result: JetstreamMessageResult) {
			status.seen += 1;
			status.updated_at = new Date().toISOString();
			if (result.kind === 'ignored') status.ignored += 1;
			if (result.kind === 'accepted') status.accepted += 1;
			if (result.kind === 'rejected') status.rejected += 1;

			status.last_event = {
				kind: result.kind,
				uri: 'post' in result ? result.post.uri : undefined,
				reason:
					result.kind === 'rejected' ? result.reason : undefined,
				text:
					'post' in result && 'text' in result.post
						? result.post.text
						: undefined,
			};
			write();
		},
		closed() {
			status.connected = false;
			status.updated_at = new Date().toISOString();
			write();
		},
	};
}
