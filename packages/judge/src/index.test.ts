import { describe, expect, it } from 'vitest';
import {
	ai_technology_prompt,
	create_noop_judge,
	create_openai_judge,
} from './index.js';

describe('create_noop_judge', () => {
	it('returns rejecting decisions for every candidate', async () => {
		const judge = create_noop_judge();
		await expect(
			judge.judge_batch({
				prompt: ai_technology_prompt,
				posts: [
					{
						uri: 'at://did:example/app.bsky.feed.post/1',
						cid: 'bafyexample',
						text: 'Claude released a new model',
					},
				],
			}),
		).resolves.toEqual([
			{
				uri: 'at://did:example/app.bsky.feed.post/1',
				is_ai_technology: false,
				confidence: 0,
				score: 0,
				category: 'off-topic',
				reason: 'noop judge is not configured',
			},
		]);
	});
});

describe('create_openai_judge', () => {
	it('requests scored quality judgements and parses them', async () => {
		const requests: unknown[] = [];
		const judge = create_openai_judge({
			api_key: 'test-key',
			model: 'test-model',
			fetch: async (_url, init) => {
				const body = typeof init?.body === 'string' ? init.body : '';
				requests.push(JSON.parse(body) as unknown);
				return new Response(
					JSON.stringify({
						output_text: JSON.stringify({
							decisions: [
								{
									uri: 'at://did:example/app.bsky.feed.post/1',
									accept: true,
									confidence: 0.94,
									score: 0.82,
									category: 'model-research',
									reason: 'specific model news',
								},
							],
						}),
					}),
					{ status: 200 },
				);
			},
		});

		await expect(
			judge.judge_batch({
				prompt: ai_technology_prompt,
				posts: [
					{
						uri: 'at://did:example/app.bsky.feed.post/1',
						cid: 'bafyexample',
						text: 'OpenAI released a new model today',
					},
				],
			}),
		).resolves.toEqual([
			{
				uri: 'at://did:example/app.bsky.feed.post/1',
				is_ai_technology: true,
				confidence: 0.94,
				score: 0.82,
				category: 'model-research',
				reason: 'specific model news',
			},
		]);

		expect(requests).toMatchObject([
			{
				model: 'test-model',
				text: {
					format: {
						schema: {
							properties: {
								decisions: {
									items: {
										required: expect.arrayContaining([
											'score',
											'category',
										]),
									},
								},
							},
						},
					},
				},
			},
		]);
	});
});
