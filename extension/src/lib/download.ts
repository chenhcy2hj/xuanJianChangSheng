/**
 * 下载落地与通知：
 * 直链 fetch（带 B 站 Referer 防防盗链）→ blob → chrome.downloads（uniquify 去重）。
 * 412 重试 2 次，随后换 backupUrl 重试 1 次；音频文件 20~80MB，整体缓冲可接受（见设计文档 §5.2 内存取舍）。
 */

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface DownloadTarget {
  url: string;
  backupUrl?: string;
  mimeType: string;
  filename: string;
}

async function fetchBlobWithRetry(target: DownloadTarget): Promise<Blob> {
  const attempts: Array<{ url: string; waitMs: number }> = target.backupUrl
    ? [
        { url: target.url, waitMs: 0 },
        { url: target.url, waitMs: 1000 },
        { url: target.backupUrl, waitMs: 3000 },
      ]
    : [
        { url: target.url, waitMs: 0 },
        { url: target.url, waitMs: 1000 },
        { url: target.url, waitMs: 3000 },
      ];
  let lastErr: unknown;
  for (const attempt of attempts) {
    if (attempt.waitMs > 0) await sleep(attempt.waitMs);
    try {
      const res = await fetch(attempt.url, {
        referrer: 'https://www.bilibili.com/',
        referrerPolicy: 'unsafe-url',
        credentials: 'include',
      });
      if (res.status === 412) {
        lastErr = Object.assign(new Error('HTTP 412'), { complain: 'rate-limit' });
        continue;
      }
      if (!res.ok) {
        lastErr = new Error(`HTTP ${res.status}`);
        continue;
      }
      return new Blob([await res.arrayBuffer()], { type: target.mimeType });
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

export async function downloadAudio(target: DownloadTarget): Promise<void> {
  const blob = await fetchBlobWithRetry(target);
  const objectUrl = URL.createObjectURL(blob);
  try {
    await chrome.downloads.download({
      url: objectUrl,
      filename: target.filename,
      conflictAction: 'uniquify',
    });
  } finally {
    setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
  }
}

let notifySeq = 0;

export function notify(title: string, message: string): void {
  void chrome.notifications.create(`biliaudio-${++notifySeq}`, {
    type: 'basic',
    iconUrl: chrome.runtime.getURL('icons/128.png'),
    title,
    message,
  });
}