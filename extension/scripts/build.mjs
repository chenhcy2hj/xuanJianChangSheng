/**
 * 构建脚本：清空 dist → tsc 编译（src/ → dist/）。
 * manifest.json / popup.html / icons/ 位于扩展根，由 manifest 直接引用 dist/*.js。
 */
import { execSync } from 'node:child_process';
import { rmSync } from 'node:fs';

rmSync('dist', { recursive: true, force: true });
execSync('npx tsc -p tsconfig.json', { stdio: 'inherit' });
console.log('build ok: dist/');