import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';

const rustSource = readFileSync(resolve(process.cwd(), 'src-tauri/src/lib.rs'), 'utf-8');
const embeddedHandler =
  rustSource.match(
    /pub fn reader_invoke_handler[\s\S]*?tauri::generate_handler!\[(?<commands>[\s\S]*?)\n\s*\]\n}/,
  )?.groups?.['commands'] ?? '';
const embeddedState =
  rustSource.match(/pub fn manage_reader_state\(app: &AppHandle\) \{(?<body>[\s\S]*?)\n}/)
    ?.groups?.['body'] ?? '';

const LOCALSEND_COMMANDS = [
  'localsend_start',
  'localsend_stop',
  'localsend_get_status',
  'localsend_list_devices',
  'localsend_announce',
  'localsend_respond',
  'localsend_cancel_receive',
  'localsend_send_files',
  'localsend_cancel_send',
] as const;

describe('embedded host command parity', () => {
  it('exposes every LocalSend command used by the reader frontend', () => {
    for (const command of LOCALSEND_COMMANDS) {
      expect(embeddedHandler).toContain(`localsend::commands::${command}`);
    }
  });

  it('initializes LocalSend state for embedded hosts', () => {
    expect(embeddedState).toContain('app.manage(localsend::LocalSendState::default())');
  });
});
