import { defineConfig } from 'vite-plus';

export default defineConfig({
	pack: {
		entry: ['src/index.ts'],
		format: ['esm'],
		sourcemap: true,
		dts: true,
		deps: {
			neverBundle: ['@bsky-ai-feed/core', '@bsky-ai-feed/store'],
		},
		outExtensions: () => ({ js: '.js' }),
	},
	test: {
		include: ['src/**/*.test.ts'],
	},
	fmt: {
		useTabs: true,
		singleQuote: true,
		printWidth: 70,
		trailingComma: 'all',
		proseWrap: 'always',
	},
	lint: {
		ignorePatterns: ['dist/**'],
		options: {
			typeAware: true,
			typeCheck: true,
		},
	},
});
