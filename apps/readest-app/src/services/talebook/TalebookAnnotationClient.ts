import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { isTauriAppPlatform } from '@/services/environment';
import type { TalebookSettings } from '@/types/settings';

export const TALEBOOK_ANNOTATION_CONTRACT = 'talebook.annotations.v2';

export type TalebookAnnotationType = 'highlight' | 'note' | 'bookmark' | 'chapter_comment';

export interface TalebookAnnotationSource {
  id: number;
  source_name: string;
  source_connection_id: string;
  source_annotation_id: string | null;
  source_run_id: string | null;
  source_position: string | null;
  source_raw_hash: string | null;
  source_updated_at: string | null;
  source_sync_status: 'pending' | 'synced' | 'failed';
  source_synced_at: string | null;
  source_sync_error: string | null;
}

export interface TalebookAnnotation {
  id: number;
  book_id: number;
  client_id: string | null;
  annotation_type: TalebookAnnotationType;
  is_private: boolean;
  cfi: string | null;
  chapter: string;
  quote_text: string;
  content: string;
  color: string;
  author_name: string;
  user_modified_at: string | null;
  created_at: string | null;
  updated_at: string | null;
  sources: TalebookAnnotationSource[];
}

export interface TalebookAnnotationInput {
  annotation_type: Exclude<TalebookAnnotationType, 'chapter_comment'>;
  client_id: string;
  is_private: boolean;
  cfi: string | null;
  chapter: string;
  quote_text: string;
  content: string;
  color: string;
  source_name: 'readest';
  source_connection_id: string;
  source_annotation_id: string;
  source_position: string | null;
  source_raw_hash: string;
  source_updated_at: string;
}

interface ApiEnvelope {
  err: string;
  msg?: string;
}

interface AnnotationListResponse extends ApiEnvelope {
  annotations: TalebookAnnotation[];
}

interface AnnotationUpsertResponse extends ApiEnvelope {
  annotation: TalebookAnnotation;
  created: boolean;
  stale_ignored: boolean;
  conflict_protected: boolean;
  sync_enqueued: boolean;
}

interface AnnotationExportResponse extends ApiEnvelope {
  export: {
    schema: string;
    annotations: TalebookAnnotation[];
  };
}

export type TalebookSyncErrorKind =
  | 'offline'
  | 'authentication'
  | 'permission'
  | 'rate_limit'
  | 'incompatible'
  | 'server'
  | 'unknown';

export class TalebookSyncError extends Error {
  constructor(
    message: string,
    public readonly kind: TalebookSyncErrorKind,
    public readonly retryable: boolean,
    public readonly status?: number,
    public readonly code?: string,
  ) {
    super(message);
    this.name = 'TalebookSyncError';
  }
}

type FetchFn = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

interface TalebookClientOptions {
  fetchFn?: FetchFn;
  retryDelaysMs?: number[];
}

const wait = (delayMs: number) => new Promise((resolve) => setTimeout(resolve, delayMs));

const encodeBasicCredential = (username: string, token: string): string => {
  const bytes = new TextEncoder().encode(`${username}:${token}`);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
};

const errorForStatus = (status: number, message: string): TalebookSyncError => {
  if (status === 401 || status === 403) {
    return new TalebookSyncError(message, 'authentication', false, status);
  }
  if (status === 429) return new TalebookSyncError(message, 'rate_limit', true, status);
  if (status >= 500) return new TalebookSyncError(message, 'server', true, status);
  return new TalebookSyncError(message, 'unknown', false, status);
};

const errorForEnvelope = (envelope: ApiEnvelope): TalebookSyncError => {
  const message = envelope.msg || envelope.err || 'Talebook request failed';
  if (envelope.err === 'user.need_login') {
    return new TalebookSyncError(message, 'authentication', false, undefined, envelope.err);
  }
  if (envelope.err === 'params.book.invalid') {
    return new TalebookSyncError(message, 'permission', false, undefined, envelope.err);
  }
  if (envelope.err === 'params.invalid') {
    return new TalebookSyncError(message, 'incompatible', false, undefined, envelope.err);
  }
  if (envelope.err === 'exception') {
    return new TalebookSyncError(message, 'server', true, undefined, envelope.err);
  }
  return new TalebookSyncError(message, 'unknown', false, undefined, envelope.err);
};

