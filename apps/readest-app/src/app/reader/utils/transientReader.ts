export async function runTransientReaderBootstrap(
  openFiles: () => Promise<void>,
  onFailure: (error: unknown) => void,
): Promise<void> {
  try {
    await openFiles();
  } catch (error) {
    console.error('Failed to initialize transient reader files:', error);
    onFailure(error);
  }
}
