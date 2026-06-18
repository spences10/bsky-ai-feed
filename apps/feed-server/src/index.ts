#!/usr/bin/env node
import type { FeedPost } from '@bsky-ai-feed/core';
import {
	create_memory_feed_store,
	create_sqlite_feed_store,
	type CandidateDecision,
	type FeedStore,
} from '@bsky-ai-feed/store';
import {
	createServer,
	type IncomingMessage,
	type ServerResponse,
} from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { load_dotenv } from './env.js';

export type SkeletonFeedPost = {
	post: string;
};

export type FeedSkeletonResponse = {
	feed: SkeletonFeedPost[];
	cursor?: string;
};

export type FeedServerOptions = {
	store?: FeedStore;
	port?: number;
	did?: string;
	feed_uri?: string;
	database_path?: string;
	use_memory_store?: boolean;
};

export type ServiceStatusResponse = {
	service: string;
	status: 'ok';
	did: string;
	endpoints: {
		health: string;
		did: string;
		describe_feed_generator: string;
		feed_skeleton: string;
		ingest_api: string;
	};
};

export type HealthResponse = {
	status: 'ok';
	service: string;
};

export type LocalStatusResponse = ServiceStatusResponse & {
	ingest: unknown;
	feed: FeedSkeletonResponse;
};

export async function create_feed_skeleton_body(
	store: FeedStore,
	cursor: string | undefined,
	limit = 50,
): Promise<FeedSkeletonResponse> {
	const page = await store.get_feed_page({
		before: cursor,
		limit: clamp_feed_limit(limit),
	});
	return {
		feed: page.posts.map((post) => ({ post: post.uri })),
		cursor: page.cursor,
	};
}

export function create_health_body(): HealthResponse {
	return {
		status: 'ok',
		service: 'bsky-ai-feed',
	};
}

export function create_service_status_body(
	did: string,
): ServiceStatusResponse {
	return {
		service: 'bsky-ai-feed',
		status: 'ok',
		did,
		endpoints: {
			health: '/health',
			did: '/.well-known/did.json',
			describe_feed_generator:
				'/xrpc/app.bsky.feed.describeFeedGenerator',
			feed_skeleton: '/xrpc/app.bsky.feed.getFeedSkeleton?feed=test',
			ingest_api: '/api/ingest',
		},
	};
}

export async function create_local_status_body(
	store: FeedStore,
	did: string,
): Promise<LocalStatusResponse> {
	return {
		...create_service_status_body(did),
		ingest: read_ingest_status(),
		feed: await create_feed_skeleton_body(store, undefined, 25),
	};
}

export function create_request_handler(
	store: FeedStore,
	did = process.env.FEEDGEN_DID ?? 'did:web:localhost',
	feed_uri = process.env.BSKY_FEED_URI ??
		'at://did:example:publisher/app.bsky.feed.generator/ai-feed',
) {
	return async function handle_request(
		request: IncomingMessage,
		response: ServerResponse,
	) {
		const request_url = new URL(
			request.url ?? '/',
			'http://localhost',
		);

		if (request_url.pathname === '/') {
			write_json(
				response,
				await create_local_status_body(store, did),
			);
			return;
		}

		if (request_url.pathname === '/health') {
			write_json(response, create_health_body());
			return;
		}

		if (request_url.pathname === '/api/ingest') {
			await handle_ingest_api(request, response, store);
			return;
		}

		if (request_url.pathname === '/.well-known/did.json') {
			write_json(response, {
				'@context': ['https://www.w3.org/ns/did/v1'],
				id: did,
				service: [
					{
						id: '#bsky_fg',
						type: 'BskyFeedGenerator',
						serviceEndpoint:
							process.env.FEEDGEN_SERVICE_URL ??
							'http://localhost:3000',
					},
				],
			});
			return;
		}

		if (
			request_url.pathname ===
			'/xrpc/app.bsky.feed.describeFeedGenerator'
		) {
			write_json(response, {
				did,
				feeds: [{ uri: feed_uri }],
			});
			return;
		}

		if (
			request_url.pathname !== '/xrpc/app.bsky.feed.getFeedSkeleton'
		) {
			write_json(response, { error: 'not_found' }, 404);
			return;
		}

		const body = await create_feed_skeleton_body(
			store,
			request_url.searchParams.get('cursor') ?? undefined,
			Number(request_url.searchParams.get('limit') ?? 50),
		);
		write_json(response, body);
	};
}

