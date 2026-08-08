import { describe, test, expect } from 'vitest';
import { APICallError } from 'ai';
import { describeAIError } from '@/services/ai/utils/describeError';

describe('describeAIError', () => {
  test('extracts statusCode, url and responseBody from an APICallError', () => {
    const err = new APICallError({
      message: 'Invalid JSON response',
      url: 'https://openrouter.ai/api/v1/embeddings',
      statusCode: 200,
      responseBody: '<html><body>not json</body></html>',
      requestBodyValues: { model: 'openai/text-embedding-3-small' },
    });

    const msg = describeAIError(err, 'Embedding');

    expect(msg).toContain('Embedding');
    expect(msg).toContain('HTTP 200');
    expect(msg).toContain('https://openrouter.ai/api/v1/embeddings');
    expect(msg).toContain('<html>');
  });

  test('keeps the APICallError message', () => {
    const err = new APICallError({
      message: 'Invalid JSON response',
      url: 'https://example.com/v1/embeddings',
      statusCode: 502,
      requestBodyValues: {},
    });

    expect(describeAIError(err, 'Index')).toContain('Invalid JSON response');
  });

  test('truncates long response bodies', () => {
    const err = new APICallError({
      message: 'Invalid JSON response',
      url: 'https://example.com/v1/embeddings',
      statusCode: 502,
      responseBody: 'x'.repeat(5000),
      requestBodyValues: {},
    });

    const msg = describeAIError(err, 'Embedding');
    expect(msg.length).toBeLessThan(1000);
  });

  test('passes through plain Error messages with the context prefix', () => {
    expect(describeAIError(new Error('boom'), 'Index')).toBe('Index: boom');
  });

  test('falls back to a default message for unknown errors', () => {
    expect(describeAIError('not-an-error', 'Index')).toBe('Index: 未知错误');
  });

  test('uses the error message as context when no context is given', () => {
    expect(describeAIError(new Error('boom'))).toBe('boom');
  });
});
