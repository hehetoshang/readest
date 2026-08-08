import type { EmbeddingModel } from 'ai';

/**
 * A placeholder embedding model whose `doEmbed` always throws a clear error.
 *
 * Used when the user leaves the provider's embedding model blank — the AI
 * settings UI labels that state "None (disable RAG)". Returning this instead
 * of silently falling back to a default model ID prevents the app from POSTing
 * to `/embeddings` with a model the endpoint may not support, which otherwise
 * surfaces as an opaque "Invalid JSON response" from the AI SDK.
 */
export function createUnavailableEmbeddingModel(provider: string, message: string): EmbeddingModel {
  return {
    specificationVersion: 'v3',
    modelId: '',
    provider: `${provider}-unavailable`,
    maxEmbeddingsPerCall: 100,
    supportsParallelCalls: false,
    async doEmbed(): Promise<never> {
      throw new Error(message);
    },
  } as EmbeddingModel;
}
