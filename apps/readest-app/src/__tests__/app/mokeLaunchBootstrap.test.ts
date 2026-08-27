import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';

const layoutSource = readFileSync(resolve(process.cwd(), 'src/app/layout.tsx'), 'utf-8');

describe('Moke launch bootstrap', () => {
  it('executes directly while the document head is parsed', () => {
    expect(layoutSource).toMatch(
      /<script\s+id='moke-launch-context'\s+dangerouslySetInnerHTML=\{\{ __html: mokeLaunchContextScript \}\}\s*\/>/,
    );
    expect(layoutSource).not.toMatch(/<Script\s+id='moke-launch-context'/);
  });
});
