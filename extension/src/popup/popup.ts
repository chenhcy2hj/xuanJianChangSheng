/**
 * popup：分P 列表（默认勾选当前播放 P）/ 未登录确认（?mode=confirm）。
 */
import type { VideoPage } from '../lib/bilibili';

interface PopupData {
  ok: boolean;
  page: VideoPage | null;
  loggedIn: boolean;
}

const app = document.getElementById('app')!;

function el(html: string): HTMLElement {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild as HTMLElement;
}

function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(sec).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

const mode = new URLSearchParams(location.search).get('mode');

if (mode === 'confirm') {
  app.appendChild(
    el(
      '<h1>未登录</h1>' +
        '<p class="muted">将以未登录身份下载，音频为低音质档，是否继续？</p>' +
        '<div class="row"><button class="ghost" id="cancel">取消</button>' +
        '<button class="primary" id="confirm">继续下载</button></div>',
    ),
  );
  document.getElementById('confirm')!.addEventListener('click', () => {
    void chrome.runtime.sendMessage({ type: 'CONFIRM_LOGGED_OUT' });
    window.close();
  });
  document.getElementById('cancel')!.addEventListener('click', () => {
    void chrome.runtime.sendMessage({ type: 'CANCEL_LOGGED_OUT' });
    window.close();
  });
} else {
  void init();
}

async function init(): Promise<void> {
  const resp = (await chrome.runtime.sendMessage({ type: 'POPUP_READY' })) as PopupData;
  if (!resp?.ok || !resp.page) {
    app.appendChild(el('<p class="muted center">请先打开 B 站视频页（video/BVxxx）再试</p>'));
    return;
  }
  const { page, loggedIn } = resp;

  const h = document.createElement('h1');
  h.textContent = page.title;
  h.title = page.title;
  app.appendChild(h);

  if (!loggedIn) app.appendChild(el('<div class="warn">未登录，将下载低音质</div>'));

  const ul = document.createElement('ul');
  ul.className = 'parts';
  const checks: HTMLInputElement[] = [];
  for (const part of page.parts) {
    const li = el(
      `<li><input type="checkbox" ${part.index === page.currentP ? 'checked' : ''}>` +
        '<span class="name"></span><span class="dur"></span></li>',
    ) as HTMLLIElement;
    const input = li.querySelector('input')!;
    (li.querySelector('.name') as HTMLElement).textContent =
      page.parts.length > 1 ? `P${part.index} ${part.part}` : part.part;
    (li.querySelector('.dur') as HTMLElement).textContent = formatDuration(part.duration);
    checks.push(input);
    ul.appendChild(li);
  }
  app.appendChild(ul);

  const btn = document.createElement('button');
  btn.className = 'action';
  const selectedCount = () => checks.filter((c) => c.checked).length;
  const refreshLabel = () => (btn.textContent = `下载勾选的音频（${selectedCount()}）`);
  refreshLabel();
  ul.addEventListener('change', refreshLabel);

  btn.addEventListener('click', () => {
    const indexes = checks.flatMap((c, i) => (c.checked ? [i] : []));
    if (indexes.length === 0) return;
    if (!loggedIn && !window.confirm('未登录，将下载低音质，确认继续？')) return;
    btn.disabled = true;
    btn.textContent = '已开始下载，可关闭本窗口';
    void chrome.runtime.sendMessage({ type: 'DOWNLOAD_PARTS', partIndexes: indexes });
    window.setTimeout(() => window.close(), 800);
  });
  app.appendChild(btn);
}