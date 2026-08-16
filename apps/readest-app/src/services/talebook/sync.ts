import type { Book, BookNote } from '@/types/book';
import type { TalebookSettings } from '@/types/settings';
import { md5 } from '@/utils/md5';
import {
  TALEBOOK_ANNOTATION_CONTRACT,
  TalebookAnnotationClient,
  type TalebookAnnotation,
  type TalebookAnnotationInput,
} from './TalebookAnnotationClient';

export interface TalebookItemFailure {
  noteId: string;
  message: string;
}

export interface TalebookBookSyncResult {
  booknotes: BookNote[];
  pulled: number;
  pushed: number;
  failures: TalebookItemFailure[];
}

const timestamp = (value: string | null, fallback: number): number => {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
};

const sourceLabel = (name: string): string => {
  if (name === 'readest') return 'Readest';
  if (name === 'calibre') return 'Calibre';
  if (name === 'weread') return '微信读书';
  if (name === 'brs') return 'BRS';
  return name || 'Talebook';
};

export const talebookAnnotationToBookNote = (
  annotation: TalebookAnnotation,
  connectionId: string,
): BookNote => {
  const ownSource = annotation.sources.find(
    (source) => source.source_name === 'readest' && source.source_connection_id === connectionId,
  );
  const displaySource =
    annotation.sources.find((source) => source.source_name !== 'readest') ??
    ownSource ??
    annotation.sources[0];
  const cfi = annotation.cfi ?? '';
  const updatedAt = timestamp(annotation.updated_at, Date.now());
  return {
    id: ownSource?.source_annotation_id || `talebook:${annotation.id}`,
    type: annotation.annotation_type === 'bookmark' ? 'bookmark' : 'annotation',
    cfi,
    text: annotation.quote_text || undefined,
    style: annotation.annotation_type === 'highlight' ? 'highlight' : undefined,
    color: annotation.color || undefined,
    note: annotation.content || '',
    createdAt: timestamp(annotation.created_at, updatedAt),
    updatedAt,
    source: {
      name: displaySource?.source_name || 'talebook',
      displayName: sourceLabel(displaySource?.source_name || 'talebook'),
      connectionId: displaySource?.source_connection_id || undefined,
      externalId: displaySource?.source_annotation_id || undefined,
      position: displaySource?.source_position || undefined,
      chapter: annotation.chapter || undefined,
      authorName: annotation.author_name || undefined,
      talebookAnnotationId: annotation.id,
      contract: TALEBOOK_ANNOTATION_CONTRACT,
      syncStatus: displaySource?.source_sync_status,
      syncError: displaySource?.source_sync_error || undefined,
      isPrivate: annotation.is_private,
      readOnly: !ownSource,
      degraded: !cfi,
    },
  };
};

export const mergeTalebookAnnotations = (
  localNotes: BookNote[],
  remoteAnnotations: TalebookAnnotation[],
  connectionId: string,
): BookNote[] => {
  const merged = new Map(localNotes.map((note) => [note.id, { ...note }]));
  for (const annotation of remoteAnnotations) {
    const remote = talebookAnnotationToBookNote(annotation, connectionId);
    const existing =
      merged.get(remote.id) ??
      [...merged.values()].find((note) => note.source?.talebookAnnotationId === annotation.id);
    if (existing?.deletedAt) continue;
    if (existing && !existing.source?.readOnly && existing.updatedAt > remote.updatedAt) {
      merged.set(existing.id, { ...existing, source: remote.source });
      continue;
    }
    if (existing && existing.id !== remote.id) merged.delete(existing.id);
    merged.set(remote.id, { ...existing, ...remote });
  }
  return [...merged.values()];
};

const stableClientId = (note: BookNote): string =>
  note.id.length <= 64 ? note.id : `readest-${md5(note.id)}`;

export const bookNoteToTalebookInput = (
  note: BookNote,
  settings: TalebookSettings,
): TalebookAnnotationInput => {
  const annotationType = note.type === 'bookmark' ? 'bookmark' : note.text ? 'highlight' : 'note';
  const sourcePosition =
    note.cfi || note.source?.position || (note.page ? `page:${note.page}` : null);
  const contentHash = md5(
    JSON.stringify([
      annotationType,
      note.cfi,
      note.source?.chapter,
      note.text,
      note.note,
      note.color,
      note.updatedAt,
    ]),
  );
  return {
    annotation_type: annotationType,
    client_id: stableClientId(note),
    is_private: note.source?.isPrivate ?? settings.privateByDefault,
    cfi: note.cfi || null,
    chapter: note.source?.chapter || '',
    quote_text: note.text || '',
    content: note.note || '',
    color: note.color || '',
    source_name: 'readest',
    source_connection_id: settings.connectionId,
    source_annotation_id: note.id,
    source_position: sourcePosition,
    source_raw_hash: contentHash,
    source_updated_at: new Date(note.updatedAt).toISOString(),
  };
};

export const resolveTalebookBookId = (book: Book, settings: TalebookSettings): number | null => {
  const configured = settings.bookIds?.[book.hash];
  if (typeof configured === 'number' && Number.isInteger(configured) && configured > 0) {
    return configured;
  }
  if (!book.url) return null;
  try {
    const url = new URL(book.url, settings.serverUrl);
    const server = new URL(settings.serverUrl);
    if (url.origin !== server.origin) return null;
    const match = url.pathname.match(/\/(?:api\/)?book\/(\d+)(?:\/|$)/);
    return match ? Number(match[1]) : null;
  } catch {
    return null;
  }
};

export const syncTalebookBookNotes = async (
  client: TalebookAnnotationClient,
  bookId: number,
  localNotes: BookNote[],
  settings: TalebookSettings,
): Promise<TalebookBookSyncResult> => {
  const remote = await client.listAnnotations(bookId);
  let booknotes = mergeTalebookAnnotations(localNotes, remote, client.connectionId);
  const candidates = booknotes.filter(
    (note) => !note.deletedAt && !note.source?.readOnly && note.type !== 'excerpt',
  );
  const failures: TalebookItemFailure[] = [];
  let pushed = 0;

  for (const note of candidates) {
    try {
      const saved = await client.upsertAnnotation(bookId, bookNoteToTalebookInput(note, settings));
      booknotes = mergeTalebookAnnotations(booknotes, [saved], client.connectionId);
      pushed += 1;
    } catch (error) {
      failures.push({
        noteId: note.id,
        message: error instanceof Error ? error.message : 'Talebook sync failed',
      });
    }
  }

  return { booknotes, pulled: remote.length, pushed, failures };
};
