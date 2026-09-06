import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { MIXIN_KEY_ENC_TAB, getMixinKey, md5, wbiSign } from '../src/lib/wbi';

describe('md5（与 node:crypto 对拍）', () => {
  const cases = ['', 'abc', 'The quick brown fox jumps over the lazy dog', 'wbi 签名测试', 'a'.repeat(1000)];
  for (const input of cases) {
    it(`md5(${JSON.stringify(input.slice(0, 32))}...)`, () => {
      const expected = createHash('md5').update(input, 'utf8').digest('hex');
      expect(md5(input)).toBe(expected);
    });
  }
});

describe('MIXIN_KEY_ENC_TAB', () => {
  it('长度为 64 且索引在 0..63', () => {
    expect(MIXIN_KEY_ENC_TAB).toHaveLength(64);
    expect(Math.max(...MIXIN_KEY_ENC_TAB)).toBeLessThan(64);
    expect(new Set(MIXIN_KEY_ENC_TAB).size).toBe(64);
  });
});

describe('getMixinKey（与社区已知向量对拍）', () => {
  it('img_key 7cd084941338484aae1ad9425b84077c + sub_key 4932caff0ff746eab6f01bf08b70ac45 → ea1db124af3c7062474693fa704f4ff8', () => {
    const key = getMixinKey('7cd084941338484aae1ad9425b84077c', '4932caff0ff746eab6f01bf08b70ac45');
    expect(key).toBe('ea1db124af3c7062474693fa704f4ff8');
  });
});

describe('wbiSign', () => {
  const imgKey = '7cd084941338484aae1ad9425b84077c';
  const subKey = '4932caff0ff746eab6f01bf08b70ac45';

  it('输出包含 wts 与 32 位 hex 的 w_rid', () => {
    const out = wbiSign({ bvid: 'BV1JRuA6vEvd', cid: '12345' }, imgKey, subKey, 1700000000);
    expect(out.wts).toBe('1700000000');
    expect(out.w_rid).toMatch(/^[0-9a-f]{32}$/);
  });

  it('同一输入确定性一致', () => {
    const a = wbiSign({ bvid: 'BV1JRuA6vEvd', cid: '12345', fnval: '16' }, imgKey, subKey, 1700000000);
    const b = wbiSign({ bvid: 'BV1JRuA6vEvd', cid: '12345', fnval: '16' }, imgKey, subKey, 1700000000);
    expect(a).toEqual(b);
  });

  it('参数按 key 字典序参与签名（w_rid 与手算一致）', () => {
    const out = wbiSign({ z: '1', a: '2', m: '3' }, imgKey, subKey, 1700000000);
    const query = 'a=2&m=3&wts=1700000000&z=1';
    const expected = md5(query + getMixinKey(imgKey, subKey));
    expect(out.w_rid).toBe(expected);
  });

  it('参数值中的 !\'()* 被剔除（官方编码规则）', () => {
    const out = wbiSign({ name: "it's (a) test!" }, imgKey, subKey, 1700000000);
    // 编码后不应出现这些字符（! ' ( ) *）
    expect(out.name).toMatch(/[\w%]+/);
    expect(out.name).not.toMatch(/[!'()*]/);
  });

  it('wts 参与签名：时间不同则 w_rid 不同', () => {
    const a = wbiSign({ bvid: 'BV1JRuA6vEvd' }, imgKey, subKey, 1700000000);
    const b = wbiSign({ bvid: 'BV1JRuA6vEvd' }, imgKey, subKey, 1700000001);
    expect(a.w_rid).not.toBe(b.w_rid);
  });
});