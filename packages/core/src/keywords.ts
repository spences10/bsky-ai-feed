export const default_ai_keywords = [
	'AI',
	'AGI',
	'LLM',
	'GPT',
	'ChatGPT',
	'Claude',
	'OpenAI',
	'Anthropic',
	'Gemini',
	'Copilot',
	'Llama',
	'Mistral',
	'machine learning',
	'deep learning',
	'neural network',
	'generative AI',
	'prompt engineering',
	'AI model',
	'language model',
] as const;

export type AiKeyword = (typeof default_ai_keywords)[number];
