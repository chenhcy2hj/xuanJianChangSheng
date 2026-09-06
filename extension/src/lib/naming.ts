/**
 * 文件名生成与非法字符清理（纯函数，无副作用，可单测）。
 * 规则：单 P 用 `标题.m4a`；多 P 用 `标题-P{n}.m4a`；非法字符替换为 `_`；
 * 保留扩展名截断总长 ≤ 150；重名去重交给 chrome.downloads conflictAction: uniquify。
 */

export const INVALID_CHARS = /[\\/:*?"<>|\r\n\t]/g;

export function sanitizeFilename(name: string): string {
  const cleaned = name.replace(INVALID_CHARS, '_').replace(/\s+/g, ' ').trim();
  return cleaned === '' ? 'audio' : cleaned;
}

export function filenameFor(title: string, totalParts: number, partIndex: number, ext = 'm4a'): string {
  const base = totalParts > 1 ? `${sanitizeFilename(title)}-P${partIndex}` : sanitizeFilename(title);
  const maxBase = Math.max(1, 150 - (ext.length + 1));
  const truncated = base.length > maxBase ? base.slice(0, maxBase) : base;
  return `${truncated}.${ext}`;
}