export function formatBytes(sizeBytes: number) {
  if (sizeBytes < 1024) {
    return `${sizeBytes} B`;
  }
  if (sizeBytes < 1024 ** 2) {
    return `${(sizeBytes / 1024).toFixed(1)} KB`;
  }
  if (sizeBytes < 1024 ** 3) {
    return `${(sizeBytes / 1024 ** 2).toFixed(1)} MB`;
  }
  return `${(sizeBytes / 1024 ** 3).toFixed(1)} GB`;
}
