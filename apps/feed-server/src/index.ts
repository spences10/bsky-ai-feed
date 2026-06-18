#!/usr/bin/env node
import {
	create_memory_feed_store,
	type FeedStore,
} from '@bsky-ai-feed/store';
import {
	createServer,
	type IncomingMessage,
	type ServerResponse,
} from 'node:http';

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
};

export async function create_feed_skeleton_body(
	store: FeedStore,
	cursor: string | undefined,
	limit = 50,
): Promise<FeedSkeletonResponse> {
	const page = await store.get_feed_page({ before: cursor, limit });
	return {
		feed: page.posts.map((post) => ({ post: post.uri })),
		cursor: page.cursor,
	};
}

export function create_request_handler(store: FeedStore) {
	return async function handle_request(
		request: IncomingMessage,
		response: ServerResponse,
	) {
		const request_url = new URL(
			request.url ?? '/',
			'http://localhost',
		);

		if (request_url.pathname === '/.well-known/did.json') {
			write_json(response, {
				'@context': ['https://www.w3.org/ns/did/v1'],
				id: 'did:web:localhost',
				service: [],
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

export function start_feed_server(options: FeedServerOptions = {}) {
	const store = options.store ?? create_memory_feed_store();
	const port = options.port ?? Number(process.env.PORT ?? 3000);
	const server = createServer(create_request_handler(store));
	server.listen(port, () => {
		console.log(`Feed server listening on http://localhost:${port}`);
	});
	return server;
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
	start_feed_server();
}
