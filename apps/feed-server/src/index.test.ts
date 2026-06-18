import { create_memory_feed_store } from '@bsky-ai-feed/store';
import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import {
	create_feed_skeleton_body,
	create_health_body,
	create_request_handler,
	create_service_status_body,
} from './index.js';

const servers: Server[] = [];

afterEach(async () => {
	await Promise.all(
		servers.splice(0).map(
			(server) =>
				new Promise<void>((resolve, reject) => {
					server.close((error) => {
						if (error) reject(error);
						else resolve();
					});
				}),
		),
	);
});

describe('create_service_status_body', () => {
	it('returns a minimal public status payload', () => {
		expect(create_service_status_body('did:web:localhost')).toEqual({
			service: 'bsky-ai-feed',
			status: 'ok',
			did: 'did:web:localhost',
		});
	});
});

describe('create_health_body', () => {
	it('returns a small health payload for platform probes', () => {
		expect(create_health_body()).toEqual({
			status: 'ok',
			service: 'bsky-ai-feed',
		});
	});
});

describe('create_feed_skeleton_body', () => {
	it('serializes stored posts into getFeedSkeleton shape', async () => {
		const store = create_memory_feed_store([
			{
				uri: 'at://did:example/app.bsky.feed.post/1',
				cid: 'bafy1',
				accepted_at: '2026-01-01T00:00:00.000Z',
			},
		]);

		await expect(
			create_feed_skeleton_body(store, undefined, 50),
		).resolves.toEqual({
			feed: [{ post: 'at://did:example/app.bsky.feed.post/1' }],
			cursor: '2026-01-01T00:00:00.000Z::bafy1',
		});
	});
});

describe('create_request_handler', () => {
	const feed_uri =
		'at://did:example:publisher/app.bsky.feed.generator/ai-feed';

	it('rejects non-read methods on public endpoints', async () => {
		const response = await request(
			'/xrpc/app.bsky.feed.getFeedSkeleton',
			{
				method: 'POST',
			},
		);

		expect(response.status).toBe(405);
		expect(await response.json()).toEqual({
			error: 'method_not_allowed',
		});
	});

	it('rejects unknown feed identifiers', async () => {
		const response = await request(
			'/xrpc/app.bsky.feed.getFeedSkeleton?feed=bogus',
		);

		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({ error: 'unknown_feed' });
	});

	it('serves the configured feed with security headers', async () => {
		const response = await request(
			`/xrpc/app.bsky.feed.getFeedSkeleton?feed=${encodeURIComponent(feed_uri)}`,
		);

		expect(response.status).toBe(200);
		expect(response.headers.get('x-content-type-options')).toBe(
			'nosniff',
		);
		expect(response.headers.get('referrer-policy')).toBe(
			'no-referrer',
		);
		expect(await response.json()).toEqual({ feed: [] });
	});

	async function request(path: string, init?: RequestInit) {
		const store = create_memory_feed_store();
		const server = createServer(
			create_request_handler(store, 'did:web:localhost', feed_uri),
		);
		servers.push(server);
		await new Promise<void>((resolve) => server.listen(0, resolve));
		const address = server.address();
		if (!address || typeof address === 'string') {
			throw new Error('server address unavailable');
		}
		return fetch(`http://127.0.0.1:${address.port}${path}`, init);
	}
});
