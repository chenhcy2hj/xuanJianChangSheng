/**
 * 构建脚本：清空 dist → esbuild 打包三个入口为单文件（IIFE，无 import）。
 * 背景：MV3 content script 不支持 ES module，service worker 未声明 type:module
 * 时也不支持——必须消除源码 import（bundle 内联）。
 * manifest.json / popup.html / icons/ 位于扩展根，引用 dist/*.js。
 */
import { rmSync } from 'node:fs';
import { build } from 'esbuild';

rmSync('dist', { recursive: true, force: true });

await build({
  entryPoints: ['src/background.ts', 'src/content.ts', 'src/popup/popup.ts'],
  bundle: true,
  format: 'iife',
  target: 'es2022',
  outdir: 'dist',
  outbase: 'src',
  logLevel: 'info',
});

console.log('build ok: dist/');