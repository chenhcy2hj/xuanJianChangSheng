/**
 * 下载触发器：接口 + 两个实现（设计文档 §2 触发/执行分离）。
 * - InstantTrigger：单 P 页面，单击图标后台立即下载（arm 清空 popup → onClicked 生效）
 * - PopupTrigger：多 P 页面，单击图标打开 popup（arm 挂 popup.html），勾选后由消息驱动下载
 */
import { fetchAudioStream, BiliError, type BiliErrorCode, type VideoPage } from './lib/bilibili';
import { downloadAudio, notify } from './lib/download';
import { filenameFor } from './lib/naming';

export interface DownloadTrigger {
  readonly name: string;
  matches(page: VideoPage): boolean;
  /** 页面进入时装配：决定单击图标的形态（动态 setPopup） */
  arm(page: VideoPage): void;
  /** 触发时执行下载；partIndexes 由 popup 提供（缺省 = 当前 P） */
  fire(page: VideoPage, partIndexes?: number[]): Promise<void>;
}

const ERROR_MESSAGES: Record<BiliErrorCode, string> = {
  auth: 'Cookie 失效或未登录，请确认登录后重试',
  'rate-limit': '触发风控（412），请稍后再试',
  'not-found': '未找到音频流或视频不存在',
  network: '网络请求失败，请检查网络',
  unknown: '未知错误，请重试',
};

function messageFor(err: unknown): string {
  if (err instanceof BiliError) return ERROR_MESSAGES[err.code];
  return ERROR_MESSAGES.unknown;
}

/** 单个分P 的完整下载：playurl → 命名 → 落地 → 通知 */
export async function downloadPart(page: VideoPage, index: number): Promise<void> {
  const part = page.parts[index];
  if (!part) {
    notify('下载失败', `分P ${index + 1} 不存在`);
    return;
  }
  try {
    const stream = await fetchAudioStream(page.bvid, part.cid);
    const filename = filenameFor(page.title, page.parts.length, part.index);
    await downloadAudio({ url: stream.url, backupUrl: stream.backupUrl, mimeType: stream.mimeType, filename });
    notify('下载完成', filename);
  } catch (err) {
    notify('下载失败', messageFor(err));
  }
}

export const instantTrigger: DownloadTrigger = {
  name: 'instant',
  matches: (page) => page.parts.length === 1,
  arm: () => {
    void chrome.action.setPopup({ popup: '' });
  },
  fire: (page) => downloadPart(page, page.currentP - 1),
};

export const popupTrigger: DownloadTrigger = {
  name: 'popup',
  matches: (page) => page.parts.length > 1,
  arm: () => {
    void chrome.action.setPopup({ popup: 'popup.html' });
  },
  fire: async (page, partIndexes) => {
    const indexes = partIndexes && partIndexes.length > 0 ? partIndexes : [page.currentP - 1];
    for (const index of indexes) {
      await downloadPart(page, index);
    }
  },
};

export function resolveTrigger(page: VideoPage): DownloadTrigger {
  return popupTrigger.matches(page) ? popupTrigger : instantTrigger;
}