#!/usr/bin/env node
import { load_dotenv } from './env.js';

function required_env(name: string): string {
	const value = process.env[name];
	if (!value) throw new Error(`${name} is required`);
	return value;
}

export type PublishFeedConfig = {
	service_did: string;
	publisher_did: string;
	rkey: string;
	display_name: string;
	description?: string;
	pds_url: string;
	handle: string;
	password: string;
};

type SessionResponse = {
	accessJwt: string;
	did: string;
};

export function create_feed_generator_record(
	config: PublishFeedConfig,
) {
	return {
		$type: 'app.bsky.feed.generator',
		did: config.service_did,
		displayName: config.display_name,
		description: config.description,
		createdAt: new Date().toISOString(),
	};
}

export function feed_uri(config: PublishFeedConfig): string {
	return `at://${config.publisher_did}/app.bsky.feed.generator/${config.rkey}`;
}

export async function publish_feed_generator(
	config: PublishFeedConfig,
	fetch_impl: typeof fetch = fetch,
): Promise<{ uri: string; cid: string }> {
	const session_response = await fetch_impl(
		`${config.pds_url}/xrpc/com.atproto.server.createSession`,
		{
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				identifier: config.handle,
				password: config.password,
			}),
		},
	);
	if (!session_response.ok) {
		throw new Error(
			`createSession failed: ${session_response.status}`,
		);
	}
	const session = (await session_response.json()) as SessionResponse;

	const put_response = await fetch_impl(
		`${config.pds_url}/xrpc/com.atproto.repo.putRecord`,
		{
			method: 'POST',
			headers: {
				authorization: `Bearer ${session.accessJwt}`,
				'content-type': 'application/json',
			},
			body: JSON.stringify({
				repo: session.did,
				collection: 'app.bsky.feed.generator',
				rkey: config.rkey,
				record: create_feed_generator_record({
					...config,
					publisher_did: session.did,
				}),
			}),
		},
	);
	if (!put_response.ok) {
		throw new Error(`putRecord failed: ${put_response.status}`);
	}
	return (await put_response.json()) as { uri: string; cid: string };
}

function read_config_from_env(): PublishFeedConfig {
	return {
		service_did: required_env('FEEDGEN_DID'),
		publisher_did:
			process.env.BSKY_PUBLISHER_DID ?? 'will-use-login-did',
		rkey: process.env.BSKY_FEED_RKEY ?? 'ai-feed',
		display_name: process.env.BSKY_FEED_DISPLAY_NAME ?? 'AI Feed',
		description:
			process.env.BSKY_FEED_DESCRIPTION ??
			'High-signal posts about AI as a technology.',
		pds_url: process.env.BSKY_PDS_URL ?? 'https://bsky.social',
		handle: required_env('BSKY_HANDLE'),
		password: required_env('BSKY_APP_PASSWORD'),
	};
}

if (import.meta.url === `file://${process.argv[1]}`) {
	load_dotenv();
	const config = read_config_from_env();
	const result = await publish_feed_generator(config);
	console.log(JSON.stringify(result, null, 2));
}
