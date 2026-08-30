export const shouldMountNotebook = (isVisible: boolean, isPinned: boolean): boolean =>
  isVisible || isPinned;
