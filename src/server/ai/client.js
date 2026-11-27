// @ts-check
/**
 * The slice of the Gemini client the AI features depend on. Features take this interface
 * rather than the concrete client, so tests can pass a stub.
 *
 * @typedef {{ mimeType: string, data: string }} InlineImage base64 image sent with a prompt
 * @typedef {{ system: string, prompt: string, maxTokens?: number, image?: InlineImage }} JsonRequest
 * @typedef {{ enabled: boolean, generateJson: (request: JsonRequest) => Promise<unknown> }} AiClient
 */

export {};
