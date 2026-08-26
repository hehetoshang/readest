import { afterEach, describe, expect, it, vi } from 'vitest';
import { runTransientReaderBootstrap } from '@/app/reader/utils/transientReader';

describe('runTransientReaderBootstrap', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not enter the failure state after successful initialization', async () => {
    const onFailure = vi.fn();

    await runTransientReaderBootstrap(async () => {}, onFailure);

    expect(onFailure).not.toHaveBeenCalled();
  });

  it('exits loading when an asynchronous library bootstrap rejects', async () => {
    const error = new Error('library.json is unavailable');
    const onFailure = vi.fn();
    vi.spyOn(console, 'error').mockImplementation(() => {});

    await runTransientReaderBootstrap(async () => {
      throw error;
    }, onFailure);

    expect(onFailure).toHaveBeenCalledOnce();
    expect(onFailure).toHaveBeenCalledWith(error);
  });

  it('also catches a synchronous bootstrap exception exactly once', async () => {
    const error = new Error('path resolver failed');
    const onFailure = vi.fn();
    vi.spyOn(console, 'error').mockImplementation(() => {});

    await runTransientReaderBootstrap(() => {
      throw error;
    }, onFailure);

    expect(onFailure).toHaveBeenCalledOnce();
    expect(onFailure).toHaveBeenCalledWith(error);
  });
});
