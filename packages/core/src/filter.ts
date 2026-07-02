import { default_ai_keywords } from './keywords.js';
import type { CandidatePost, FilterResult } from './types.js';

export type FilterOptions = {
	keywords?: readonly string[];
	excluded_dids?: ReadonlySet<string>;
	excluded_handle_patterns?: readonly RegExp[];
	suppression_patterns?: readonly RegExp[];
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

export function is_suppressed_low_signal(
	text: string,
	patterns: readonly RegExp[] = low_signal_patterns,
): boolean {
	return patterns.some((pattern) => pattern.test(text));
}

export function filter_candidate_post(
	post: CandidatePost,
	options: FilterOptions = {},
): FilterResult {
	if (post.reply_root_uri)
		return { accepted: false, reason: 'reply' };
	const author_did = did_from_at_uri(post.uri);
	if (author_did && options.excluded_dids?.has(author_did)) {
		return { accepted: false, reason: 'excluded-account' };
	}
	if (
		post.author_handle &&
		options.excluded_handle_patterns?.some((pattern) =>
			pattern.test(post.author_handle ?? ''),
		)
	) {
		return { accepted: false, reason: 'excluded-account' };
	}
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

	if (
		is_suppressed_low_signal(post.text, options.suppression_patterns)
	) {
		return { accepted: false, reason: 'suppressed' };
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

	if (!has_prefilter_feed_signal(post.text, matched_keywords)) {
		return {
			accepted: false,
			reason: 'weak-signal',
			matched_keywords,
		};
	}

	options.seen_text?.add(signature);
	return { accepted: true, post, matched_keywords };
}

const low_signal_patterns = [
	/#[A-Z0-9]*(?:Crypto|DePIN|AIJobs|Hiring|Finance)[A-Z0-9]*/iu,
	/\bsmart money\s+(?:accumulated|dumped)\b/iu,
	/\b(?:price|trend):\s*[$+\-0-9.]/iu,
	/\b(?:stock|stocks|shares?)\s+(?:to buy|rally|surge|falls?|jumps?)\b/iu,
	/\b(?:black market|sovereign wealth fund)\b/iu,
	/\btopgenaijobs\.com\b/iu,
	/\b(?:AI|ML|GenAI)\s+(?:job|jobs|hiring)\b/iu,
	/\brank in AI search results\b/iu,
	/\bcontent repurposing playbook\b/iu,
	/\b(?:read more|learn more)\s*[👉→]/iu,
	/\b(?:zurl\.co|lttr\.ai)\//iu,
	/\bcreated with\s+(?:AI|recraft\.ai)\b/iu,
	/\bAI[- ]generated\)?\s*$/iu,
	/\b(?:AI|generated)\s+(?:art|artist|artists|image|images|video|videos)\b/iu,
	/\b(?:art|image|video)s?\s+(?:made|created|generated)\s+(?:with|by)\s+AI\b/iu,
	/\b(?:not|isn'?t)\s+AI\b/iu,
	/\bAI\s+slop\b/iu,
	/\b(?:nazi|nazis|hitler|fascist|fascism)\b/iu,
] as const;

const generic_keywords = new Set(['ai', 'agi', 'generative ai']);
const technical_signal_pattern =
	/\b(?:agent|agents|api|benchmark|coding agent|context (?:reduction|sidecar)|cuda|dataset|datasets|developer|eval|evals|fine-?tun(?:e|ing)|framework|gpu|guardrails?|inference|infrastructure|kubernetes|library|llm|mcp|model|models|open source|openrouter|paper|papers|pi harness|prompt|rag|release|released|repo|research|safety|sdk|security|session recall|tool|tooling|training|transformer|vulnerability|workflow)\b|\bmy-pi\b|\blsp\b/iu;

function has_prefilter_feed_signal(
	text: string,
	matched_keywords: readonly string[],
): boolean {
	return (
		matched_keywords.some(
			(keyword) => !generic_keywords.has(keyword.toLowerCase()),
		) || technical_signal_pattern.test(text)
	);
}

function did_from_at_uri(uri: string): string | undefined {
	const match = /^at:\/\/(did:[^/]+)\//u.exec(uri);
	return match?.[1];
}

function escape_regex(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}