export function create_default_feed_store(
	options: FeedServerOptions = {},
): FeedStore {
	if (options.store) return options.store;
	if (options.use_memory_store) return create_memory_feed_store();

	return create_sqlite_feed_store({
		path:
			options.database_path ??
			process.env.BSKY_AI_FEED_DB_PATH ??
			default_database_path(),
	});
}

export function start_feed_server(options: FeedServerOptions = {}) {
	const store = create_default_feed_store(options);
	const port = options.port ?? Number(process.env.PORT ?? 3000);
	const server = createServer(
		create_request_handler(store, options.did, options.feed_uri),
	);
	server.on('close', () => store.close?.());
	server.listen(port, () => {
		console.log(`Feed server listening on http://localhost:${port}`);
	});
	return server;
}

function default_database_path(): string {
	return fileURLToPath(
		new URL('../../../.data/feed.sqlite', import.meta.url),
	);
}

function default_status_path(): string {
	return fileURLToPath(
		new URL('../../../.data/ingest-status.json', import.meta.url),
	);
}

function read_ingest_status(): unknown {
	try {
		return JSON.parse(
			readFileSync(
				process.env.BSKY_AI_FEED_STATUS_PATH ?? default_status_path(),
				'utf8',
			),
		) as unknown;
	} catch {
		return {
			connected: false,
			message: 'ingest worker has not written status yet',
		};
	}
}

async function handle_ingest_api(
	request: IncomingMessage,
	response: ServerResponse,
	store: FeedStore,
): Promise<void> {
	if (request.method !== 'POST') {
		write_json(response, { error: 'method_not_allowed' }, 405);
		return;
	}
	if (!is_authorized(request)) {
		write_json(response, { error: 'unauthorized' }, 401);
		return;
	}

	let body: unknown;
	try {
		body = JSON.parse(await read_request_body(request)) as unknown;
	} catch {
		write_json(response, { error: 'invalid_json' }, 400);
		return;
	}
	if (!is_record(body) || typeof body.task !== 'string') {
		write_json(response, { error: 'invalid_task' }, 400);
		return;
	}

	try {
		const result = await run_ingest_task(store, body.task, body.data);
		write_json(response, result);
	} catch (error) {
		write_json(
			response,
			{
				error: 'task_failed',
				message: error instanceof Error ? error.message : 'unknown',
			},
			400,
		);
	}
}

async function run_ingest_task(
	store: FeedStore,
	task: string,
	data: unknown,
): Promise<unknown> {
	if (task === 'put_posts') {
		const posts = parse_posts(data);
		await store.put_posts(posts);
		return { ok: true, inserted: posts.length };
	}
	if (task === 'put_decisions') {
		if (!store.put_decisions)
			throw new Error('decisions unsupported');
		const decisions = parse_decisions(data);
		await store.put_decisions(decisions);
		return { ok: true, inserted: decisions.length };
	}
	if (task === 'review_decisions') {
		if (!store.get_recent_decisions) {
			throw new Error('review unsupported');
		}
		const options = is_record(data) ? data : {};
		return {
			ok: true,
			decisions: await store.get_recent_decisions({
				limit: clamp_feed_limit(Number(options.limit ?? 25)),
				accepted:
					typeof options.accepted === 'boolean'
						? options.accepted
						: undefined,
			}),
		};
	}
	if (task === 'delete_older_than') {
		if (!is_record(data) || typeof data.cutoff_iso !== 'string') {
			throw new Error('cutoff_iso is required');
		}
		return {
			ok: true,
			deleted: await store.delete_older_than(data.cutoff_iso),
		};
	}
	throw new Error('unknown task');
}

