/* Where a dropped file lives on disk. Electron 32 removed `File.path`, so the
   preload exposes `webUtils.getPathForFile`; the old property is only a
   fallback for older runtimes and test doubles. Empty when neither answers. */
export function droppedFilePath(file: File): string {
  try {
    const viaBridge = window.mcServerManager?.getPathForFile?.(file);
    if (viaBridge) return viaBridge;
  } catch {
    /* fall through to the legacy property */
  }
  return (file as File & { path?: string }).path ?? "";
}
