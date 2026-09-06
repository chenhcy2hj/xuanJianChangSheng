import { describe, expect, it } from 'vitest';
import { filenameFor, sanitizeFilename } from '../src/lib/naming';

describe('sanitizeFilename', () => {
  it('替换非法字符为下划线', () => {
    expect(sanitizeFilename('a/b\\c:d*e?f"g<h>i|j')).toBe('a_b_c_d_e_f_g_h_i_j');
  });

  it('清理空格并 trim', () => {
    expect(sanitizeFilename('  多个   空格  ')).toBe('多个 空格');
  });

  it('空标题兜底 audio', () => {
    expect(sanitizeFilename('')).toBe('audio');
    expect(sanitizeFilename('   ')).toBe('audio');
  });
});

describe('filenameFor', () => {
  it('单 P：标题.m4a', () => {
    expect(filenameFor('测试视频', 1, 1)).toBe('测试视频.m4a');
  });

  it('多 P：标题-P{n}.m4a（用 B 站 page 编号）', () => {
    expect(filenameFor('测试视频', 3, 2)).toBe('测试视频-P2.m4a');
  });

  it('非法字符在多 P 命名中同样被清洗', () => {
    expect(filenameFor('a/b', 2, 1)).toBe('a_b-P1.m4a');
  });

  it('超长标题保留扩展名截断 ≤150', () => {
    const long = '长'.repeat(200);
    const name = filenameFor(long, 1, 1);
    expect(name.endsWith('.m4a')).toBe(true);
    expect(name.length).toBeLessThanOrEqual(150);
  });
});