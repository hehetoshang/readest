import { describe, expect, it, vi } from 'vitest';
import type { Book, BookNote } from '@/types/book';
import type { TalebookSettings } from '@/types/settings';
import {
  TALEBOOK_ANNOTATION_CONTRACT,
  TalebookAnnotationClient,
  mergeTalebookAnnotations,
  resolveTalebookBookId,
  syncTalebookBookNotes,
  type TalebookAnnotation,
} from '@/services/talebook';

const settings: TalebookSettings = {
  enabled: true,
  serverUrl: 'https://books.example.test/',
  username: 'reader',
  accessToken: 'secret',
  connectionId: 'readest-device-1',
  autoSync: true,
  privateByDefault: true,
  lastSyncedAt: 0,
  bookIds: { hash1: 42 },
};

const annotation = (overrides: Partial<TalebookAnnotation> = {}): TalebookAnnotation => ({
  id: 7,
  book_id: 42,
  client_id: null,
  annotation_type: 'highlight',
  is_private: true,
  cfi: null,
  chapter: 'Chapter 3',
  quote_text: 'quoted text',
  content: 'remote note',
  color: 'yellow',
  author_name: '',
  user_modified_at: null,
  created_at: '2026-08-15T10:00:00Z',
  updated_at: '2026-08-15T10:00:00Z',
  sources: [
    {
      id: 8,
      source_name: 'weread',
      source_connection_id: 'weread-1',
      source_annotation_id: 'remote-7',
      source_run_id: 'run-1',
      source_position: 'chapter:3',
      source_raw_hash: 'hash',
      source_updated_at: '2026-08-15T10:00:00Z',
      source_sync_status: 'synced',
      source_synced_at: '2026-08-15T10:00:00Z',
      source_sync_error: null,
    },
  ],
  ...overrides,
});

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

describe('TalebookAnnotationClient', () => {
  it('validates the v2 contract and sends Basic credentials without putting them in the URL', async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      jsonResponse({
        err: 'ok',
        export: { schema: TALEBOOK_ANNOTATION_CONTRACT, annotations: [] },
      }),
    );
    const client = new TalebookAnnotationClient(settings, { fetchFn, retryDelaysMs: [] });

    await client.validateConnection();

    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toContain('/api/annotations/export?source_name=readest');
    expect(url).not.toContain('secret');
    expect((init.headers as Record<string, string>)['Authorization']).toMatch(/^Basic /);
  });

  it('classifies an expired login and does not retry it', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(jsonResponse({ err: 'user.need_login', msg: 'login required' }));
    const client = new TalebookAnnotationClient(settings, {
      fetchFn,
      retryDelaysMs: [0, 0],
    });

    await expect(client.listAnnotations(42)).rejects.toMatchObject({
      kind: 'authentication',
      retryable: false,
    });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('rejects an incompatible annotation schema', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ err: 'ok', export: { schema: 'talebook.annotations.v1', annotations: [] } }),
      );
    const client = new TalebookAnnotationClient(settings, { fetchFn, retryDelaysMs: [] });

    await expect(client.validateConnection()).rejects.toMatchObject({ kind: 'incompatible' });
  });

  it('retries a transient offline request', async () => {
    const fetchFn = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('offline'))
      .mockResolvedValueOnce(jsonResponse({ err: 'ok', annotations: [] }));
    const client = new TalebookAnnotationClient(settings, { fetchFn, retryDelaysMs: [0] });

    await expect(client.listAnnotations(42)).resolves.toEqual([]);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });
});

