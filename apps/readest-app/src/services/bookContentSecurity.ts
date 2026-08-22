export type BookResourceLoadDetail = {
  isScript: boolean;
  allow?: boolean;
};

/** Scripted publication content is unsupported because it shares the reader origin. */
export const enforceBookResourcePolicy = (detail: BookResourceLoadDetail): void => {
  if (detail.isScript) detail.allow = false;
};
