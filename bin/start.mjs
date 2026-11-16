#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { spawnSync } from 'node:child_process';

const input = createInterface({ input: process.stdin, output: process.stdout });
const lines = input[Symbol.asyncIterator]();
const ask = async prompt => {
  process.stdout.write(prompt);
  const answer = await lines.next();
  if (answer.done) throw new Error('输入已结束');
  return answer.value.trim();
};
const cli = path.join(path.dirname(fileURLToPath(import.meta.url)), 'studio.mjs');
try {
  console.log('Agent Studio · 本地项目助手\n');
  const answer = (await ask('项目文件夹（已有项目或新文件夹的完整路径）：')).replace(/^["']|["']$/g, '');
  if (!answer) throw new Error('需要输入项目文件夹');
  const root = path.resolve(answer.replace(/^~(?=[/\\]|$)/, os.homedir()));
  let existing = root;
  while (!fs.existsSync(path.join(existing, '.studio/state.json')) && !fs.existsSync(path.join(existing, '.studio')) && path.dirname(existing) !== existing) existing = path.dirname(existing);
  let args, cwd;
  if (fs.existsSync(path.join(existing, '.studio/state.json'))) {
    args = [cli, 'resume']; cwd = existing;
  } else {
    const name = await ask(`项目名（回车使用 ${path.basename(root)}）：`) || path.basename(root);
    args = [cli, 'init', root, '--name', name]; cwd = process.cwd();
  }
  const result = spawnSync(process.execPath, args, { cwd, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exitCode = result.status || 1;
  else console.log('\n下一步：在你常用的编程 Agent 中打开上面显示的项目根目录。\n告诉它：“按 project-director 流程开始/继续项目。你负责分派，我负责提需求和验收。”');
} catch (error) {
  console.error(error.message); process.exitCode = 1;
} finally {
  if (process.stdin.isTTY) { process.stdout.write('\n按回车关闭。'); await lines.next(); }
  input.close();
}
