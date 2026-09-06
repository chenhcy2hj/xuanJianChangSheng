/**
 * 后台总控（MV3 service worker）：
 * PAGE_INFO → view API 补全分P → 缓存 → trigger.arm 装配单击形态
 * onClicked / 快捷键 → 登录守卫 → trigger.fire
 * popup 消息 → 分P 下载 / 未登录确认
 */
import { fetchVideoPage, type VideoPage } from './lib/bilibili';
import { isLoggedIn } from './lib/cookies';
import { notify } from './lib/download';
import { parseVideoUrl } from './lib/url';
import { resolveTrigger } from './trigger';

const pageCache = new Map<number, VideoPage>();
const CACHE_MAX = 20;
let pendingDownload: (() => Promise<void>) | null = null;

function cachePage(tabId: number, page: VideoPage): void {
  if (pageCache.size >= CACHE_MAX) {
    const oldest = pageCache.keys().next().value;
    if (oldest !== undefined) pageCache.delete(oldest);
  }
  pageCache.set(tabId, page);
  resolveTrigger(page).arm(page);
}

chrome.runtime.onMessage.addListener((msg: any, sender, sendResponse) => {
  switch (msg?.type) {
    case 'PAGE_INFO': {
      const tabId = sender.tab?.id;
      if (tabId == null) {
        sendResponse({ ok: false });
        return;
      }
      const info = parseVideoUrl(String(msg.url ?? ''));
      if (!info) {
        sendResponse({ ok: false });
        return;
      }
      const cached = pageCache.get(tabId);
      if (cached?.bvid === info.bvid && cached.currentP === info.p) {
        sendResponse({ ok: true });
        return;
      }
      void (async () => {
        try {
          const page = await fetchVideoPage(info.bvid, info.p);
          cachePage(tabId, page);
          sendResponse({ ok: true });
        } catch (err) {
          sendResponse({ ok: false, error: String(err) });
        }
      })();
      return true; // 异步 sendResponse
    }
    case 'POPUP_READY': {
      void (async () => {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        const page = tab?.id != null ? pageCache.get(tab.id) : undefined;
        sendResponse({ ok: true, page: page ?? null, loggedIn: await isLoggedIn() });
      })();
      return true;
    }
    case 'DOWNLOAD_PARTS': {
      void (async () => {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        const page = tab?.id != null ? pageCache.get(tab.id) : undefined;
        if (!page) {
          sendResponse({ ok: false });
          return;
        }
        await resolveTrigger(page).fire(page, (msg.partIndexes ?? []) as number[]);
        sendResponse({ ok: true });
      })();
      return true;
    }
    case 'CONFIRM_LOGGED_OUT': {
      const run = pendingDownload;
      pendingDownload = null;
      void run?.();
      sendResponse({ ok: true });
      return;
    }
    case 'CANCEL_LOGGED_OUT': {
      pendingDownload = null;
      sendResponse({ ok: true });
      return;
    }
  }
  return false;
});

chrome.action.onClicked.addListener((tab) => {
  void onUserTrigger(tab);
});

chrome.commands.onCommand.addListener((command) => {
  if (command !== 'download-current') return;
  void chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
    if (tab) void onUserTrigger(tab);
  });
});

/** 单击/快捷键统一入口：登录守卫 + 未登录确认挂起 */
async function onUserTrigger(tab: chrome.tabs.Tab): Promise<void> {
  const page = tab.id != null ? pageCache.get(tab.id) : undefined;
  if (!page) {
    notify('无法识别', '仅支持 bilibili.com/video/ 视频页');
    return;
  }
  const trigger = resolveTrigger(page);
  if (await isLoggedIn()) {
    await trigger.fire(page);
    return;
  }
  pendingDownload = () => trigger.fire(page);
  await chrome.windows.create({
    url: chrome.runtime.getURL('popup.html?mode=confirm'),
    type: 'popup',
    width: 380,
    height: 240,
    focused: true,
  });
}