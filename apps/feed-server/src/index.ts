#!/usr/bin/env node
import {
	create_memory_feed_store,
	create_sqlite_feed_store,
	type FeedStore,
} from '@bsky-ai-feed/store';
import {
	createServer,
	type IncomingMessage,
	type ServerResponse,
} from 'node:http';
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
		did: string;
		describe_feed_generator: string;
		feed_skeleton: string;
	};
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

export function create_service_status_body(
	did: string,
): ServiceStatusResponse {
	return {
		service: 'bsky-ai-feed',
		status: 'ok',
		did,
		endpoints: {
			did: '/.well-known/did.json',
			describe_feed_generator:
				'/xrpc/app.bsky.feed.describeFeedGenerator',
			feed_skeleton: '/xrpc/app.bsky.feed.getFeedSkeleton?feed=test',
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
