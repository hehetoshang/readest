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

export type ReaderReturnTarget = { kind: 'moke'; path: string } | { kind: 'readest' };

/** Resolve only the host route explicitly supported by the embedded reader. */
export function resolveReaderReturnTarget(search: string): ReaderReturnTarget {
  const params = new URLSearchParams(search);
  const returnTo = params.get('mokeReturnTo');
  if (
    params.get('moke') === '1' &&
    returnTo &&
    (returnTo === '/library' || /^\/book\/[0-9]+$/.test(returnTo))
  ) {
    return { kind: 'moke', path: returnTo };
  }
  return { kind: 'readest' };
}
