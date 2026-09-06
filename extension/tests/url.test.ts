import { describe, expect, it } from 'vitest';
import { cleanTitle, parseVideoUrl } from '../src/lib/url';

describe('parseVideoUrl', () => {
  it('标准视频页（带尾斜杠）', () => {
    expect(parseVideoUrl('https://www.bilibili.com/video/BV1JRuA6vEvd/')).toEqual({ bvid: 'BV1JRuA6vEvd', p: 1 });
  });

  it('标准视频页（无尾斜杠，带 ?p=2）', () => {
    expect(parseVideoUrl('https://www.bilibili.com/video/BV1hk4y1W76R?p=2')).toEqual({ bvid: 'BV1hk4y1W76R', p: 2 });
  });

  it('bm 域名等价', () => {
    expect(parseVideoUrl('https://bilibili.com/video/BV1Z8h36gEnp')).toEqual({ bvid: 'BV1Z8h36gEnp', p: 1 });
  });

  it('BV 号后必须 10 位（11 位拒绝）', () => {
    expect(parseVideoUrl('https://www.bilibili.com/video/BV1JRuA6vEvdX')).toBeNull();
  });

  it('非 video 路径拒绝', () => {
    expect(parseVideoUrl('https://www.bilibili.com/bangumi/play/ep123')).toBeNull();
  });

  it('站外域名拒绝', () => {
    expect(parseVideoUrl('https://example.com/video/BV1JRuA6vEvd')).toBeNull();
  });

  it('非法 URL 返回 null', () => {
    expect(parseVideoUrl('not a url')).toBeNull();
  });

  it('p 非法值兜底为 1', () => {
    expect(parseVideoUrl('https://www.bilibili.com/video/BV1JRuA6vEvd?p=abc')).toEqual({ bvid: 'BV1JRuA6vEvd', p: 1 });
    expect(parseVideoUrl('https://www.bilibili.com/video/BV1JRuA6vEvd?p=0')).toEqual({ bvid: 'BV1JRuA6vEvd', p: 1 });
  });
});

describe('cleanTitle', () => {
  it('去掉 B 站标题后缀', () => {
    expect(cleanTitle('测试视频_哔哩哔哩_bilibili')).toBe('测试视频');
  });

  it('无后缀原样返回', () => {
    expect(cleanTitle('测试视频')).toBe('测试视频');
  });
});