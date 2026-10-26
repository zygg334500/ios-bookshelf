export type ImportAttempt = {
  name: string;
  ok: boolean;
  format?: string;
  error?: string;
};

/** Chinese summary for a batch of imports. One failure does not hide the books that landed. */
export function summarizeImports(attempts: ImportAttempt[]): string {
  const placed = attempts.filter((item) => item.ok);
  const failed = attempts.filter((item) => !item.ok);
  if (placed.length === 0 && failed.length === 0) return '没有选择文件。';
  const parts: string[] = [];
  if (placed.length > 0) {
    const azw3 = placed.filter((item) => item.format === 'azw3').length;
    parts.push(`已放入 ${placed.length} 本。`);
    if (azw3 > 0) parts.push(`其中 ${azw3} 本无 DRM 的 AZW3 可以打开阅读。`);
  }
  if (failed.length > 0) {
    const detail = failed.map((item) => `《${item.name}》：${item.error || '导入失败。'}`).join(' ');
    parts.push(`${failed.length} 本没有放上书架。${detail}`);
  }
  return parts.join('');
}

export function shelfCountLabel(count: number): string {
  if (count <= 0) return '架上还没有书。';
  return `架上 ${count} 本。点封面打开，点「移出」再点一次确认拿走。`;
}
