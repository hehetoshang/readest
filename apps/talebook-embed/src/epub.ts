import { BlobReader, BlobWriter, TextWriter, ZipReader, configure } from '@zip.js/zip.js';
import { EPUB } from 'foliate-js/epub.js';

export async function openEpub(url: string) {
  const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store' });
  if (!response.ok) throw new Error(`EPUB resource failed (${response.status})`);
  const mime = response.headers.get('content-type')?.split(';', 1)[0];
  if (mime !== 'application/epub+zip')
    throw new Error(`Unexpected EPUB MIME type: ${mime ?? 'missing'}`);
  const blob = await response.blob();
  configure({ useWebWorkers: false });
  const reader = new ZipReader(new BlobReader(blob));
  const entries = await reader.getEntries();
  const byName = new Map(entries.map((entry) => [entry.filename, entry]));
  const loader = {
    entries,
    loadText: (name: string) => {
      const entry = byName.get(name);
      return entry && 'getData' in entry ? entry.getData(new TextWriter()) : null;
    },
    loadBlob: (name: string, type?: string) => {
      const entry = byName.get(name);
      return entry && 'getData' in entry ? entry.getData(new BlobWriter(type)) : null;
    },
    getSize: (name: string) => byName.get(name)?.uncompressedSize ?? 0,
  };
  return new EPUB(loader).init();
}
