import { default_ai_keywords } from './keywords.js';
import type { CandidatePost, FilterResult } from './types.js';

export type FilterOptions = {
	keywords?: readonly string[];
	seen_text?: Set<string>;
	min_text_length?: number;
};

const wordish_boundary = String.raw`(?<![\p{L}\p{N}_])`;
const wordish_end_boundary = String.raw`(?![\p{L}\p{N}_])`;

export function find_ai_keywords(
	text: string,
	keywords: readonly string[] = default_ai_keywords,
): string[] {
	return keywords.filter((keyword) => {
		const escaped_keyword = escape_regex(keyword.trim());
		const pattern = new RegExp(
			`${wordish_boundary}${escaped_keyword}${wordish_end_boundary}`,
			'iu',
		);
		return pattern.test(text);
	});
}

export function text_signature(text: string): string {
	return text
		.toLowerCase()
		.replace(/https?:\/\/\S+/gu, '')
		.replace(/[^\p{L}\p{N}]+/gu, ' ')
		.trim()
		.replace(/\s+/gu, ' ');
}

export function is_likely_english(post: CandidatePost): boolean {
	if (post.lang) return post.lang.toLowerCase().startsWith('en');

	const ascii_letters = post.text.match(/[a-z]/giu)?.length ?? 0;
	const letters = post.text.match(/\p{L}/gu)?.length ?? 0;

	return letters === 0 || ascii_letters / letters >= 0.8;
}

export function filter_candidate_post(
	post: CandidatePost,
	options: FilterOptions = {},
): FilterResult {
	if (post.reply_root_uri)
		return { accepted: false, reason: 'reply' };
	if (!is_likely_english(post)) {
		return { accepted: false, reason: 'non-english' };
	}

	const signature = text_signature(post.text);
	const min_text_length = options.min_text_length ?? 12;
	if (signature.length < min_text_length) {
		return { accepted: false, reason: 'too-short' };
	}

	if (options.seen_text?.has(signature)) {
		return { accepted: false, reason: 'duplicate' };
	}

	const matched_keywords = find_ai_keywords(
		post.text,
		options.keywords,
	);
	if (matched_keywords.length === 0) {
		return {
			accepted: false,
			reason: 'keyword-miss',
			matched_keywords,
		};
	}

	options.seen_text?.add(signature);
	return { accepted: true, post, matched_keywords };
}

function escape_regex(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}
