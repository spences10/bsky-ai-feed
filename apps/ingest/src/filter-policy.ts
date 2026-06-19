import type {
	CandidatePost,
	FilterOptions,
} from '@bsky-ai-feed/core';
import type { FeedStore, FilterPolicy } from '@bsky-ai-feed/store';

export type RuntimeFilterPolicy = Pick<
	FilterOptions,
	| 'keywords'
	| 'excluded_dids'
	| 'excluded_handle_patterns'
	| 'suppression_patterns'
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
		excluded_handle_patterns: non_empty(
			(policy?.excluded_handle_patterns ?? []).flatMap(
				compile_pattern,
			),
		),
		suppression_patterns: non_empty(
			(policy?.suppression_patterns ?? []).flatMap(compile_pattern),
		),
	});
}

export function is_excluded_author(
	post: CandidatePost,
	policy: RuntimeFilterPolicy,
): boolean {
	const did = did_from_at_uri(post.uri);
	if (did && policy.excluded_dids?.has(did)) return true;
	return Boolean(
		post.author_handle &&
		policy.excluded_handle_patterns?.some((pattern) =>
			pattern.test(post.author_handle ?? ''),
		),
	);
}

export async function hydrate_author_handles(
	posts: readonly CandidatePost[],
	policy: RuntimeFilterPolicy,
	fetch_impl: typeof fetch = fetch,
): Promise<void> {
	if (!policy.excluded_handle_patterns?.length) return;
	const dids = [
		...new Set(posts.map((post) => did_from_at_uri(post.uri))),
	].filter((did): did is string => Boolean(did));
	if (dids.length === 0) return;

	for (const batch of chunks(dids, 25)) {
		const url = new URL(
			'https://public.api.bsky.app/xrpc/app.bsky.actor.getProfiles',
		);
		for (const did of batch) url.searchParams.append('actors', did);
		let response: Response;
		try {
			response = await fetch_impl(url);
		} catch {
			continue;
		}
		if (!response.ok) continue;
		const profiles = await response.json().catch(() => undefined);
		if (!is_record(profiles) || !Array.isArray(profiles.profiles)) {
			continue;
		}
		const handles_by_did = new Map<string, string>();
		for (const profile of profiles.profiles) {
			if (!is_record(profile)) continue;
			if (
				typeof profile.did === 'string' &&
				typeof profile.handle === 'string'
			) {
				handles_by_did.set(profile.did, profile.handle);
			}
		}
		for (const post of posts) {
			const did = did_from_at_uri(post.uri);
			const handle = did ? handles_by_did.get(did) : undefined;
			if (handle) post.author_handle = handle;
		}
	}
}

function compile_pattern(pattern: string): RegExp[] {
	try {
		return [new RegExp(pattern, 'iu')];
	} catch {
		return [];
	}
}

function did_from_at_uri(uri: string): string | undefined {
	const match = /^at:\/\/(did:[^/]+)\//u.exec(uri);
	return match?.[1];
}

function chunks<T>(items: T[], size: number): T[][] {
	const result: T[][] = [];
	for (let index = 0; index < items.length; index += size) {
		result.push(items.slice(index, index + size));
	}
	return result;
}

function is_record(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
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
