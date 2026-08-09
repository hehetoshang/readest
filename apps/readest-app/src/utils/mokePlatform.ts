/**
 * Resolve the runtime platform for the Moke-hosted single-WebView flows.
 *
 * `moke_runtime_platform` (the native probe) is authoritative. When it fails
 * (older backend / abnormal IPC), `@tauri-apps/plugin-os` reports OHOS as
 * `linux` because the Rust target uses `target_os = "linux"` — so a `linux`
 * fallback combined with an ArkWeb/OpenHarmony user agent must still route to
 * the single-WebView reader flow instead of the desktop `open_reader` command
 * (which is not registered on OHOS).
 */
export function resolveMokeRuntimePlatform(
  probe: string | null,
  pluginPlatform: string,
  userAgent: string,
): string {
  if (probe) return probe;
  if (pluginPlatform === 'linux' && /OpenHarmony|ArkWeb/i.test(userAgent)) return 'ohos';
  return pluginPlatform;
}
