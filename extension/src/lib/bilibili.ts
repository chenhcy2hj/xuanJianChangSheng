/**
 * B 站接口封装：nav（WBI 密钥）/ view（分P 列表）/ playurl（音频直链）。
 * 仅 IO：请求重试与错误分类在此，签名算法在 wbi.ts（纯函数）。
 */
import { wbiSign } from './wbi';
import { sleep } from './download';

export type BiliErrorCode = 'auth' | 'rate-limit' | 'not-found' | 'network' | 'unknown';

export class BiliError extends Error {
  constructor(
    readonly code: BiliErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'BiliError';
  }
}

export interface VideoPart {
  /** B 站 page 编号（1-based） */
  index: number;
  cid: number;
  part: string;
  duration: number;
}

export interface VideoPage {
  bvid: string;
  title: string;
  parts: VideoPart[];
  /** 当前分P（1-based） */
  currentP: number;
}

export interface AudioStream {
  url: string;
  backupUrl?: string;
  mimeType: string;
}

const INIT: RequestInit = { credentials: 'include' };

async function getJson(url: string, retries = 2): Promise<{ code: number; message: string; data?: any }> {
  let lastErr: BiliError = new BiliError('network', 'unknown');
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await sleep(attempt * 1000);
    try {
      const res = await fetch(url, INIT);
      if (res.status === 412) {
        lastErr = new BiliError('rate-limit', 'HTTP 412');
        continue;
      }
      if (!res.ok) {
        lastErr = new BiliError('network', `HTTP ${res.status}`);
        continue;
      }
      return (await res.json()) as { code: number; message: string; data?: any };
    } catch (err) {
      lastErr = new BiliError('network', String(err));
    }
  }
  throw lastErr;
}

/** 从 nav 接口取 WBI 密钥（img_key/sub_key 取文件名去扩展名） */
export async function fetchWbiKeys(): Promise<{ imgKey: string; subKey: string }> {
  const json = await getJson('https://api.bilibili.com/x/web-interface/nav');
  const wbi = json?.data?.wbi_img;
  const imgKey = wbi?.img_url ? basename(wbi.img_url) : null;
  const subKey = wbi?.sub_url ? basename(wbi.sub_url) : null;
  if (!imgKey || !subKey) throw new BiliError('unknown', '获取 WBI 密钥失败');
  return { imgKey, subKey };
}

function basename(path: string): string {
  const i = path.lastIndexOf('/');
  return (i >= 0 ? path.slice(i + 1) : path).replace(/\.[^.]+$/, '');
}

/** view API：标题 + 全部分P */
export async function fetchVideoPage(bvid: string, p: number): Promise<VideoPage> {
  const json = await getJson(`https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`);
  if (json.code !== 0) {
    throw new BiliError(json.code === -404 ? 'not-found' : 'unknown', `view API code=${json.code}`);
  }
  const data = json.data;
  const parts: VideoPart[] = (data?.pages ?? []).map((pg: any, i: number) => ({
    index: typeof pg.page === 'number' ? pg.page : i + 1,
    cid: Number(pg.cid),
    part: String(pg.part ?? `P${pg.page ?? i + 1}`),
    duration: Number(pg.duration) || 0,
  }));
  if (parts.length === 0) throw new BiliError('not-found', '未获取到分P数据');
  const currentP = Math.min(Math.max(Number(p) || 1, 1), parts.length);
  return { bvid, title: String(data?.title ?? bvid), parts, currentP };
}

/** playurl API（WBI 签名）：取最高带宽音频直链 */
export async function fetchAudioStream(bvid: string, cid: number): Promise<AudioStream> {
  const { imgKey, subKey } = await fetchWbiKeys();
  const signed = wbiSign(
    { bvid, cid: String(cid), fnval: '16', fnver: '0', fourk: '1', platform: 'html5' },
    imgKey,
    subKey,
  );
  const query = Object.entries(signed)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
  const json = await getJson(`https://api.bilibili.com/x/player/playurl?${query}`);
  if (json.code !== 0) {
    const code = Number(json.code);
    throw new BiliError(
      code === -101 ? 'auth' : code === -412 ? 'rate-limit' : code === -404 ? 'not-found' : 'unknown',
      `playurl API code=${json.code}`,
    );
  }
  const audio: any[] = json?.data?.dash?.audio;
  if (!Array.isArray(audio) || audio.length === 0) throw new BiliError('not-found', '未找到音频流');
  const best = audio.reduce((a, b) => (Number(b.bandwidth) > Number(a.bandwidth) ? b : a));
  const url: string | undefined = best?.baseUrl;
  if (!url) throw new BiliError('not-found', '音频流无直链');
  return {
    url,
    backupUrl: Array.isArray(best.backupUrl) ? best.backupUrl[0] : undefined,
    mimeType: String(best.mimeType ?? 'audio/mp4'),
  };
}