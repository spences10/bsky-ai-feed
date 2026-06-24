import type { CandidatePost } from '@bsky-ai-feed/core';
import type {
	Judge,
	JudgeBatch,
	JudgeCategory,
	JudgeDecision,
} from './index.js';

export type OpenAiJudgeOptions = {
	api_key?: string;
	model?: string;
	fetch?: typeof fetch;
	max_retries?: number;
	retry_delay_ms?: number;
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
	score?: unknown;
	category?: unknown;
	reason?: unknown;
};

const judge_categories = new Set<JudgeCategory>([
	'model-research',
	'developer-tooling',
	'product-industry',
	'policy-safety',
	'infrastructure',
	'low-signal',
	'spam',
	'off-topic',
]);

export function create_openai_judge(
	options: OpenAiJudgeOptions = {},
): Judge {
	const api_key = options.api_key ?? process.env.AI_API_KEY;
	const model =
		options.model ?? process.env.AI_JUDGE_MODEL ?? 'gpt-5.4-nano';
	const fetch_impl = options.fetch ?? fetch;
	const max_retries = options.max_retries ?? 2;
	const retry_delay_ms = options.retry_delay_ms ?? 1000;

	if (!api_key) {
		throw new Error('AI_API_KEY is required for OpenAI judging');
	}

	return {
		async judge_batch(batch) {
			if (batch.posts.length === 0) return [];

			try {
				const response = await fetch_with_retries(
					fetch_impl,
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
														'score',
														'category',
														'reason',
													],
													properties: {
														uri: { type: 'string' },
														accept: { type: 'boolean' },
														confidence: {
															type: 'number',
														},
														score: { type: 'number' },
														category: {
															type: 'string',
															enum: [...judge_categories],
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
					max_retries,
					retry_delay_ms,
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
			} catch (error) {
				console.warn(
					`OpenAI judge unavailable: ${error_message(error)}`,
				);
				return unavailable_decisions(
					batch.posts,
					error_message(error),
				);
			}
		},
	};
}

async function fetch_with_retries(
	fetch_impl: typeof fetch,
	url: string,
	init: RequestInit,
	max_retries: number,
	retry_delay_ms: number,
): Promise<Response> {
	let last_error: unknown;
	for (let attempt = 0; attempt <= max_retries; attempt += 1) {
		try {
			const response = await fetch_impl(url, init);
			if (response.ok || !is_retryable_status(response.status)) {
				return response;
			}
			last_error = new Error(
				`OpenAI judge request failed: ${response.status}`,
			);
		} catch (error) {
			last_error = error;
		}
		if (attempt < max_retries)
			await sleep(retry_delay_ms * (attempt + 1));
	}
	throw last_error instanceof Error
		? last_error
		: new Error(String(last_error));
}

function is_retryable_status(status: number): boolean {
	return status === 408 || status === 429 || status >= 500;
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function unavailable_decisions(
	posts: CandidatePost[],
	message: string,
): JudgeDecision[] {
	return posts.map((post) => ({
		uri: post.uri,
		is_ai_technology: false,
		confidence: 0,
		score: 0,
		category: 'off-topic',
		reason: `judge unavailable: ${message}`,
	}));
}

function error_message(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function build_prompt(batch: JudgeBatch): string {
	return [
		batch.prompt,
		'Judge each post for both topicality and feed value.',
		'accept must be false for low-signal categories even when the post mentions AI.',
		'confidence is confidence in your decision. score is user value for this feed.',
		'Return JSON matching the requested schema.',
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
			confidence: number_or_zero(decision?.confidence),
			score: number_or_zero(decision?.score),
			category: parse_category(decision?.category),
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

function number_or_zero(value: unknown): number {
	return typeof value === 'number' && Number.isFinite(value)
		? value
		: 0;
}

function parse_category(value: unknown): JudgeCategory | undefined {
	return typeof value === 'string' &&
		judge_categories.has(value as JudgeCategory)
		? (value as JudgeCategory)
		: undefined;
}
