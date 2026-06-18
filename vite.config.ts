import { defineConfig } from 'vite-plus';

export default defineConfig({
	test: {
		include: ['{apps,packages}/**/*.test.ts'],
	},
	fmt: {
		useTabs: true,
		singleQuote: true,
		printWidth: 70,
		trailingComma: 'all',
		proseWrap: 'always',
	},
	lint: {
		ignorePatterns: [
			'dist/**',
			'apps/*/dist/**',
			'packages/*/dist/**',
		],
		options: {
			typeAware: true,
			typeCheck: true,
		},
	},
});
