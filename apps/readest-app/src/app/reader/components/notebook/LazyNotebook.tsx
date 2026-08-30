'use client';

import dynamic from 'next/dynamic';

import { useNotebookStore } from '@/store/notebookStore';
import { shouldMountNotebook } from './notebookVisibility';

const Notebook = dynamic(() => import('./Notebook'));

const LazyNotebook = ({ isPinned }: { isPinned: boolean }) => {
  const { isNotebookVisible } = useNotebookStore();

  return shouldMountNotebook(isNotebookVisible, isPinned) ? <Notebook /> : null;
};

export default LazyNotebook;
