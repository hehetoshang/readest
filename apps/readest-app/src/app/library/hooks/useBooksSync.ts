// Cloud book sync has been removed.
// Books are managed locally only.
// TODO: When talebook server sync is connected, restore pull/push/updateLibrary logic.

export const useBooksSync = () => {
  const pullLibrary = async (_fullRefresh = false, _verbose = false): Promise<void> => {};
  const pushLibrary = async (): Promise<void> => {};
  return { pullLibrary, pushLibrary };
};
