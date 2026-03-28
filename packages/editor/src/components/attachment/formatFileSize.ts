export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1);
  const n = bytes / k ** i;
  const rounded = i === 0 ? n : Math.round(n * 10) / 10;
  return `${rounded} ${sizes[i]}`;
}
