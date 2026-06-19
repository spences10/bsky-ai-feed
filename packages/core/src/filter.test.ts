import { describe, expect, it } from 'vitest';
import {
	filter_candidate_post,
	find_ai_keywords,
	text_signature,
} from './filter.js';
import type { CandidatePost } from './types.js';

const base_post: CandidatePost = {
	uri: 'at://did:example/app.bsky.feed.post/1',
	cid: 'bafyexample',
	text: 'OpenAI released a new language model today',
	lang: 'en',
};

describe('find_ai_keywords', () => {
	it('matches whole AI terms case-insensitively', () => {
		expect(find_ai_keywords('claude and GPT are an LLM')).toEqual([
			'LLM',
			'GPT',
			'Claude',
		]);
	});

	it('does not match AI inside unrelated words', () => {
		expect(find_ai_keywords('first aid training')).toEqual([]);
	});
});

describe('filter_candidate_post', () => {
	it('accepts keyword hits that pass prefilters', () => {
		expect(filter_candidate_post(base_post)).toMatchObject({
			accepted: true,
			matched_keywords: ['OpenAI', 'language model'],
		});
	});

	it('rejects replies before paid judging', () => {
		expect(
			filter_candidate_post({
				...base_post,
				reply_root_uri: 'at://did:example/root',
			}),
		).toEqual({ accepted: false, reason: 'reply' });
	});

	it('rejects excluded account DIDs before paid judging', () => {
		expect(
			filter_candidate_post(base_post, {
				excluded_dids: new Set(['did:example']),
			}),
		).toEqual({ accepted: false, reason: 'excluded-account' });
	});

	it('rejects excluded account handle patterns before paid judging', () => {
		expect(
			filter_candidate_post(
				{ ...base_post, author_handle: 'statml-bot.bsky.social' },
				{ excluded_handle_patterns: [/bot\.bsky\.social$/iu] },
			),
		).toEqual({ accepted: false, reason: 'excluded-account' });
	});

	it('rejects duplicate normalized text', () => {
		const seen_text = new Set<string>([
			text_signature(base_post.text),
		]);

		expect(filter_candidate_post(base_post, { seen_text })).toEqual({
			accepted: false,
			reason: 'duplicate',
		});
	});

	it('rejects obvious low-signal spam before paid judging', () => {
		expect(
			filter_candidate_post({
				...base_post,
				text: '🧠 Smart Money ACCUMULATED $10,266 of #TAO #Crypto #AI #DePIN',
			}),
		).toEqual({ accepted: false, reason: 'suppressed' });
	});

	it('can use supplied suppression patterns', () => {
		expect(
			filter_candidate_post(
				{
					...base_post,
					text: 'OpenAI released a new language model today',
				},
				{ suppression_patterns: [/language model/iu] },
			),
		).toEqual({ accepted: false, reason: 'suppressed' });
	});

	it('rejects AI art and politics bait before paid judging', () => {
		expect(
			filter_candidate_post({
				...base_post,
				text: 'This AI art is slop and the nazis love it',
			}),
		).toEqual({ accepted: false, reason: 'suppressed' });
	});
});
