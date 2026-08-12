export async function closeReaderAndNavigateBack(
  closeReader: () => Promise<void>,
  navigateBack: () => void,
): Promise<void> {
  try {
    await closeReader();
  } finally {
    navigateBack();
  }
}

export type ReaderReturnTarget = { kind: 'moke'; path: '/library' } | { kind: 'readest' };

/** Resolve only the host route explicitly supported by the embedded reader. */
export function resolveReaderReturnTarget(search: string): ReaderReturnTarget {
  const params = new URLSearchParams(search);
  if (params.get('moke') === '1' && params.get('mokeReturnTo') === '/library') {
    return { kind: 'moke', path: '/library' };
  }
  return { kind: 'readest' };
}
