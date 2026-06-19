import {
	filter_candidate_post,
	type CandidatePost,
	type FeedPost,
} from '@bsky-ai-feed/core';
import {
	create_ai_technology_prompt,
	type Judge,
} from '@bsky-ai-feed/judge';
import type {
	CandidateDecision,
	FeedStore,
} from '@bsky-ai-feed/store';
import {
	hydrate_author_handles,
	is_excluded_author,
	load_runtime_filter_policy,
	type RuntimeFilterPolicy,
} from './filter-policy.js';

export type JetstreamRunMode = 'ingest';

const default_judge_batch_size = 25;
const default_judge_batch_delay_ms = 30_000;

export type JetstreamRunOptions = {
	mode: JetstreamRunMode;
	host?: string;
	store?: FeedStore;
	judge?: Judge;
	confidence_threshold?: number;
	quality_threshold?: number;
	judge_batch_size?: number;
	judge_batch_delay_ms?: number;
	max_events?: number;
	seen_text?: Set<string>;
	log?: (message: string) => void;
	on_open?: () => void;
	on_result?: (result: JetstreamMessageResult) => void;
	on_close?: () => void;
};

type JetstreamCommitEvent = {
	did?: unknown;
	kind?: unknown;
	time_us?: unknown;
	commit?: {
		operation?: unknown;
		collection?: unknown;
		rkey?: unknown;
		cid?: unknown;
		record?: {
			text?: unknown;
			langs?: unknown;
			reply?: {
				root?: {
					uri?: unknown;
				};
			};
		};
	};
};

type PrefilteredCandidate = {
	post: CandidatePost;
	matched_keywords: string[];
};

type PrefilterResult =
	| {
			kind: 'ignored';
	  }
	| {
			kind: 'rejected';
			post: CandidatePost;
			reason: string;
	  }
	| ({ kind: 'candidate' } & PrefilteredCandidate);

export type JetstreamMessageResult =
	| {
			kind: 'ignored';
	  }
	| {
			kind: 'candidate';
			post: CandidatePost;
	  }
	| {
			kind: 'accepted';
			post: FeedPost;
	  }
	| {
			kind: 'rejected';
			post: CandidatePost;
			reason: string;
	  };

export function create_jetstream_url(
	host = 'jetstream2.us-east.bsky.network',
): string {
	const url = new URL(`wss://${host}/subscribe`);
	url.searchParams.set('wantedCollections', 'app.bsky.feed.post');
	return url.toString();
}

export function candidate_post_from_jetstream_event(
	event: unknown,
): CandidatePost | undefined {
	if (!is_record(event)) return undefined;
	const jetstream_event = event as JetstreamCommitEvent;
	const commit = jetstream_event.commit;
	const record = commit?.record;

	if (jetstream_event.kind !== 'commit') return undefined;
	if (commit?.operation !== 'create') return undefined;
	if (commit.collection !== 'app.bsky.feed.post') return undefined;
	if (typeof jetstream_event.did !== 'string') return undefined;
	if (typeof commit.rkey !== 'string') return undefined;
	if (typeof commit.cid !== 'string') return undefined;
	if (typeof record?.text !== 'string') return undefined;

	const post: CandidatePost = {
		uri: `at://${jetstream_event.did}/app.bsky.feed.post/${commit.rkey}`,
		cid: commit.cid,
		text: record.text,
	};
	const lang = first_string(record.langs);
	const reply_root_uri = root_reply_uri(record.reply);
	const indexed_at = indexed_at_from_time_us(jetstream_event.time_us);
	if (lang) post.lang = lang;
	if (reply_root_uri) post.reply_root_uri = reply_root_uri;
	if (indexed_at) post.indexed_at = indexed_at;
	return post;
}

export async function process_jetstream_message(
	message: string,
	options: Pick<
		JetstreamRunOptions,
		| 'mode'
		| 'store'
		| 'seen_text'
		| 'judge'
		| 'confidence_threshold'
		| 'quality_threshold'
	>,
): Promise<JetstreamMessageResult> {
	const filter_policy = await load_runtime_filter_policy(
		options.store,
	);
	const prefiltered = prefilter_jetstream_message(message, {
		...options,
		filter_policy,
	});
	if (prefiltered.kind !== 'candidate') return prefiltered;
	const [result] = await process_prefiltered_candidates(
		[prefiltered],
		{ ...options, filter_policy },
	);
	return result ?? { kind: 'ignored' };
}

