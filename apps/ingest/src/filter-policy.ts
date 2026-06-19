import type { FilterOptions } from '@bsky-ai-feed/core';
import type { FeedStore, FilterPolicy } from '@bsky-ai-feed/store';

export type RuntimeFilterPolicy = Pick<
	FilterOptions,
	'keywords' | 'excluded_dids' | 'suppression_patterns'
>;

export async function load_runtime_filter_policy(
	store: Pick<FeedStore, 'get_filter_policy'> | undefined,
): Promise<RuntimeFilterPolicy> {
	return runtime_filter_policy(await store?.get_filter_policy?.());
}

export function runtime_filter_policy(
	policy: FilterPolicy | undefined,
): RuntimeFilterPolicy {
	return strip_undefined({
		keywords: non_empty(policy?.keyword_sets.default),
		excluded_dids: non_empty(policy?.excluded_dids)
			? new Set(policy?.excluded_dids)
			: undefined,
		suppression_patterns: non_empty(
			(policy?.suppression_patterns ?? []).flatMap(compile_pattern),
		),
	});
}

function compile_pattern(pattern: string): RegExp[] {
	try {
		return [new RegExp(pattern, 'iu')];
	} catch {
		return [];
	}
}

function non_empty<T>(value: T[] | undefined): T[] | undefined {
	return value && value.length > 0 ? value : undefined;
}

function strip_undefined<T extends Record<string, unknown>>(
	value: T,
): T {
	return Object.fromEntries(
		Object.entries(value).filter(([, entry]) => entry !== undefined),
	) as T;
}
