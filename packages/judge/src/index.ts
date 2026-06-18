import type { CandidatePost } from '@bsky-ai-feed/core';

export type JudgeDecision = {
	uri: string;
	is_ai_technology: boolean;
	confidence: number;
	reason?: string;
};

export type JudgeBatch = {
	posts: CandidatePost[];
	prompt: string;
};

export type Judge = {
	judge_batch(batch: JudgeBatch): Promise<JudgeDecision[]>;
};

export const ai_technology_prompt = [
	'You are curating a Bluesky feed about AI as a technology.',
	'Accept posts about AI models, ML research, AI products, AI tooling, or AI industry news.',
	'Reject metaphorical uses, first aid, anti-AI posts without technical substance, and name collisions.',
	'Return only decisions keyed by URI.',
].join('\n');

export function create_noop_judge(): Judge {
	return {
		async judge_batch(batch) {
			return batch.posts.map((post) => ({
				uri: post.uri,
				is_ai_technology: false,
				confidence: 0,
				reason: 'noop judge is not configured',
			}));
		},
	};
}
