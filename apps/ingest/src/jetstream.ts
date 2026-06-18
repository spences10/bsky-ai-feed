import {
	filter_candidate_post,
	type CandidatePost,
	type FeedPost,
} from '@bsky-ai-feed/core';
import type { FeedStore } from '@bsky-ai-feed/store';

export type JetstreamRunMode = 'ingest';

export type JetstreamRunOptions = {
	mode: JetstreamRunMode;
	host?: string;
	store?: FeedStore;
	max_events?: number;
	seen_text?: Set<string>;
	log?: (message: string) => void;
};

type JetstreamCommitEvent = {
	did?: unknown;
	kind?: unknown;
	time_us?: unknown;
	commit?: {
		operation?: unknown;
		collection?: unknown;
		rkey?: unknown;
		cid?: unknown;
		record?: {
			text?: unknown;
			langs?: unknown;
			reply?: {
				root?: {
					uri?: unknown;
				};
			};
		};
	};
};

export type JetstreamMessageResult =
	| {
			kind: 'ignored';
	  }
	| {
			kind: 'candidate';
			post: CandidatePost;
	  }
	| {
			kind: 'accepted';
			post: FeedPost;
	  }
	| {
			kind: 'rejected';
			post: CandidatePost;
			reason: string;
	  };

export function create_jetstream_url(
	host = 'jetstream2.us-east.bsky.network',
): string {
	const url = new URL(`wss://${host}/subscribe`);
	url.searchParams.set('wantedCollections', 'app.bsky.feed.post');
	return url.toString();
}

export function candidate_post_from_jetstream_event(
	event: unknown,
): CandidatePost | undefined {
	if (!is_record(event)) return undefined;
	const jetstream_event = event as JetstreamCommitEvent;
	const commit = jetstream_event.commit;
	const record = commit?.record;

	if (jetstream_event.kind !== 'commit') return undefined;
	if (commit?.operation !== 'create') return undefined;
	if (commit.collection !== 'app.bsky.feed.post') return undefined;
	if (typeof jetstream_event.did !== 'string') return undefined;
	if (typeof commit.rkey !== 'string') return undefined;
	if (typeof commit.cid !== 'string') return undefined;
	if (typeof record?.text !== 'string') return undefined;

	const post: CandidatePost = {
		uri: `at://${jetstream_event.did}/app.bsky.feed.post/${commit.rkey}`,
		cid: commit.cid,
		text: record.text,
	};
	const lang = first_string(record.langs);
	const reply_root_uri = root_reply_uri(record.reply);
	const indexed_at = indexed_at_from_time_us(jetstream_event.time_us);
	if (lang) post.lang = lang;
	if (reply_root_uri) post.reply_root_uri = reply_root_uri;
	if (indexed_at) post.indexed_at = indexed_at;
	return post;
}

export async function process_jetstream_message(
	message: string,
	options: Pick<JetstreamRunOptions, 'mode' | 'store' | 'seen_text'>,
): Promise<JetstreamMessageResult> {
	const event = JSON.parse(message) as unknown;
	const post = candidate_post_from_jetstream_event(event);
	if (!post) return { kind: 'ignored' };
	const filter_result = filter_candidate_post(post, {
		seen_text: options.seen_text,
	});
	if (!filter_result.accepted) {
		return {
			kind: 'rejected',
			post,
			reason: filter_result.reason,
		};
	}

	const accepted_post = {
		uri: post.uri,
		cid: post.cid,
		accepted_at: new Date().toISOString(),
		indexed_at: post.indexed_at,
	} satisfies FeedPost;
	await options.store?.put_posts([accepted_post]);
	return { kind: 'accepted', post: accepted_post };
}

export async function run_jetstream(
	options: JetstreamRunOptions,
): Promise<void> {
	const log = options.log ?? console.log;
	const seen_text = options.seen_text ?? new Set<string>();
	const url = create_jetstream_url(options.host);
	const socket = new WebSocket(url);
	let processed_events = 0;

	await new Promise<void>((resolve, reject) => {
		socket.addEventListener('open', () => {
			log(`connected ${url}`);
		});

		socket.addEventListener('message', (event) => {
			void (async () => {
				const result = await process_jetstream_message(
					await message_data_to_string(event.data),
					{ ...options, seen_text },
				);
				if (result.kind === 'ignored') return;

				processed_events += 1;
				log(format_result(result));

				if (
					options.max_events &&
					processed_events >= options.max_events
				) {
					socket.close();
				}
			})().catch((error: unknown) => {
				socket.close();
				reject(error);
			});
		});

		socket.addEventListener('error', () => {
			reject(new Error('Jetstream websocket error'));
		});

		socket.addEventListener('close', () => {
			resolve();
		});
	});
}

async function message_data_to_string(
	data: unknown,
): Promise<string> {
	if (typeof data === 'string') return data;
	if (data instanceof ArrayBuffer)
		return Buffer.from(data).toString();
	if (ArrayBuffer.isView(data)) {
		return Buffer.from(data.buffer).toString();
	}
	if (data instanceof Blob) return data.text();
	return String(data);
}

function format_result(result: JetstreamMessageResult): string {
	if (result.kind === 'candidate') {
		return `candidate ${result.post.uri} ${preview_text(result.post.text)}`;
	}
	if (result.kind === 'accepted') {
		return `accepted ${result.post.uri}`;
	}
	if (result.kind === 'rejected') {
		return `rejected ${result.reason} ${result.post.uri}`;
	}
	return 'ignored';
}

function preview_text(text: string): string {
	return text.replace(/\s+/gu, ' ').trim().slice(0, 120);
}

function indexed_at_from_time_us(
	time_us: unknown,
): string | undefined {
	if (typeof time_us !== 'number') return undefined;
	return new Date(Math.trunc(time_us / 1000)).toISOString();
}

function root_reply_uri(reply: unknown): string | undefined {
	if (!is_record(reply)) return undefined;
	const root = reply.root;
	if (!is_record(root)) return undefined;
	return typeof root.uri === 'string' ? root.uri : undefined;
}

function first_string(value: unknown): string | undefined {
	if (!Array.isArray(value)) return undefined;
	return value.find(
		(item): item is string => typeof item === 'string',
	);
}

function is_record(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}
