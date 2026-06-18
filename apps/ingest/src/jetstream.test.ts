import { describe, expect, it } from 'vitest';
import {
	candidate_post_from_jetstream_event,
	process_jetstream_message,
} from './jetstream.js';

const post_event = {
	kind: 'commit',
	did: 'did:plc:example',
	time_us: 1_767_225_600_000_000,
	commit: {
		operation: 'create',
		collection: 'app.bsky.feed.post',
		rkey: 'abc123',
		cid: 'bafyexample',
		record: {
			text: 'OpenAI released a new model today',
			langs: ['en'],
		},
	},
};

describe('candidate_post_from_jetstream_event', () => {
	it('converts Jetstream post creates into candidate posts', () => {
		expect(candidate_post_from_jetstream_event(post_event)).toEqual({
			uri: 'at://did:plc:example/app.bsky.feed.post/abc123',
			cid: 'bafyexample',
			text: 'OpenAI released a new model today',
			lang: 'en',
			indexed_at: '2026-01-01T00:00:00.000Z',
		});
	});

	it('ignores non-post events', () => {
		expect(
			candidate_post_from_jetstream_event({
				...post_event,
				commit: {
					...post_event.commit,
					collection: 'app.bsky.feed.like',
				},
			}),
		).toBeUndefined();
	});
});

describe('process_jetstream_message', () => {
	it('accepts keyword hits in ingest mode', async () => {
		const written_posts: unknown[] = [];
		await expect(
			process_jetstream_message(JSON.stringify(post_event), {
				mode: 'ingest',
				store: {
					async put_posts(posts) {
						written_posts.push(...posts);
					},
					async get_feed_page() {
						return { posts: [] };
					},
					async delete_older_than() {
						return 0;
					},
				},
			}),
		).resolves.toMatchObject({ kind: 'accepted' });
		expect(written_posts).toHaveLength(1);
	});
});
