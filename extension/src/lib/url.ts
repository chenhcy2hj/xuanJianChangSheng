/**
 * URL / 页面识别（纯函数，无副作用，可单测）。
 * 与后端 BilibiliParser 保持一致：BV 后必须 10 位。
 */

export interface PageInfo {
  bvid: string;
  /** 当前分P（1-based；缺失或非法取 1） */
  p: number;
}

const BV_RE = /^BV[0-9A-Za-z]{10}$/;

/** 仅识别 bilibili.com/video/BVxxx 普通视频页；其余返回 null */
export function parseVideoUrl(rawUrl: string): PageInfo | null {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    return null;
  }
  if (u.hostname !== 'www.bilibili.com' && u.hostname !== 'bilibili.com') return null;
  // BV 后必须紧跟 / 或 ?（防 11 位误匹配）
  const m = u.pathname.match(/^\/video\/(BV[0-9A-Za-z]{10})(?:\/|$)/);
  if (!m) return null;
  const raw = u.searchParams.get('p');
  const p = raw ? parseInt(raw, 10) : 1;
  return { bvid: m[1], p: Number.isFinite(p) && p >= 1 ? p : 1 };
}

/** 断言是合法 BV 号（配合 parseVideoUrl 使用） */
export function isBvid(value: string): boolean {
  return BV_RE.test(value);
}

/** 清理 B 站页面标题后缀 */
export function cleanTitle(title: string): string {
  return title.replace(/_哔哩哔哩_bilibili\s*$/, '').trim();
}