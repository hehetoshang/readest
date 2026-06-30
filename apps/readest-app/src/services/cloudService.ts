import { AppService, FileSystem, BaseDir, DeleteAction } from '@/types/system';
import { Book } from '@/types/book';
import { getDir, getCoverFilename } from '@/utils/book';
import { resolveBookContentSource } from './bookContent';
import { ProgressHandler } from '@/utils/transfer';

// Cloud upload/download functions are stubbed out (auth/cloud sync removed).
// TODO: Restore when talebook server sync is connected.

export async function deleteBook(
  fs: FileSystem,
  book: Book,
  deleteAction: DeleteAction,
): Promise<void> {
  if (deleteAction === 'local' || deleteAction === 'both' || deleteAction === 'purge') {
    const source = await resolveBookContentSource(fs, book);
    if (source.kind === 'managed' && deleteAction !== 'purge') {
      if (await fs.exists(source.path, source.base)) {
        await fs.removeFile(source.path, source.base);
      }
    }
    if (deleteAction === 'purge') {
      const dir = getDir(book);
      if (await fs.exists(dir, 'Books')) {
        await fs.removeDir(dir, 'Books', true);
      }
    }
    if (deleteAction === 'both' && (await fs.exists(getCoverFilename(book), 'Books'))) {
      await fs.removeFile(getCoverFilename(book), 'Books');
    }
    if (deleteAction === 'local' || deleteAction === 'purge') {
      book.downloadedAt = null;
    } else {
      book.deletedAt = Date.now();
      book.downloadedAt = null;
      book.coverDownloadedAt = null;
    }
  }
  if ((deleteAction === 'cloud' || deleteAction === 'both') && book.uploadedAt) {
    book.uploadedAt = null;
  }
}

// Stub: cloud upload removed. TODO: connect to talebook server.
export async function uploadFileToCloud(
  _fs: FileSystem,
  _resolveFilePath: (path: string, base: BaseDir) => Promise<string>,
  _lfp: string,
  _cfp: string,
  _base: BaseDir,
  _handleProgress: ProgressHandler,
  _hash: string,
  _temp = false,
): Promise<string | undefined> {
  return undefined;
}

// Stub: cloud upload removed. TODO: connect to talebook server.
export async function uploadReplicaFileToCloud(
  _fs: FileSystem,
  _resolveFilePath: (path: string, base: BaseDir) => Promise<string>,
  _opts: {
    kind: string;
    replicaId: string;
    filename: string;
    lfp: string;
    base: BaseDir;
    onProgress: ProgressHandler;
  },
): Promise<void> {}

export const replicaCloudKey = (kind: string, replicaId: string, filename: string): string =>
  `replicas/${kind}/${replicaId}/${filename}`;

// Stub: cloud download removed. TODO: connect to talebook server.
export async function downloadReplicaFileFromCloud(
  _appService: AppService,
  _opts: {
    kind: string;
    replicaId: string;
    filename: string;
    dst: string;
    onProgress?: ProgressHandler;
  },
): Promise<void> {}

// Stub: cloud delete removed. TODO: connect to talebook server.
export async function deleteReplicaBundleFromCloud(
  _kind: string,
  _replicaId: string,
  _filenames: string[],
): Promise<void> {}

// Stub: cloud upload removed. TODO: connect to talebook server.
export async function uploadBook(
  _fs: FileSystem,
  _resolveFilePath: (path: string, base: BaseDir) => Promise<string>,
  _book: Book,
  _onProgress?: ProgressHandler,
): Promise<void> {}

// Stub: cloud upload removed. TODO: connect to talebook server.
export async function uploadBookCover(
  _fs: FileSystem,
  _resolveFilePath: (path: string, base: BaseDir) => Promise<string>,
  _book: Book,
  _onProgress?: ProgressHandler,
): Promise<void> {}

// Stub: cloud download removed. TODO: connect to talebook server.
export async function downloadCloudFile(
  _appService: AppService,
  _localBooksDir: string,
  _lfp: string,
  _cfp: string,
  _onProgress: ProgressHandler,
): Promise<void> {}

// Stub: cloud download removed. TODO: connect to talebook server.
export async function downloadBookCovers(
  _appService: AppService,
  _fs: FileSystem,
  _localBooksDir: string,
  _books: Book[],
): Promise<void> {}

// Stub: cloud download removed. TODO: connect to talebook server.
export async function downloadBook(
  _appService: AppService,
  _fs: FileSystem,
  _localBooksDir: string,
  _book: Book,
  _onlyCover = false,
  _redownload = false,
  _onProgress?: ProgressHandler,
): Promise<void> {}