export async function process_prefiltered_candidates(
	candidates: PrefilteredCandidate[],
	options: Pick<
		JetstreamRunOptions,
		'store' | 'judge' | 'confidence_threshold' | 'quality_threshold'
	> & { filter_policy?: RuntimeFilterPolicy },
): Promise<JetstreamMessageResult[]> {
	if (candidates.length === 0) return [];
	const judged_at = new Date().toISOString();
	if (options.filter_policy) {
		await hydrate_author_handles(
			candidates.map(({ post }) => post),
			options.filter_policy,
		);
	}
	const excluded_author_uris = new Set(
		options.filter_policy
			? candidates
					.filter(({ post }) =>
						is_excluded_author(post, options.filter_policy ?? {}),
					)
					.map(({ post }) => post.uri)
			: [],
	);
	const candidates_to_judge = candidates.filter(
		({ post }) => !excluded_author_uris.has(post.uri),
	);
	const decisions = options.judge
		? await options.judge.judge_batch({
				posts: candidates_to_judge.map(({ post }) => post),
				prompt: create_ai_technology_prompt({
					filter_keywords: options.filter_policy?.keywords,
				}),
			})
		: [];
	const decisions_by_uri = new Map(
		decisions.map((decision) => [decision.uri, decision]),
	);
	const candidate_decisions: CandidateDecision[] = [];
	const accepted_posts: FeedPost[] = [];
	const results = candidates.map(({ post, matched_keywords }) => {
		if (excluded_author_uris.has(post.uri)) {
			return {
				kind: 'rejected',
				post,
				reason: 'excluded-account',
			} satisfies JetstreamMessageResult;
		}
		const decision = decisions_by_uri.get(post.uri);
		const accepted = options.judge
			? decision_is_accepted(decision, options)
			: true;
		if (options.judge) {
			candidate_decisions.push({
				uri: post.uri,
				cid: post.cid,
				text: post.text,
				indexed_at: post.indexed_at,
				judged_at,
				accepted,
				confidence: decision?.confidence ?? 0,
				score: decision?.score ?? 0,
				category: decision?.category,
				reason: decision?.reason,
				matched_keywords,
			});
		}
		if (!accepted) {
			return {
				kind: 'rejected',
				post,
				reason: decision?.reason ?? 'ai-judge-rejected',
			} satisfies JetstreamMessageResult;
		}
		const accepted_post: FeedPost = {
			uri: post.uri,
			cid: post.cid,
			accepted_at: judged_at,
			indexed_at: post.indexed_at,
			score: decision?.score,
			text: post.text,
			matched_keywords,
			judge_confidence: decision?.confidence,
			judge_reason: decision?.reason,
			judge_category: decision?.category,
		};
		accepted_posts.push(accepted_post);
		return {
			kind: 'accepted',
			post: accepted_post,
		} satisfies JetstreamMessageResult;
	});
	await options.store?.put_decisions?.(candidate_decisions);
	await options.store?.put_posts(accepted_posts);
	return results;
}

