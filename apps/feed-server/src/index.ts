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
		status_api: string;
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
			status_api: '/api/status',
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

export async function create_landing_page_body(
	store: FeedStore,
	did: string,
	feed_uri: string,
): Promise<string> {
	const ingest = read_ingest_status();
	const page = await store.get_feed_page({
		before: undefined,
		limit: 8,
	});
	const feed_url =
		process.env.BSKY_FEED_PUBLIC_URL ??
		'https://bsky.app/profile/scottspence.dev/feed/ai-feed';
	const connected = status_boolean(ingest, 'connected');
	const accepted = status_number(ingest, 'accepted');
	const rejected = status_number(ingest, 'rejected');
	const seen = status_number(ingest, 'seen');
	const updated_at = status_string(ingest, 'updated_at');
	return render_landing_page({
		did,
		feed_uri,
		feed_url,
		connected,
		accepted,
		rejected,
		seen,
		updated_at,
		posts: page.posts,
	});
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
			write_html(
				response,
				await create_landing_page_body(store, did, feed_uri),
			);
			return;
		}

		if (request_url.pathname === '/api/status') {
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

type LandingPageView = {
	did: string;
	feed_uri: string;
	feed_url: string;
	connected: boolean;
	accepted: number;
	rejected: number;
	seen: number;
	updated_at?: string;
	posts: FeedPost[];
};

function render_landing_page(view: LandingPageView): string {
	const post_items = view.posts.length
		? view.posts.map(render_post_item).join('')
		: '<li class="empty">No accepted posts yet. The judge is warming up.</li>';
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>AI Tech Feed</title>
<meta name="description" content="A high-signal Bluesky feed for AI technology posts." />
<style>
:root{color-scheme:dark;--bg:#070912;--ink:#f3f7ff;--muted:#9aa9c7;--line:rgba(180,210,255,.18);--blue:#79d8ff;--violet:#8b5cf6;--lime:#b7ff7a;--card:rgba(13,22,40,.78)}
*{box-sizing:border-box}body{margin:0;min-height:100vh;background:radial-gradient(circle at 18% 12%,#1b7dff 0 16rem,transparent 30rem),radial-gradient(circle at 88% 28%,rgba(139,92,246,.55),transparent 24rem),linear-gradient(135deg,#08111f,#060812 62%,#03040a);color:var(--ink);font:16px/1.5 ui-sans-serif,system-ui,-apple-system,Segoe UI,sans-serif;overflow-x:hidden}body:before{content:"";position:fixed;inset:0;background:linear-gradient(rgba(255,255,255,.035) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.03) 1px,transparent 1px);background-size:44px 44px;mask-image:radial-gradient(circle at 50% 18%,#000,transparent 70%);pointer-events:none}.wrap{width:min(1120px,calc(100% - 32px));margin:0 auto;padding:56px 0 42px}.hero{display:grid;grid-template-columns:1.05fr .95fr;gap:clamp(28px,5vw,76px);align-items:center;min-height:68vh}.eyebrow{display:inline-flex;gap:10px;align-items:center;color:var(--blue);font-size:13px;font-weight:800;letter-spacing:.18em;text-transform:uppercase}.dot{width:9px;height:9px;border-radius:50%;background:var(--lime);box-shadow:0 0 22px var(--lime)}h1{margin:18px 0 16px;font-size:clamp(48px,9vw,116px);line-height:.84;letter-spacing:-.085em}.lede{max-width:650px;color:#ccdaf6;font-size:clamp(18px,2.2vw,24px)}.actions{display:flex;flex-wrap:wrap;gap:14px;margin-top:30px}.button{border:1px solid var(--line);border-radius:999px;padding:12px 18px;color:var(--ink);text-decoration:none;font-weight:800;background:rgba(255,255,255,.08)}.button.primary{background:var(--ink);color:#07111f}.orb{position:relative;aspect-ratio:1;border-radius:34%;background:radial-gradient(circle at 34% 20%,#3fdcff,#194dff 34%,#111b34 66%,#050812);box-shadow:0 35px 120px rgba(30,140,255,.35);display:grid;place-items:center}.orb img{width:72%;filter:drop-shadow(0 22px 50px rgba(75,210,255,.35))}.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:18px 0 36px}.stat{background:var(--card);border:1px solid var(--line);padding:18px;border-radius:24px}.stat b{display:block;font-size:clamp(26px,4vw,44px);letter-spacing:-.05em}.stat span{color:var(--muted);font-size:13px;text-transform:uppercase;letter-spacing:.12em}.panel{display:grid;grid-template-columns:.85fr 1.15fr;gap:18px}.card{background:var(--card);border:1px solid var(--line);border-radius:32px;padding:24px;box-shadow:0 20px 80px rgba(0,0,0,.24)}h2{margin:0 0 14px;font-size:24px}.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:#bcd3ff;font-size:13px;overflow-wrap:anywhere}.live{display:inline-flex;align-items:center;gap:9px;color:${view.connected ? 'var(--lime)' : '#ffb86b'};font-weight:900}.posts{list-style:none;margin:0;padding:0;display:grid;gap:12px}.posts li{padding:16px;border-radius:20px;background:rgba(255,255,255,.055);border:1px solid rgba(255,255,255,.08)}.posts a{color:#eaf6ff;text-decoration:none}.posts small{display:block;margin-top:10px;color:var(--muted)}.empty{color:var(--muted)}footer{margin-top:42px;color:var(--muted);font-size:13px}@media (max-width:820px){.hero,.panel{grid-template-columns:1fr}.orb{max-width:420px}.stats{grid-template-columns:repeat(2,1fr)}h1{letter-spacing:-.06em}}
</style>
</head>
<body>
<main class="wrap">
<section class="hero">
<div>
<div class="eyebrow"><span class="dot"></span> ${view.connected ? 'Ingest online' : 'Ingest reconnecting'}</div>
<h1>AI signal, minus the sludge.</h1>
<p class="lede">A Bluesky custom feed that watches Jetstream, filters locally, asks an AI judge for a second opinion, and serves the sharpest AI technology posts.</p>
<div class="actions"><a class="button primary" href="${escape_html(view.feed_url)}">Open on Bluesky</a><a class="button" href="/xrpc/app.bsky.feed.getFeedSkeleton?feed=test&limit=10">View skeleton JSON</a><a class="button" href="/api/status">API status</a></div>
</div>
<div class="orb"><img alt="AI Tech Feed icon" src="${icon_data_uri()}" /></div>
</section>
<section class="stats" aria-label="Feed stats">
${render_stat('Seen', view.seen)}${render_stat('Accepted', view.accepted)}${render_stat('Rejected', view.rejected)}${render_stat('Live posts', view.posts.length)}
</section>
<section class="panel">
<div class="card"><h2>Generator</h2><p class="live"><span class="dot"></span>${view.connected ? 'Connected' : 'Disconnected'}</p><p class="mono">${escape_html(view.did)}</p><p class="mono">${escape_html(view.feed_uri)}</p><p class="mono">Updated ${escape_html(view.updated_at ?? 'pending')}</p></div>
<div class="card"><h2>Latest accepted</h2><ol class="posts">${post_items}</ol></div>
</section>
<footer>Built from Jetstream + SQLite + an intentionally picky judge.</footer>
</main>
</body>
</html>`;
}

function render_stat(label: string, value: number): string {
	return `<div class="stat"><b>${value.toLocaleString('en-US')}</b><span>${escape_html(label)}</span></div>`;
}

function render_post_item(post: FeedPost): string {
	const text = post.text?.trim() || post.uri;
	return `<li><a href="${escape_html(at_uri_to_bsky_url(post.uri))}">${escape_html(text)}</a><small>${escape_html(post.judge_category ?? 'accepted')} · score ${format_score(post.score)}</small></li>`;
}

function at_uri_to_bsky_url(uri: string): string {
	const match =
		/^at:\/\/([^/]+)\/app\.bsky\.feed\.post\/([^/]+)$/u.exec(uri);
	if (!match) return uri;
	return `https://bsky.app/profile/${match[1]}/post/${match[2]}`;
}

function format_score(score: number | undefined): string {
	return typeof score === 'number' ? score.toFixed(2) : 'n/a';
}

function status_number(value: unknown, key: string): number {
	if (!is_record(value)) return 0;
	const entry = value[key];
	return typeof entry === 'number' && Number.isFinite(entry)
		? entry
		: 0;
}

function status_boolean(value: unknown, key: string): boolean {
	return is_record(value) && value[key] === true;
}

function status_string(
	value: unknown,
	key: string,
): string | undefined {
	if (!is_record(value)) return undefined;
	const entry = value[key];
	return typeof entry === 'string' ? entry : undefined;
}

function icon_data_uri(): string {
	return 'data:image/svg+xml,%3Csvg width="512" height="512" viewBox="0 0 512 512" fill="none" xmlns="http://www.w3.org/2000/svg"%3E%3Crect width="512" height="512" rx="112" fill="%23070912"/%3E%3Ccircle cx="256" cy="256" r="170" fill="%231b7dff"/%3E%3Cpath d="M126 256C126 184 184 126 256 126C328 126 386 184 386 256C386 328 328 386 256 386" stroke="%2379d8ff" stroke-width="24" stroke-linecap="round"/%3E%3Cpath d="M256 156V356M169 306L256 156L343 306M207 257H305" stroke="%23f3f7ff" stroke-width="26" stroke-linecap="round" stroke-linejoin="round"/%3E%3Ccircle cx="256" cy="156" r="18" fill="%23fff"/%3E%3Ccircle cx="169" cy="306" r="18" fill="%23fff"/%3E%3Ccircle cx="343" cy="306" r="18" fill="%23fff"/%3E%3Cpath d="M392 112L404 142L434 154L404 166L392 196L380 166L350 154L380 142L392 112Z" fill="%23BFF7FF"/%3E%3C/svg%3E';
}

function escape_html(value: string): string {
	return value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&#39;');
}

function write_html(
	response: ServerResponse,
	body: string,
	status_code = 200,
) {
	response.writeHead(status_code, {
		'content-type': 'text/html; charset=utf-8',
	});
	response.end(body);
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