export class TalebookAnnotationClient {
  private readonly fetchFn: FetchFn;
  private readonly retryDelaysMs: number[];

  constructor(
    private readonly config: TalebookSettings,
    options: TalebookClientOptions = {},
  ) {
    this.fetchFn =
      options.fetchFn ??
      ((isTauriAppPlatform() ? tauriFetch : globalThis.fetch.bind(globalThis)) as FetchFn);
    this.retryDelaysMs = options.retryDelaysMs ?? [300, 1200];
  }

  get connectionId(): string {
    return this.config.connectionId;
  }

  private get baseUrl(): string {
    return this.config.serverUrl.trim().replace(/\/+$/, '');
  }

  private async request<T extends ApiEnvelope>(endpoint: string, init?: RequestInit): Promise<T> {
    let lastError: TalebookSyncError | null = null;
    for (let attempt = 0; attempt <= this.retryDelaysMs.length; attempt += 1) {
      try {
        const response = await this.fetchFn(`${this.baseUrl}${endpoint}`, {
          ...init,
          credentials: 'include',
          headers: {
            Accept: 'application/json',
            Authorization: `Basic ${encodeBasicCredential(this.config.username, this.config.accessToken)}`,
            ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
            ...init?.headers,
          },
        });
        if (!response.ok) {
          const error = errorForStatus(response.status, `Talebook HTTP ${response.status}`);
          if (!error.retryable || attempt === this.retryDelaysMs.length) throw error;
          lastError = error;
        } else {
          let envelope: T;
          try {
            envelope = (await response.json()) as T;
          } catch {
            throw new TalebookSyncError(
              'Talebook returned an unsupported response',
              'incompatible',
              false,
              response.status,
            );
          }
          if (!envelope || typeof envelope.err !== 'string') {
            throw new TalebookSyncError(
              'Talebook annotation contract is incompatible',
              'incompatible',
              false,
              response.status,
            );
          }
          if (envelope.err !== 'ok') throw errorForEnvelope(envelope);
          return envelope;
        }
      } catch (error) {
        const normalized =
          error instanceof TalebookSyncError
            ? error
            : new TalebookSyncError(
                error instanceof Error ? error.message : 'Talebook is offline',
                'offline',
                true,
              );
        if (!normalized.retryable || attempt === this.retryDelaysMs.length) throw normalized;
        lastError = normalized;
      }
      await wait(this.retryDelaysMs[attempt] ?? 0);
    }
    throw lastError ?? new TalebookSyncError('Talebook request failed', 'unknown', false);
  }

  async validateConnection(): Promise<void> {
    const response = await this.request<AnnotationExportResponse>(
      `/api/annotations/export?source_name=readest&source_connection_id=${encodeURIComponent(this.connectionId)}`,
    );
    if (response.export?.schema !== TALEBOOK_ANNOTATION_CONTRACT) {
      throw new TalebookSyncError(
        `Expected ${TALEBOOK_ANNOTATION_CONTRACT}, received ${response.export?.schema || 'unknown'}`,
        'incompatible',
        false,
      );
    }
  }

  async listAnnotations(bookId: number): Promise<TalebookAnnotation[]> {
    const response = await this.request<AnnotationListResponse>(`/api/book/${bookId}/annotations`);
    if (!Array.isArray(response.annotations)) {
      throw new TalebookSyncError(
        'Talebook annotation list is incompatible',
        'incompatible',
        false,
      );
    }
    return response.annotations;
  }

  async upsertAnnotation(
    bookId: number,
    annotation: TalebookAnnotationInput,
  ): Promise<TalebookAnnotation> {
    const response = await this.request<AnnotationUpsertResponse>(
      `/api/book/${bookId}/annotations`,
      { method: 'POST', body: JSON.stringify(annotation) },
    );
    if (!response.annotation || typeof response.annotation.id !== 'number') {
      throw new TalebookSyncError(
        'Talebook annotation upsert is incompatible',
        'incompatible',
        false,
      );
    }
    return response.annotation;
  }
}
