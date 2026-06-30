// Cloud book sync has been removed.
// Books are managed locally only.
// TODO: When talebook server sync is connected, restore pull/push/updateLibrary logic.

export const useBooksSync = () => {
  return { pullLibrary: async () => {}, pushLibrary: async () => {} };
};
