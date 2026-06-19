import type { CandidatePost } from '@bsky-ai-feed/core';
import { create_openai_judge } from './openai.js';
export { create_openai_judge } from './openai.js';
export type { OpenAiJudgeOptions } from './openai.js';

export type JudgeCategory =
	| 'model-research'
	| 'developer-tooling'
	| 'product-industry'
	| 'policy-safety'
	| 'infrastructure'
	| 'low-signal'
	| 'spam'
	| 'off-topic';

export type JudgeDecision = {
	uri: string;
	is_ai_technology: boolean;
	confidence: number;
	score?: number;
	category?: JudgeCategory;
	reason?: string;
};

export type JudgeBatch = {
	posts: CandidatePost[];
	prompt: string;
};

export type Judge = {
	judge_batch(batch: JudgeBatch): Promise<JudgeDecision[]>;
};

export type AiTechnologyPromptOptions = {
	filter_keywords?: readonly string[];
};

export function create_ai_technology_prompt(
	options: AiTechnologyPromptOptions = {},
): string {
	const filter_keywords = options.filter_keywords?.length
		? [
				'',
				'Current keyword prefilter terms:',
				options.filter_keywords.join(', '),
			]
		: [];

	return [...ai_technology_prompt_lines, ...filter_keywords].join(
		'\n',
	);
}

const ai_technology_prompt_lines = [
	'You curate a Bluesky feed for high-signal AI technology posts.',
	'',
	'Accept only posts that would be useful to someone following AI/ML/LLM technology deliberately.',
	'Good accepts include concrete model releases, research/evals, developer tooling, agent workflows, AI infrastructure, safety/security, and materially important product or industry news.',
	'',
	'Hard reject even if AI keywords appear:',
	'- crypto/stock/trading posts, price bots, and DePIN hashtag bait',
	'- jobs, hiring ads, lead-gen, webinars, newsletters, SEO/content-marketing, affiliate/link farms',
	'- AI art/image/video posts unless they discuss a specific model, tool, eval, workflow, licensing case, or technical constraint',
	'- posts where AI is only an image credit, artwork disclosure, insult, joke, horoscope/sign, or metaphor',
	'- culture-war/political outrage posts, including Nazi/fascist comparisons, unless they are concrete AI policy/safety news',
	'- generic business transformation fluff without technical or product substance',
	'- non-English posts unless the technical substance is obvious from the text',
	'- pure anti-AI/pro-AI venting without a concrete technical claim',
	'- bots that repost headlines without adding signal',
	'',
	'Prefer false negatives over false positives. A feed item should be specific, timely, and worth clicking or discussing.',
	'Use score for feed value from 0 to 1, not just topicality. Accept only when score is at least 0.65.',
	'Return only decisions keyed by URI.',
];

export const ai_technology_prompt = create_ai_technology_prompt();

export function create_configured_judge(): Judge {
	if (process.env.AI_JUDGE_PROVIDER === 'openai') {
		return create_openai_judge();
	}
	return create_noop_judge();
}

export function create_noop_judge(): Judge {
	return {
		async judge_batch(batch) {
			return batch.posts.map((post) => ({
				uri: post.uri,
				is_ai_technology: false,
				confidence: 0,
				score: 0,
				category: 'off-topic',
				reason: 'noop judge is not configured',
			}));
		},
	};
}
