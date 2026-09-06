/**
 * 内容脚本（页面识别器）：识别 bilibili.com/video/BVxxx 页面并上报。
 * SPA 切分P 会更新 URL（?p=n），监听 history 变化后重报（400ms 节流）。
 */
import { parseVideoUrl } from './lib/url';

let lastKey = '';
let timer: number | undefined;

function report(): void {
  const info = parseVideoUrl(location.href);
  if (!info) return;
  const key = `${info.bvid}:${info.p}`;
  if (key === lastKey) return;
  lastKey = key;
  void chrome.runtime.sendMessage({ type: 'PAGE_INFO', url: location.href });
}

function schedule(): void {
  window.clearTimeout(timer);
  timer = window.setTimeout(report, 400);
}

report();
window.addEventListener('popstate', schedule);

const pushState = history.pushState.bind(history);
history.pushState = (...args: Parameters<typeof history.pushState>) => {
  pushState(...args);
  schedule();
};
const replaceState = history.replaceState.bind(history);
history.replaceState = (...args: Parameters<typeof history.replaceState>) => {
  replaceState(...args);
  schedule();
};