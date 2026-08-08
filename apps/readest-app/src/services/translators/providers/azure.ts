import { stubTranslation as _ } from '@/utils/misc';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { isTauriAppPlatform } from '@/services/environment';
import { TranslationProvider } from '../types';
import { normalizeToFullLang, normalizeToShortLang } from '@/utils/lang';

const EDGE_TRANSLATE_ENDPOINT = 'https://edge.microsoft.com/translate/translatetext';
// The endpoint rejects requests without an Edge-flavored UA / Origin.
const EDGE_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0';

/**
 * Free Microsoft translation via the Edge browser's translation endpoint.
 * Unlike the old `edge.microsoft.com/translate/auth` anonymous token flow
 * (which Microsoft has since closed — returns 404), `translatetext` needs no
 * token at all: POST a JSON array of strings and each item comes back as
 * `data[i].translations[0].text`. Omitting `from` makes it auto-detect the
 * source language (the endpoint rejects "auto" as an explicit value).
 */
export const azureProvider: TranslationProvider = {
  name: 'azure',
  label: _('Azure Translator'),
  translate: async (text: string[], sourceLang: string, targetLang: string): Promise<string[]> => {
    if (!text.length) return [];

    const params = new URLSearchParams({ to: normalizeToFullLang(targetLang) });
    const source = sourceLang ? normalizeToShortLang(sourceLang) : '';
    if (source && source.toLowerCase() !== 'auto') {
      params.append('from', source);
    }

    const fetch = isTauriAppPlatform() ? tauriFetch : window.fetch;
    const response = await fetch(`${EDGE_TRANSLATE_ENDPOINT}?${params.toString()}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': EDGE_UA,
        Origin: 'https://www.microsoft.com',
      },
      body: JSON.stringify(text),
    });

    if (!response.ok) {
      throw new Error(`Translation failed with status ${response.status}`);
    }

    const data = await response.json();
    if (Array.isArray(data)) {
      return text.map((line, index) => {
        if (!line?.trim().length) return line;
        return data[index]?.translations?.[0]?.text || line;
      });
    }
    return text;
  },
};