describe('Talebook annotation mapping and sync', () => {
  it('keeps a chapter-only external note visible and marks it read-only', () => {
    const merged = mergeTalebookAnnotations([], [annotation()], settings.connectionId);

    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      id: 'talebook:7',
      cfi: '',
      note: 'remote note',
      source: {
        name: 'weread',
        chapter: 'Chapter 3',
        degraded: true,
        readOnly: true,
        contract: TALEBOOK_ANNOTATION_CONTRACT,
      },
    });
  });

  it('shows the original source while allowing edits owned by this Readest connection', () => {
    const ownSource = {
      ...annotation().sources[0]!,
      source_name: 'readest',
      source_connection_id: settings.connectionId,
      source_annotation_id: 'local-note-7',
    };
    const merged = mergeTalebookAnnotations(
      [],
      [annotation({ sources: [ownSource, annotation().sources[0]!] })],
      settings.connectionId,
    );

    expect(merged[0]).toMatchObject({
      id: 'local-note-7',
      source: { name: 'weread', readOnly: false },
    });
  });

  it('repeated sync reuses source_annotation_id and never duplicates or deletes', async () => {
    const local: BookNote = {
      id: 'local-note-1',
      type: 'annotation',
      cfi: 'epubcfi(/6/4!/4/2)',
      text: 'quote',
      color: 'yellow',
      style: 'highlight',
      note: 'note',
      createdAt: Date.parse('2026-08-15T09:00:00Z'),
      updatedAt: Date.parse('2026-08-15T09:00:00Z'),
    };
    const saved = annotation({
      client_id: 'local-note-1',
      cfi: local.cfi,
      quote_text: local.text!,
      content: local.note,
      sources: [
        {
          ...annotation().sources[0]!,
          source_name: 'readest',
          source_connection_id: settings.connectionId,
          source_annotation_id: local.id,
        },
      ],
    });
    const client = {
      connectionId: settings.connectionId,
      listAnnotations: vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([saved]),
      upsertAnnotation: vi.fn().mockResolvedValue(saved),
    } as unknown as TalebookAnnotationClient;
    const first = await syncTalebookBookNotes(client, 42, [local], settings);
    const second = await syncTalebookBookNotes(client, 42, first.booknotes, settings);

    expect(first.booknotes).toHaveLength(1);
    expect(second.booknotes).toHaveLength(1);
    expect(second.booknotes[0]?.id).toBe(local.id);
    expect(client.upsertAnnotation).toHaveBeenCalledTimes(2);
    const payload = vi.mocked(client.upsertAnnotation).mock.calls[0]?.[1];
    expect(payload).toMatchObject({
      client_id: local.id,
      source_name: 'readest',
      source_connection_id: settings.connectionId,
      source_annotation_id: local.id,
    });
  });

  it('does not resurrect a local tombstone or send a remote delete', async () => {
    const tombstone: BookNote = {
      id: 'talebook:7',
      type: 'annotation',
      cfi: '',
      note: 'kept tombstone',
      createdAt: 1,
      updatedAt: 2,
      deletedAt: 3,
    };
    const client = {
      connectionId: settings.connectionId,
      listAnnotations: vi.fn().mockResolvedValue([annotation()]),
      upsertAnnotation: vi.fn(),
    } as unknown as TalebookAnnotationClient;

    const result = await syncTalebookBookNotes(client, 42, [tombstone], settings);

    expect(result.booknotes[0]?.deletedAt).toBe(3);
    expect(client.upsertAnnotation).not.toHaveBeenCalled();
  });

  it('keeps successful items when one upsert fails so a later run can retry it', async () => {
    const notes: BookNote[] = [
      {
        id: 'one',
        type: 'annotation',
        cfi: 'epubcfi(/6/2!/4/2)',
        text: 'one',
        note: '',
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: 'two',
        type: 'bookmark',
        cfi: 'epubcfi(/6/4!/4/2)',
        note: '',
        createdAt: 2,
        updatedAt: 2,
      },
    ];
    const saved = annotation({
      sources: [
        {
          ...annotation().sources[0]!,
          source_name: 'readest',
          source_connection_id: settings.connectionId,
          source_annotation_id: 'one',
        },
      ],
    });
    const client = {
      connectionId: settings.connectionId,
      listAnnotations: vi.fn().mockResolvedValue([]),
      upsertAnnotation: vi
        .fn()
        .mockResolvedValueOnce(saved)
        .mockRejectedValueOnce(new Error('429')),
    } as unknown as TalebookAnnotationClient;

    const result = await syncTalebookBookNotes(client, 42, notes, settings);

    expect(result.pushed).toBe(1);
    expect(result.failures).toEqual([{ noteId: 'two', message: '429' }]);
    expect(result.booknotes).toHaveLength(2);
  });

  it('resolves an explicit mapping before a same-origin Talebook URL', () => {
    expect(resolveTalebookBookId({ hash: 'hash1' } as Book, settings)).toBe(42);
    expect(
      resolveTalebookBookId(
        { hash: 'other', url: 'https://books.example.test/api/book/99/file' } as Book,
        settings,
      ),
    ).toBe(99);
  });
});
