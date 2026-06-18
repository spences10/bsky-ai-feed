import { existsSync, readFileSync } from 'node:fs';

export function load_dotenv(path = '.env'): void {
	if (!existsSync(path)) return;
	const lines = readFileSync(path, 'utf8').split(/\r?\n/u);
	for (const line of lines) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith('#')) continue;
		const separator = trimmed.indexOf('=');
		if (separator === -1) continue;

		const key = trimmed.slice(0, separator).trim();
		const value = unquote(trimmed.slice(separator + 1).trim());
		if (!key || process.env[key] !== undefined) continue;
		process.env[key] = value;
	}
}

function unquote(value: string): string {
	if (
		(value.startsWith('"') && value.endsWith('"')) ||
		(value.startsWith("'") && value.endsWith("'"))
	) {
		return value.slice(1, -1);
	}
	return value;
}
