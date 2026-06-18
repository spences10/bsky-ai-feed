import type { CandidatePost } from '@bsky-ai-feed/core';
import type { Judge, JudgeBatch, JudgeDecision } from './index.js';

export type OpenAiJudgeOptions = {
	api_key?: string;
	model?: string;
	fetch?: typeof fetch;
};

type OpenAiResponse = {
	output_text?: unknown;
	output?: Array<{
		content?: Array<{
			text?: unknown;
		}>;
	}>;
};

type ParsedDecision = {
	uri?: unknown;
	accept?: unknown;
	is_ai_technology?: unknown;
	confidence?: unknown;
	reason?: unknown;
};

export function create_openai_judge(
	options: OpenAiJudgeOptions = {},
): Judge {
	const api_key = options.api_key ?? process.env.AI_API_KEY;
	const model =
		options.model ?? process.env.AI_JUDGE_MODEL ?? 'gpt-5.4-nano';
	const fetch_impl = options.fetch ?? fetch;

	if (!api_key) {
		throw new Error('AI_API_KEY is required for OpenAI judging');
	}

	return {
		async judge_batch(batch) {
			if (batch.posts.length === 0) return [];
			const response = await fetch_impl(
				'https://api.openai.com/v1/responses',
				{
					method: 'POST',
					headers: {
						authorization: `Bearer ${api_key}`,
						'content-type': 'application/json',
					},
					body: JSON.stringify({
						model,
						input: build_prompt(batch),
						text: {
							format: {
								type: 'json_schema',
								name: 'ai_feed_judgements',
								schema: {
									type: 'object',
									additionalProperties: false,
									required: ['decisions'],
									properties: {
										decisions: {
											type: 'array',
											items: {
												type: 'object',
												additionalProperties: false,
												required: [
													'uri',
													'accept',
													'confidence',
													'reason',
												],
												properties: {
													uri: { type: 'string' },
													accept: { type: 'boolean' },
													confidence: {
														type: 'number',
													},
													reason: { type: 'string' },
												},
											},
										},
									},
								},
							},
						},
					}),
				},
			);

			if (!response.ok) {
				throw new Error(
					`OpenAI judge request failed: ${response.status}`,
				);
			}

			return parse_decisions(
				(await response.json()) as OpenAiResponse,
				batch.posts,
			);
		},
	};
}

function build_prompt(batch: JudgeBatch): string {
	return [
		batch.prompt,
		'Judge each post. Accept only if the post is materially about AI/ML/LLMs as technology.',
		'Return JSON matching the requested schema. Use confidence from 0 to 1.',
		JSON.stringify({
			posts: batch.posts.map((post) => ({
				uri: post.uri,
				text: post.text,
				lang: post.lang,
			})),
		}),
	].join('\n\n');
}

function parse_decisions(
	response: OpenAiResponse,
	posts: CandidatePost[],
): JudgeDecision[] {
	const text = response_text(response);
	const parsed = JSON.parse(text) as { decisions?: ParsedDecision[] };
	const decisions = new Map(
		(parsed.decisions ?? []).map((decision) => [
			String(decision.uri),
			decision,
		]),
	);

	return posts.map((post) => {
		const decision = decisions.get(post.uri);
		return {
			uri: post.uri,
			is_ai_technology:
				decision?.accept === true ||
				decision?.is_ai_technology === true,
			confidence:
				typeof decision?.confidence === 'number'
					? decision.confidence
					: 0,
			reason:
				typeof decision?.reason === 'string'
					? decision.reason
					: undefined,
		};
	});
}

function response_text(response: OpenAiResponse): string {
	if (typeof response.output_text === 'string')
		return response.output_text;
	const text = response.output
		?.flatMap((item) => item.content ?? [])
		.find((content) => typeof content.text === 'string')?.text;
	if (typeof text === 'string') return text;
	throw new Error(
		'OpenAI judge response did not include output text',
	);
}
