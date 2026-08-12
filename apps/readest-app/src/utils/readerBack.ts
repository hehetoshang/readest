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