function parse_posts(data: unknown): FeedPost[] {
	const rows = parse_rows(data, 'posts');
	return rows.map((row) => {
		if (
			typeof row.uri !== 'string' ||
			typeof row.cid !== 'string' ||
			typeof row.accepted_at !== 'string'
		) {
			throw new Error('posts require uri, cid, accepted_at');
		}
		return strip_undefined({
			uri: row.uri,
			cid: row.cid,
			accepted_at: row.accepted_at,
			indexed_at: optional_string(row.indexed_at),
			score: optional_number(row.score),
			text: optional_string(row.text),
			matched_keywords: optional_string_array(row.matched_keywords),
			judge_confidence: optional_number(row.judge_confidence),
			judge_reason: optional_string(row.judge_reason),
			judge_category: optional_string(row.judge_category),
		});
	});
}

function parse_decisions(data: unknown): CandidateDecision[] {
	const rows = parse_rows(data, 'decisions');
	return rows.map((row) => {
		if (
			typeof row.uri !== 'string' ||
			typeof row.cid !== 'string' ||
			typeof row.text !== 'string' ||
			typeof row.judged_at !== 'string' ||
			typeof row.accepted !== 'boolean' ||
			typeof row.confidence !== 'number'
		) {
			throw new Error(
				'decisions require uri, cid, text, judged_at, accepted, confidence',
			);
		}
		return strip_undefined({
			uri: row.uri,
			cid: row.cid,
			text: row.text,
			indexed_at: optional_string(row.indexed_at),
			judged_at: row.judged_at,
			accepted: row.accepted,
			confidence: row.confidence,
			score: optional_number(row.score),
			category: optional_string(row.category),
			reason: optional_string(row.reason),
			matched_keywords: optional_string_array(row.matched_keywords),
		});
	});
}

function parse_rows(
	data: unknown,
	key: 'posts' | 'decisions',
): Record<string, unknown>[] {
	if (!is_record(data) || !Array.isArray(data[key])) {
		throw new Error(`${key} array is required`);
	}
	if (!data[key].every(is_record)) {
		throw new Error(`${key} must contain objects`);
	}
	return data[key];
}

function is_authorized(request: IncomingMessage): boolean {
	const configured_token = process.env.INGEST_TOKEN;
	if (!configured_token) return false;
	const header = request.headers.authorization;
	const token = header?.startsWith('Bearer ')
		? header.slice('Bearer '.length)
		: undefined;
	if (!token) return false;
	const left = Buffer.from(token);
	const right = Buffer.from(configured_token);
	return left.length === right.length && timingSafeEqual(left, right);
}

function read_request_body(
	request: IncomingMessage,
): Promise<string> {
	return new Promise((resolve, reject) => {
		let body = '';
		request.setEncoding('utf8');
		request.on('data', (chunk: string) => {
			body += chunk;
			if (body.length > 1_000_000) {
				reject(new Error('request body too large'));
				request.destroy();
			}
		});
		request.on('end', () => resolve(body));
		request.on('error', reject);
	});
}

function optional_string(value: unknown): string | undefined {
	return typeof value === 'string' ? value : undefined;
}

function optional_number(value: unknown): number | undefined {
	return typeof value === 'number' && Number.isFinite(value)
		? value
		: undefined;
}

function optional_string_array(value: unknown): string[] | undefined {
	return Array.isArray(value) &&
		value.every((item) => typeof item === 'string')
		? value
		: undefined;
}

function strip_undefined<T extends Record<string, unknown>>(
	value: T,
): T {
	return Object.fromEntries(
		Object.entries(value).filter(([, entry]) => entry !== undefined),
	) as T;
}

function is_record(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

function clamp_feed_limit(limit: number): number {
	if (!Number.isFinite(limit)) return 50;
	return Math.min(Math.max(Math.trunc(limit), 1), 100);
}

function write_json(
	response: ServerResponse,
	body: unknown,
	status_code = 200,
) {
	response.writeHead(status_code, {
		'content-type': 'application/json; charset=utf-8',
	});
	response.end(JSON.stringify(body));
}

if (import.meta.url === `file://${process.argv[1]}`) {
	load_dotenv();
	start_feed_server();
}
