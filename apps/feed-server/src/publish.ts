#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { extname } from 'node:path';
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
	avatar_path?: string;
	pds_url: string;
	handle: string;
	password: string;
};

type SessionResponse = {
	accessJwt: string;
	did: string;
};

type FeedAvatarBlob = {
	$type?: 'blob';
	ref: { $link: string };
	mimeType: string;
	size: number;
};

type UploadBlobResponse = {
	blob: FeedAvatarBlob;
};

export function create_feed_generator_record(
	config: PublishFeedConfig,
	avatar?: FeedAvatarBlob,
) {
	return {
		$type: 'app.bsky.feed.generator',
		did: config.service_did,
		displayName: config.display_name,
		description: config.description,
		avatar,
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
	const avatar = config.avatar_path
		? await upload_feed_avatar(config, session.accessJwt, fetch_impl)
		: undefined;

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
				record: create_feed_generator_record(
					{
						...config,
						publisher_did: session.did,
					},
					avatar,
				),
			}),
		},
	);
	if (!put_response.ok) {
		throw new Error(`putRecord failed: ${put_response.status}`);
	}
	return (await put_response.json()) as { uri: string; cid: string };
}

async function upload_feed_avatar(
	config: PublishFeedConfig,
	access_jwt: string,
	fetch_impl: typeof fetch,
): Promise<FeedAvatarBlob> {
	if (!config.avatar_path) throw new Error('avatar_path is required');
	const mime_type = avatar_mime_type(config.avatar_path);
	const response = await fetch_impl(
		`${config.pds_url}/xrpc/com.atproto.repo.uploadBlob`,
		{
			method: 'POST',
			headers: {
				authorization: `Bearer ${access_jwt}`,
				'content-type': mime_type,
			},
			body: readFileSync(config.avatar_path),
		},
	);
	if (!response.ok) {
		throw new Error(`uploadBlob failed: ${response.status}`);
	}
	return ((await response.json()) as UploadBlobResponse).blob;
}

function avatar_mime_type(path: string): 'image/png' | 'image/jpeg' {
	const extension = extname(path).toLowerCase();
	if (extension === '.png') return 'image/png';
	if (extension === '.jpg' || extension === '.jpeg')
		return 'image/jpeg';
	throw new Error('BSKY_FEED_AVATAR_PATH must be a PNG or JPEG');
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
			'A live, picky feed for AI builders: model releases, evals, agents, tools, infra, research notes, and practical engineering — filtered hard to skip hype, AI art, bait, and culture-war sludge.',
		avatar_path: process.env.BSKY_FEED_AVATAR_PATH,
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