export async function run_jetstream(
	options: JetstreamRunOptions,
): Promise<void> {
	const log = options.log ?? console.log;
	const seen_text = options.seen_text ?? new Set<string>();
	const filter_policy = await load_runtime_filter_policy(
		options.store,
	);
	const url = create_jetstream_url(options.host);
	const socket = new WebSocket(url);
	const candidate_buffer: PrefilteredCandidate[] = [];
	const judge_batch_size =
		options.judge_batch_size ?? default_judge_batch_size;
	const judge_batch_delay_ms =
		options.judge_batch_delay_ms ?? default_judge_batch_delay_ms;
	let flush_timer: NodeJS.Timeout | undefined;
	let processed_events = 0;
	let closed_for_limit = false;
	let flush_chain = Promise.resolve();

	await new Promise<void>((resolve, reject) => {
		function emit(result: JetstreamMessageResult): void {
			options.on_result?.(result);
			if (result.kind === 'ignored') return;

			processed_events += 1;
			log(format_result(result));

			if (
				!closed_for_limit &&
				options.max_events &&
				processed_events >= options.max_events
			) {
				closed_for_limit = true;
				socket.close();
			}
		}

		function schedule_flush(): void {
			if (!options.judge) {
				void flush_candidates();
				return;
			}
			if (candidate_buffer.length >= judge_batch_size) {
				void flush_candidates();
				return;
			}
			flush_timer ??= setTimeout(() => {
				flush_timer = undefined;
				void flush_candidates();
			}, judge_batch_delay_ms);
		}

		function flush_candidates(): Promise<void> {
			if (flush_timer) {
				clearTimeout(flush_timer);
				flush_timer = undefined;
			}
			const batch = candidate_buffer.splice(0, judge_batch_size);
			if (batch.length === 0) return flush_chain;
			flush_chain = flush_chain.then(async () => {
				const results = await process_prefiltered_candidates(batch, {
					...options,
					filter_policy,
				});
				for (const result of results) emit(result);
			});
			return flush_chain;
		}

		socket.addEventListener('open', () => {
			log(`connected ${url}`);
			options.on_open?.();
		});

		socket.addEventListener('message', (event) => {
			void (async () => {
				const result = prefilter_jetstream_message(
					await message_data_to_string(event.data),
					{ ...options, seen_text, filter_policy },
				);
				if (result.kind !== 'candidate') {
					emit(result);
					return;
				}
				candidate_buffer.push(result);
				schedule_flush();
			})().catch((error: unknown) => {
				socket.close();
				reject(error);
			});
		});

		socket.addEventListener('error', () => {
			reject(new Error('Jetstream websocket error'));
		});

		socket.addEventListener('close', () => {
			void flush_candidates()
				.then(() => {
					options.on_close?.();
					resolve();
				})
				.catch(reject);
		});
	});
}

function prefilter_jetstream_message(
	message: string,
	options: Pick<JetstreamRunOptions, 'seen_text'> & {
		filter_policy?: RuntimeFilterPolicy;
	},
): PrefilterResult {
	const event = JSON.parse(message) as unknown;
	const post = candidate_post_from_jetstream_event(event);
	if (!post) return { kind: 'ignored' };
	const filter_result = filter_candidate_post(post, {
		...options.filter_policy,
		seen_text: options.seen_text,
	});
	if (!filter_result.accepted) {
		return {
			kind: 'rejected',
			post,
			reason: filter_result.reason,
		};
	}
	return {
		kind: 'candidate',
		post,
		matched_keywords: filter_result.matched_keywords,
	};
}

function decision_is_accepted(
	decision:
		| {
				is_ai_technology: boolean;
				confidence: number;
				score?: number;
		  }
		| undefined,
	options: Pick<
		JetstreamRunOptions,
		'confidence_threshold' | 'quality_threshold'
	>,
): boolean {
	return Boolean(
		decision?.is_ai_technology &&
		decision.confidence >= (options.confidence_threshold ?? 0.7) &&
		(decision.score ?? 0) >= (options.quality_threshold ?? 0.65),
	);
}

async function message_data_to_string(
	data: unknown,
): Promise<string> {
	if (typeof data === 'string') return data;
	if (data instanceof ArrayBuffer)
		return Buffer.from(data).toString();
	if (ArrayBuffer.isView(data)) {
		return Buffer.from(data.buffer).toString();
	}
	if (data instanceof Blob) return data.text();
	return String(data);
}

function format_result(result: JetstreamMessageResult): string {
	if (result.kind === 'candidate') {
		return `candidate ${result.post.uri} ${preview_text(result.post.text)}`;
	}
	if (result.kind === 'accepted') {
		return `accepted ${result.post.uri}`;
	}
	if (result.kind === 'rejected') {
		return `rejected ${result.reason} ${result.post.uri}`;
	}
	return 'ignored';
}

function preview_text(text: string): string {
	return text.replace(/\s+/gu, ' ').trim().slice(0, 120);
}

function indexed_at_from_time_us(
	time_us: unknown,
): string | undefined {
	if (typeof time_us !== 'number') return undefined;
	return new Date(Math.trunc(time_us / 1000)).toISOString();
}

function root_reply_uri(reply: unknown): string | undefined {
	if (!is_record(reply)) return undefined;
	const root = reply.root;
	if (!is_record(root)) return undefined;
	return typeof root.uri === 'string' ? root.uri : undefined;
}

function first_string(value: unknown): string | undefined {
	if (!Array.isArray(value)) return undefined;
	return value.find(
		(item): item is string => typeof item === 'string',
	);
}

function is_record(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}
