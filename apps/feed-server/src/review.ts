#!/usr/bin/env node
import { create_sqlite_feed_store } from '@bsky-ai-feed/store';
import { fileURLToPath } from 'node:url';
import { load_dotenv } from './env.js';

function default_database_path(): string {
	return fileURLToPath(
		new URL('../../../.data/feed.sqlite', import.meta.url),
	);
}

function parse_limit(args: string[]): number {
	const value = args
		.find((arg) => arg.startsWith('--limit='))
		?.slice('--limit='.length);
	const limit = Number(value ?? 25);
	return Number.isFinite(limit)
		? Math.min(Math.max(limit, 1), 200)
		: 25;
}

function parse_accepted(args: string[]): boolean | undefined {
	if (args.includes('--accepted')) return true;
	if (args.includes('--rejected')) return false;
	return undefined;
}

function truncate(value: string, length: number): string {
	const clean = value.replace(/\s+/gu, ' ').trim();
	return clean.length <= length
		? clean
		: `${clean.slice(0, length - 1)}…`;
}

async function main(args: string[]): Promise<void> {
	load_dotenv();
	const store = create_sqlite_feed_store({
		path: process.env.BSKY_AI_FEED_DB_PATH ?? default_database_path(),
	});
	try {
		const rows = await store.get_recent_decisions?.({
			limit: parse_limit(args),
			accepted: parse_accepted(args),
		});
		if (!rows || rows.length === 0) {
			console.log('No candidate decisions found.');
			return;
		}
		for (const row of rows) {
			const status = row.accepted ? 'ACCEPT' : 'REJECT';
			const score = (row.score ?? 0).toFixed(2);
			const confidence = row.confidence.toFixed(2);
			console.log(
				[
					`${status} score=${score} confidence=${confidence}`,
					`category=${row.category ?? 'unknown'}`,
					`reason=${row.reason ?? 'none'}`,
				].join(' | '),
			);
			console.log(row.uri);
			console.log(truncate(row.text, 220));
			console.log('---');
		}
	} finally {
		store.close?.();
	}
}

if (import.meta.url === `file://${process.argv[1]}`) {
	await main(process.argv.slice(2));
}
