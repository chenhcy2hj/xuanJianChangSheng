/**
 * WBI 签名（纯函数，无副作用，可单测）。
 * 参考 B 站 web 端 2023-07 后强制签名算法：
 *   img_key/sub_key 来自 nav 接口 → mixin_key 重排 → 参数排序编码 + wts → md5。
 */

/** 轮移位量（RFC 1321） */
const S: number[] = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
  5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];

/** 正弦常量（RFC 1321） */
const K: number[] = [
  0xd76aa478, 0xe8c7b756, 0x242070db, 0xc1bdceee, 0xf57c0faf, 0x4787c62a, 0xa8304613, 0xfd469501,
  0x698098d8, 0x8b44f7af, 0xffff5bb1, 0x895cd7be, 0x6b901122, 0xfd987193, 0xa679438e, 0x49b40821,
  0xf61e2562, 0xc040b340, 0x265e5a51, 0xe9b6c7aa, 0xd62f105d, 0x02441453, 0xd8a1e681, 0xe7d3fbc8,
  0x21e1cde6, 0xc33707d6, 0xf4d50d87, 0x455a14ed, 0xa9e3e905, 0xfcefa3f8, 0x676f02d9, 0x8d2a4c8a,
  0xfffa3942, 0x8771f681, 0x6d9d6122, 0xfde5380c, 0xa4beea44, 0x4bdecfa9, 0xf6bb4b60, 0xbebfbc70,
  0x289b7ec6, 0xeaa127fa, 0xd4ef3085, 0x04881d05, 0xd9d4d039, 0xe6db99e5, 0x1fa27cf8, 0xc4ac5665,
  0xf4292244, 0x432aff97, 0xab9423a7, 0xfc93a039, 0x655b59c3, 0x8f0ccc92, 0xffeff47d, 0x85845dd1,
  0x6fa87e4f, 0xfe2ce6e0, 0xa3014314, 0x4e0811a1, 0xf7537e82, 0xbd3af235, 0x2ad7d2bb, 0xeb86d391,
];

/** 计算字符串的 MD5（十六进制小写）。RFC 1321 标准实现，无外部依赖。 */
export function md5(input: string): string {
  const bytes = new TextEncoder().encode(input);
  const bitLen = bytes.length * 8;
  // 填充后总长 = ceil64(原长 + 1字节0x80 + 8字节长度)，须 ≥ 原长+9
  const padded = new Uint8Array((bytes.length + 9 + 63) & ~63);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, bitLen >>> 0, true);
  view.setUint32(padded.length - 4, Math.floor(bitLen / 0x100000000), true);

  let a = 0x67452301;
  let b = 0xefcdab89;
  let c = 0x98badcfe;
  let d = 0x10325476;

  for (let off = 0; off < padded.length; off += 64) {
    const x = new Uint32Array(16);
    for (let i = 0; i < 16; i++) x[i] = view.getUint32(off + i * 4, true);
    let A = a;
    let B = b;
    let C = c;
    let D = d;
    for (let i = 0; i < 64; i++) {
      let f: number;
      let g: number;
      if (i < 16) {
        f = (B & C) | (~B & D);
        g = i;
      } else if (i < 32) {
        f = (D & B) | (~D & C);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        f = B ^ C ^ D;
        g = (3 * i + 5) % 16;
      } else {
        f = C ^ (B | ~D);
        g = (7 * i) % 16;
      }
      f = (f + A + K[i] + x[g]) | 0;
      A = D;
      D = C;
      C = B;
      B = (B + ((f << S[i]) | (f >>> (32 - S[i])))) | 0;
    }
    a = (a + A) | 0;
    b = (b + B) | 0;
    c = (c + C) | 0;
    d = (d + D) | 0;
  }
  return toHex(a) + toHex(b) + toHex(c) + toHex(d);
}

function toHex(n: number): string {
  // MD5 摘要按 32 位字的小端字节序输出
  let out = '';
  for (let i = 0; i < 4; i++) {
    out += ((n >>> (i * 8)) & 0xff).toString(16).padStart(2, '0');
  }
  return out;
}

/** 官方混淆表：按 img_key+sub_key 的字符索引重排 */
export const MIXIN_KEY_ENC_TAB: number[] = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49,
  33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61,
  26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52,
];

/** img_key + sub_key → 32 位 mixin_key */
export function getMixinKey(imgKey: string, subKey: string): string {
  const raw = imgKey + subKey;
  return MIXIN_KEY_ENC_TAB.map((i) => raw[i] ?? '').join('').slice(0, 32);
}

/** 与官方一致的参数值编码：encodeURIComponent 后剔除 !'()* */
function encodeValue(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, '');
}

/**
 * WBI 签名：追加 wts 时间戳 → 按 key 字典序 → 官方编码 → 拼接 md5。
 * 返回含 wts/w_rid 的完整参数表，**值为编码后结果**，可直接拼 query 使用。
 */
export function wbiSign(
  params: Record<string, string | number>,
  imgKey: string,
  subKey: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): Record<string, string> {
  const merged: Record<string, string> = {};
  for (const [k, v] of Object.entries(params)) merged[k] = encodeValue(String(v));
  merged.wts = String(nowSeconds);
  const query = Object.keys(merged)
    .sort()
    .map((k) => `${k}=${merged[k]}`)
    .join('&');
  merged.w_rid = md5(query + getMixinKey(imgKey, subKey));
  return merged;
}