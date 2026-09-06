/**
 * 登录态判定：仅读 SESSDATA 是否存在（v1 简化，见设计文档 §5.2）。
 * 只读不写，cookie 不落盘。
 */
export async function isLoggedIn(): Promise<boolean> {
  try {
    const cookie = await chrome.cookies.get({ url: 'https://www.bilibili.com', name: 'SESSDATA' });
    return !!cookie?.value;
  } catch {
    return false;
  }
}