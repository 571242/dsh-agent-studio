import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import os from 'node:os';
import { gunzipSync } from 'node:zlib';

const legacy011 = gunzipSync(Buffer.from('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', 'base64'));
const legacy020 = gunzipSync(Buffer.from('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', 'base64'));

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(packageRoot, 'bin/studio.mjs');
const scratchBase = process.env.STUDIO_TEST_SCRATCH || path.join(packageRoot, '.scratch/repair-upgrade-20261109');
fs.mkdirSync(scratchBase, { recursive: true });
const scratch = fs.realpathSync(fs.mkdtempSync(path.join(scratchBase, 'cli-tests-')));
assert.ok(scratch.startsWith(fs.realpathSync(scratchBase) + path.sep));
call(scratch, ['init', scratch]);
assert.equal(call(scratch, ['resume']).root, scratch);
assert.ok(fs.statSync(path.join(scratch, '.studio/state.json')).isFile());
process.env.TEMP = process.env.TMP = path.join(scratch, 'tmp');
fs.mkdirSync(process.env.TEMP);
after(() => fs.rmSync(scratch, { recursive: true, force: true }));
// Incomplete Studio markers stop discovery; these real launcher cases need no outside aliases or mocks.
const launcherAlias = fs.mkdtempSync(path.join(scratch, 'launcher-isolation-'));
fs.mkdirSync(path.join(launcherAlias, '.studio'));
const task = (id, scope, dependsOn = []) => ({ id, title: id, description: `实现 ${id}`, scope, dependsOn, acceptance: ['实际测试通过'] });
function call(cwd, args, ok = true, executable = cli) {
  const result = spawnSync(process.execPath, [executable, ...args], { cwd, encoding: 'utf8' });
  assert.equal(result.status, ok ? 0 : 1, result.stderr + result.stdout);
  const parsed = JSON.parse(ok ? result.stdout : result.stderr);
  if (ok && args[0] === 'init') {
    assert.equal(parsed.project, fs.realpathSync(parsed.project));
    assert.ok(parsed.project === scratch || parsed.project.startsWith(scratch + path.sep));
    assert.ok(fs.statSync(path.join(parsed.project, '.studio/state.json')).isFile());
  }
  return parsed;
}
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(scratch, '项目 空格-'));
  after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const run = (args, ok = true) => call(dir, args, ok, path.join(dir, '.studio/studio.mjs'));
  const plan = tasks => {
    const file = path.join(dir, 'plan.json');
    fs.writeFileSync(file, JSON.stringify({ tasks }));
    return run(['plan', file]);
  };
  const finish = id => {
    run(['submit', id, '--summary', '已实现', '--evidence', 'node --test 通过']);
    run(['review', id, '--result', 'pass', '--reviewer', 'qa-' + id, '--evidence', '独立复测通过']);
  };
  call(dir, ['init', dir, '--name', '中文项目']);
  assert.equal(run(['resume']).root, fs.realpathSync(dir));
  return { dir, run, plan, finish };
}

function callAsync(cwd, args, executable = cli) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [executable, ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
}

test('init 保留项目规则并安装可独立使用的 CLI 和技能', t => {
  const dir = fs.mkdtempSync(path.join(scratch, 'init-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'AGENTS.md'), '# 原规则\n');
  call(dir, ['init', dir]);
  const rule = fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8');
  assert.ok(rule.startsWith('# 原规则\n'));
  assert.equal(rule.match(/<!-- agent-studio -->/g).length, 1);
  for (const host of ['.agents', '.claude']) assert.ok(fs.existsSync(path.join(dir, host, 'skills/project-director/SKILL.md')));
  call(dir, ['init', dir], false);
  const copied = path.join(dir, '.studio/studio.mjs');
  assert.equal(call(dir, ['resume'], true, copied).counts.todo, 0);
  const second = path.join(dir, 'another');
  call(dir, ['init', second], true, copied);
  assert.ok(fs.existsSync(path.join(second, '.studio/studio.mjs')));
});

test('已有同名技能时不覆盖、不产生半成品状态', t => {
  const dir = fs.mkdtempSync(path.join(scratch, 'existing-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const skill = path.join(dir, '.claude/skills/project-director');
  fs.mkdirSync(skill, { recursive: true });
  fs.writeFileSync(path.join(skill, 'SKILL.md'), '用户原技能');
  call(dir, ['init', dir], false);
  assert.equal(fs.existsSync(path.join(dir, '.studio')), false);
  assert.equal(fs.readFileSync(path.join(skill, 'SKILL.md'), 'utf8'), '用户原技能');
});

test('依赖与 scope 控制派工，只有验收后下游可开工', () => {
  const { dir, run, plan, finish } = fixture();
  fs.writeFileSync(path.join(dir, 'cfg.json'), JSON.stringify({ concurrency: 3 }));
  run(['config', path.join(dir, 'cfg.json')]);
  plan([task('a', ['src/a']), task('b', ['src/a/file.js']), task('c', ['docs']), task('d', ['tests'], ['a'])]);
  assert.deepEqual(run(['dispatch', '--limit', '2']).packets.map(p => p.task.id), ['a', 'c']);
  assert.equal(run(['dispatch', '--limit', '2']).packets.length, 0);
  run(['submit', 'a', '--summary', '实现', '--evidence', '单元测试通过']);
  assert.equal(run(['dispatch', '--limit', '2']).packets.length, 0);
  run(['review', 'a', '--result', 'pass', '--reviewer', 'qa', '--evidence', '复测通过']);
  assert.deepEqual(run(['dispatch', '--limit', '3']).packets.map(p => p.task.id), ['b', 'd']);
  finish('b'); finish('c'); finish('d');
  assert.equal(run(['doctor']).ok, true);
  assert.equal(run(['status']).counts.done, 4);
});

test('作用域比较覆盖 Windows 路径与大小写', () => {
  const { run, plan } = fixture();
  plan([task('a', ['Src\\Thing']), task('b', ['src/thing/file.js']), task('c', ['src/other'])]);
  assert.deepEqual(run(['dispatch', '--limit', '3']).packets.map(p => p.task.id), ['a', 'c']);
});

test('拒绝无效依赖、循环、重复任务和越界 scope，状态不变', () => {
  const { dir, run, plan } = fixture();
  plan([task('ok', ['src'])]);
  const file = path.join(dir, '.studio/state.json');
  const before = fs.readFileSync(file, 'utf8');
  const invalid = [
    [task('ok', ['other'])],
    [task('a', ['src'], ['missing'])],
    [task('a', ['a'], ['b']), task('b', ['b'], ['a'])],
    [task('a', ['../outside'])], [task('a', ['C:\\outside'])],
    [task('a', ['.studio/state.json'])], [task('a', ['AGENTS.md'])],
    [{ ...task('a', ['src']), acceptance: [] }],
  ];
  for (const tasks of invalid) {
    const input = path.join(dir, 'invalid.json');
    fs.writeFileSync(input, JSON.stringify({ tasks }));
    run(['plan', input], false);
    assert.equal(fs.readFileSync(file, 'utf8'), before);
  }
});

test('提交和评审有证据，失败可重新派工', () => {
  const { run, plan } = fixture();
  plan([task('a', ['src'])]);
  run(['review', 'a', '--result', 'pass', '--reviewer', 'qa', '--evidence', 'test'], false);
  run(['dispatch']);
  run(['submit', 'a', '--summary', '实现'], false);
  run(['submit', 'a', '--summary', '实现', '--evidence', '单测通过', '--evidence', '截图路径']);
  run(['review', 'a', '--result', 'pass', '--reviewer', 'worker-a', '--evidence', '自评'], false);
  const failed = run(['review', 'a', '--result', 'fail', '--reviewer', 'qa', '--evidence', '缺少空列表处理']);
  assert.equal(failed.status, 'todo');
  const packet = run(['dispatch']).packets[0];
  assert.equal(packet.task.review.result, 'fail');
  assert.match(packet.prompt, /空列表处理/);
});

test('暂停、只读恢复、解除暂停及释放中断任务', () => {
  const { dir, run, plan } = fixture();
  plan([task('a', ['src'])]); run(['dispatch']);
  run(['pause', '--note', 'commit abc123；src/a 写到一半；下一步补测试']);
  run(['dispatch'], false);
  const before = fs.readFileSync(path.join(dir, '.studio/state.json'), 'utf8');
  const resume = run(['resume']);
  assert.match(resume.handoff.note, /abc123/);
  assert.equal(resume.active[0].id, 'a');
  assert.equal(fs.readFileSync(path.join(dir, '.studio/state.json'), 'utf8'), before);
  run(['resume', '--continue']);
  assert.equal(run(['dispatch', '--limit', '1']).packets.length, 0);
  run(['release', 'a', '--note', '旧 worker 已停止；保留已写文件']);
  assert.equal(run(['dispatch']).packets[0].task.id, 'a');
});

test('重开功能会让下游重新验收，保留历史', () => {
  const { run, plan, finish } = fixture();
  plan([task('a', ['a']), task('b', ['b'], ['a']), task('c', ['c'], ['b'])]);
  run(['dispatch']); finish('a'); run(['dispatch']);
  run(['reopen', 'a', '--reason', '回归'], false);
  run(['release', 'b', '--note', '确认 worker 已停止']);
  assert.deepEqual(run(['reopen', 'a', '--reason', '回归']).reopened, ['a', 'b', 'c']);
  assert.equal(run(['show', 'a']).history.at(-1).action, 'reopened');
  assert.equal(run(['status']).counts.todo, 3);
});

test('修改需求会替换任务定义、保留历史并重开下游', () => {
  const { dir, run, plan, finish } = fixture();
  plan([task('a', ['a']), task('b', ['b'], ['a'])]);
  run(['dispatch']); finish('a'); run(['dispatch']); finish('b');
  const file = path.join(dir, 'revision.json');
  fs.writeFileSync(file, JSON.stringify({ ...task('a', ['new-a']), title: '新要求', acceptance: ['验证新要求'] }));
  run(['revise', 'a', file, '--reason', '用户调整玩法']);
  const updated = run(['show', 'a']);
  assert.equal(updated.title, '新要求');
  assert.equal(updated.history.find(h => h.action === 'revised').previous.title, 'a');
  assert.equal(run(['show', 'b']).status, 'todo');
  assert.match(run(['dispatch']).packets[0].prompt, /验证新要求/);
});

test('多个真实 CLI 进程同时反馈和派发，提交结果完整且 ID 唯一', async t => {
  const { dir, plan } = fixture(t);
  const copy = path.join(dir, '.studio/studio.mjs');
  const count = 24;
  const cfg = path.join(dir, 'cfg.json');
  fs.writeFileSync(cfg, JSON.stringify({ concurrency: 100 }));
  call(dir, ['config', cfg], true, copy);
  plan(Array.from({ length: count }, (_, i) => task(`concurrent-${i}`, [`src/${i}`])));
  const results = await Promise.all([
    ...Array.from({ length: count }, (_, i) => callAsync(dir, ['feedback', `反馈 ${i}`], i % 2 ? copy : cli)),
    ...Array.from({ length: count }, (_, i) => callAsync(dir, ['dispatch', '--limit', String(count)], i % 2 ? copy : cli)),
  ]);
  for (const result of results) assert.equal(result.code, 0, result.stderr);
  const feedback = results.slice(0, count).map(result => JSON.parse(result.stdout));
  const packets = results.slice(count).flatMap(result => JSON.parse(result.stdout).packets);
  const state = JSON.parse(fs.readFileSync(path.join(dir, '.studio/state.json'), 'utf8'));
  assert.equal(new Set(feedback.map(item => item.id)).size, count);
  assert.deepEqual(new Set(state.inbox.map(item => item.text)), new Set(feedback.map(item => item.text)));
  assert.equal(new Set(packets.map(packet => packet.task.id)).size, count);
  assert.equal(packets.length, count);
  assert.equal(state.tasks.filter(item => item.status === 'in_progress').length, count);
  assert.ok(state.tasks.every(item => item.history.filter(entry => entry.action === 'dispatched').length === 1));
});

test('等待活锁后拒写；异常和强制中止后可离线恢复且不破坏账本', async t => {
  const { dir, run } = fixture(t);
  const lock = path.join(dir, '.studio/state.json.lock');
  const file = path.join(dir, '.studio/state.json');
  const original = fs.readFileSync(file, 'utf8');
  const live = JSON.stringify({ host: os.hostname(), pid: process.pid, token: 'live' });
  fs.writeFileSync(lock, live, { flag: 'wx' });
  const conflict = await callAsync(dir, ['feedback', '不能覆盖']);
  assert.equal(conflict.code, 1, conflict.stderr);
  assert.match(JSON.parse(conflict.stderr).error, /账本锁被占用/);
  assert.equal(fs.readFileSync(lock, 'utf8'), live);
  assert.equal(fs.readFileSync(file, 'utf8'), original);
  fs.unlinkSync(lock);
  run(['feedback', ''], false);
  assert.equal(fs.existsSync(lock), false);
  assert.equal(fs.readFileSync(file, 'utf8'), original);

  const probe = 'const fs=require("node:fs");const lock=process.argv[1];fs.writeFileSync(lock,JSON.stringify({pid:process.pid}),{flag:"wx"});console.log("held");setInterval(()=>{},1000);';
  const holder = spawn(process.execPath, ['-e', probe, lock], { stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((resolve, reject) => {
    holder.once('error', reject);
    holder.stdout.once('data', resolve);
  });
  const stopped = new Promise(resolve => holder.once('close', resolve));
  holder.kill('SIGKILL');
  await stopped;
  assert.ok(fs.existsSync(lock));
  const interrupted = await callAsync(dir, ['feedback', '中止后的待写入']);
  assert.equal(interrupted.code, 1, interrupted.stderr);
  assert.equal(fs.readFileSync(file, 'utf8'), original);
  // Only after the owner and all other writers are known to be stopped.
  fs.unlinkSync(lock);
  assert.equal(run(['feedback', '离线恢复成功']).id, 1);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).inbox[0].text, '离线恢复成功');
});

test('旧项目升级只接受精确原版，历史备份不覆盖且保留', t => {
  const { dir } = fixture(t);
  const file = path.join(dir, '.studio/studio.mjs');
  const state = path.join(dir, '.studio/state.json');
  const legacy = fs.readFileSync(path.join(packageRoot, 'tests/fixtures/studio-0.1.0.mjs'));
  assert.equal(createHash('sha256').update(legacy).digest('hex'), '91c404ef83db910fb5080098dd2b1a723076b08711533249d1cde85dd5b20dfd');
  fs.writeFileSync(file, legacy);
  const before = fs.readFileSync(state, 'utf8');
  const ignore = path.join(dir, '.studio/.gitignore');
  const userIgnore = '# 用户配置\nstate.json.tmp\n!*.tmp';
  fs.writeFileSync(ignore, userIgnore);
  assert.match(call(dir, ['feedback', '拒绝'], false).error, /尚未升级/);
  assert.match(call(dir, ['upgrade', dir], false).error, /confirm-stopped/);
  assert.equal(fs.readFileSync(state, 'utf8'), before);
  const upgraded = call(dir, ['upgrade', dir, '--confirm-stopped']);
  assert.equal(upgraded.upgraded, true);
  assert.equal(upgraded.backup, path.join(dir, '.studio/studio.mjs.pre-ledger.bak'));
  assert.deepEqual(fs.readFileSync(upgraded.backup), legacy);
  assert.deepEqual(fs.readFileSync(file), fs.readFileSync(cli));
  assert.equal(fs.readFileSync(state, 'utf8'), before);
  const ignored = fs.readFileSync(ignore, 'utf8');
  assert.equal(ignored, `${userIgnore}\nstate.json.lock\n.state.json-*.tmp\n.studio.mjs-*.tmp\n..gitignore-*.tmp\n`);
  assert.equal(call(dir, ['upgrade', dir, '--confirm-stopped']).upgraded, false);
  assert.equal(fs.readFileSync(ignore, 'utf8'), ignored);
  assert.equal(call(dir, ['feedback', '升级后成功']).id, 1);
  fs.writeFileSync(file, Buffer.concat([legacy, Buffer.from('\n// user customization\n')]));
  const customized = fs.readFileSync(file);
  const current = fs.readFileSync(state, 'utf8');
  assert.match(call(dir, ['feedback', '不写入'], false).error, /定制/);
  assert.match(call(dir, ['upgrade', dir, '--confirm-stopped'], false).error, /定制/);
  assert.deepEqual(fs.readFileSync(file), customized);
  assert.equal(fs.readFileSync(state, 'utf8'), current);
  fs.writeFileSync(file, legacy);
  fs.writeFileSync(upgraded.backup, '用户已有备份');
  const backupState = fs.readFileSync(state, 'utf8');
  const history = call(dir, ['upgrade', dir, '--confirm-stopped']);
  assert.equal(history.upgraded, true);
  assert.equal(history.backup, path.join(dir, '.studio/studio.mjs.pre-ledger.91c404ef.bak'));
  assert.deepEqual(fs.readFileSync(history.backup), legacy);
  assert.equal(fs.readFileSync(upgraded.backup, 'utf8'), '用户已有备份');
  assert.deepEqual(fs.readFileSync(file), fs.readFileSync(cli));
  assert.equal(fs.readFileSync(state, 'utf8'), backupState);
});

test('升级补齐缺失的 gitignore，拒绝链接且不覆盖 CLI 或用户文件', t => {
  const { dir } = fixture(t);
  const legacy = fs.readFileSync(path.join(packageRoot, 'tests/fixtures/studio-0.1.0.mjs'));
  const cliFile = path.join(dir, '.studio/studio.mjs');
  const ignore = path.join(dir, '.studio/.gitignore');
  fs.writeFileSync(cliFile, legacy);
  fs.unlinkSync(ignore);
  call(dir, ['upgrade', dir, '--confirm-stopped']);
  assert.equal(fs.readFileSync(ignore, 'utf8'), 'state.json.lock\n.state.json-*.tmp\n.studio.mjs-*.tmp\n..gitignore-*.tmp\n');
  fs.writeFileSync(cliFile, legacy);
  fs.unlinkSync(ignore);
  const userFile = path.join(dir, 'user-ignore');
  fs.writeFileSync(userFile, '不允许覆盖');
  fs.linkSync(userFile, ignore);
  assert.match(call(dir, ['upgrade', dir, '--confirm-stopped'], false).error, /不允许链接/);
  assert.deepEqual(fs.readFileSync(cliFile), legacy);
  assert.equal(fs.readFileSync(userFile, 'utf8'), '不允许覆盖');
});

test('反馈存储与处理可以跨进程恢复', () => {
  const { run } = fixture();
  assert.equal(run(['feedback', '改成深色，保留旧存档']).id, 1);
  assert.equal(run(['resume']).feedback[0].text, '改成深色，保留旧存档');
  run(['feedback-done', '1', '--note', '列入 T6']);
  assert.equal(run(['status']).feedback.length, 0);
});

test('交互启动器支持中文与空格路径', async t => {
  const parent = fs.mkdtempSync(path.join(launcherAlias, 'launcher-'));
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  const target = path.join(parent, '新项目 中文');
  const child = spawn(process.execPath, [path.join(packageRoot, 'bin/start.mjs')], { cwd: packageRoot });
  let output = '', errors = '', stage = 0;
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', chunk => { errors += chunk; });
  child.stdout.on('data', chunk => {
    output += chunk;
    if (stage === 0 && output.includes('完整路径')) { stage++; child.stdin.write(target + '\n'); }
    else if (stage === 1 && output.includes('项目名（')) { stage++; child.stdin.end('演示项目\n'); }
  });
  const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('close', resolve); });
  assert.equal(code, 0, errors + output);
  assert.equal(JSON.parse(fs.readFileSync(path.join(target, '.studio/state.json'), 'utf8')).name, '演示项目');
});

test('快速粘贴启动输入能一次创建项目', t => {
  const parent = fs.mkdtempSync(path.join(launcherAlias, 'pasted-'));
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  const target = path.join(parent, '新项目');
  const result = spawnSync(process.execPath, [path.join(packageRoot, 'bin/start.mjs')], { cwd: packageRoot, input: target + '\n快速输入\n\n', encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(fs.readFileSync(path.join(target, '.studio/state.json'), 'utf8')).name, '快速输入');
});

test('启动器选择项目子目录时恢复原项目', () => {
  const { dir, plan } = fixture();
  plan([task('real', ['src'])]);
  const subdir = path.join(dir, 'src/deep');
  fs.mkdirSync(subdir, { recursive: true });
  const result = spawnSync(process.execPath, [path.join(packageRoot, 'bin/start.mjs')], { cwd: packageRoot, input: subdir + '\n', encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /real/);
  assert.equal(fs.existsSync(path.join(subdir, '.studio')), false);
});

test('待验收成果在恢复和释放后仍保留证据', () => {
  const { run, plan } = fixture();
  plan([task('a', ['src'])]); run(['dispatch']);
  run(['submit', 'a', '--summary', '成果已完成', '--evidence', '测试通过']);
  assert.match(run(['resume']).next, /继续独立验收/);
  run(['release', 'a', '--note', '用户要求修改现有成果']);
  const saved = run(['show', 'a']);
  assert.equal(saved.summary, '成果已完成');
  assert.deepEqual(saved.evidence, ['测试通过']);
});

test('交付示例可载入，独立任务可并行', () => {
  const { run } = fixture();
  run(['plan', path.join(packageRoot, 'examples/plan.json')]);
  assert.deepEqual(run(['dispatch']).packets.map(p => p.task.id), ['search', 'guide']);
});


test('配置默认、逐字段归一化、持久化、非法拒绝与重置', async t => {
  const { dir, run } = fixture(t);
  const { DEFAULT_CONFIG, normalizeConfig, resetConfig } = await import('../bin/studio.mjs');
  assert.deepEqual(run(['config']), DEFAULT_CONFIG);
  assert.deepEqual(resetConfig(), DEFAULT_CONFIG);
  assert.equal(normalizeConfig({ roles: { engineer: { routes: { coding: { model: 'custom' } } } } }).roles.engineer.routes.debug.model, 'gpt-6.1-terra');
  const file = path.join(dir, 'config.json');
  fs.writeFileSync(file, JSON.stringify({ concurrency: 7, roles: { engineer: { routes: { coding: { model: 'custom' } } } } }));
  assert.equal(run(['config', file]).roles.engineer.routes.coding.model, 'custom');
  assert.equal(run(['config']).concurrency, 7);
  const state = path.join(dir, '.studio/state.json');
  const before = fs.readFileSync(state, 'utf8');
  for (const value of [{ concurrency: 0 }, { fastTrackLowRisk: 'yes' }, { roles: { reviewer: { mode: 'other' } } }, { roles: { reviewer: { skills: [1] } } }, { bogus: true }]) {
    fs.writeFileSync(file, JSON.stringify(value)); run(['config', file], false);
    assert.equal(fs.readFileSync(state, 'utf8'), before);
  }
  assert.deepEqual(run(['reset-config']), DEFAULT_CONFIG);
});

test('并发部分配置写入在锁内合并', async t => {
  const { dir, run } = fixture(t);
  const a = path.join(dir, 'a.json'), b = path.join(dir, 'b.json');
  fs.writeFileSync(a, JSON.stringify({ concurrency: 9 }));
  fs.writeFileSync(b, JSON.stringify({ roles: { reviewer: { model: 'custom-review' } } }));
  const results = await Promise.all([callAsync(dir, ['config', a]), callAsync(dir, ['config', b])]);
  for (const result of results) assert.equal(result.code, 0, result.stderr);
  const config = run(['config']);
  assert.equal(config.concurrency, 9);
  assert.equal(config.roles.reviewer.model, 'custom-review');
});

test('指定派工元数据及 BRIEF 锚点和结构化回执', t => {
  const { dir, run, plan } = fixture(t);
  fs.writeFileSync(path.join(dir, '.studio/BRIEF.md'), '## 目标与使用者\n目标锚点\n## 当前版本范围\n范围锚点\n## 全局契约\n契约锚点\n');
  plan([task('first', ['one']), task('chosen', ['two'])]);
  const packet = run(['dispatch', '--task', 'chosen', '--worker', 'Alice', '--mode', 'teammate', '--role', 'reviewer', '--model', 'provider/model', '--risk', 'high']).packets[0];
  assert.deepEqual([packet.task.id, packet.task.worker, packet.task.mode, packet.task.role, packet.task.modelRoute, packet.task.risk], ['chosen', 'Alice', 'teammate', 'reviewer', 'provider/model', 'high']);
  assert.equal(run(['show', 'chosen']).worker, 'Alice');
  for (const item of ['目标锚点', '范围锚点', '契约锚点', 'chosen', '实现 chosen', 'two', '实际测试通过', '15 行', '核心变更摘要', '主控零开发']) assert.ok(packet.prompt.includes(item), item);
  assert.equal(run(['dispatch', '--limit', '1']).packets.length, 0);
});

test('升级精确 0.1.1 且保留账本和简报，未知版本拒绝', t => {
  const { dir } = fixture(t);
  const file = path.join(dir, '.studio/studio.mjs');
  const legacy = legacy011;
  assert.equal(createHash('sha256').update(legacy).digest('hex'), 'd23c689a6bcaeb02b2ce30b2c345cca7bc4b4de0483ab266f917657d2349e9d5');
  fs.writeFileSync(file, legacy);
  const state = fs.readFileSync(path.join(dir, '.studio/state.json'));
  const brief = fs.readFileSync(path.join(dir, '.studio/BRIEF.md'));
  assert.equal(call(dir, ['upgrade', dir, '--confirm-stopped']).upgraded, true);
  assert.deepEqual(fs.readFileSync(file), fs.readFileSync(cli));
  assert.deepEqual(fs.readFileSync(path.join(dir, '.studio/state.json')), state);
  assert.deepEqual(fs.readFileSync(path.join(dir, '.studio/BRIEF.md')), brief);
  fs.writeFileSync(file, 'custom');
  assert.match(call(dir, ['upgrade', dir, '--confirm-stopped'], false).error, /定制/);
  assert.equal(fs.readFileSync(file, 'utf8'), 'custom');
});

test('配置驱动的默认派工解析路由、并发与显式覆盖，非法不改账本', t => {
  const { dir, run, plan } = fixture(t);
  const state = path.join(dir, '.studio/state.json');
  const cfg = path.join(dir, 'cfg.json');
  fs.writeFileSync(cfg, JSON.stringify({ concurrency: 1, fastTrackLowRisk: true, roles: {
    engineer: { routes: {
      coding: { provider: 'cfgprov', model: 'cfg-model-X', reasoningEffort: 'medium', skills: ['cfg-skill'] },
      debug: { provider: 'dbgprov', model: 'dbg-model', reasoningEffort: 'low', skills: [] },
      visual: { provider: 'visprov', model: 'vis-model', reasoningEffort: 'high', skills: ['frontend-design'] },
    } },
    reviewer: { provider: 'revprov', model: 'rev-model', reasoningEffort: 'high', skills: ['rskill'] },
  } }));
  run(['config', cfg]);
  plan([task('t1', ['a']), task('t2', ['b']), task('t3', ['c'])]);
  // concurrency=1 caps even an explicit --limit 9 to a single dispatch (never widened).
  const first = run(['dispatch', '--limit', '9']);
  assert.equal(first.packets.length, 1);
  const p = first.packets[0];
  assert.equal(p.task.id, 't1');
  assert.deepEqual([p.execution.provider, p.execution.model, p.execution.reasoningEffort, p.execution.mode, p.execution.role, p.execution.route], ['cfgprov', 'cfg-model-X', 'medium', 'subagent', 'engineer', 'coding']);
  assert.deepEqual(p.execution.skills, ['cfg-skill']);
  assert.equal(p.task.modelRoute, 'cfgprov/cfg-model-X');
  assert.equal(p.execution.reviewPolicy.fastTrackLowRisk, true);
  assert.equal(p.execution.reviewPolicy.requiresIndependentReview, false);
  assert.deepEqual(p.config, run(['config']));
  assert.equal(run(['show', 't1']).execution.model, 'cfg-model-X');
  for (const s of ['provider=cfgprov', 'cfg-model-X', 'reasoningEffort=medium', 'mode=subagent', 'cfg-skill', 'call skill', '验收策略', 'requiresIndependentReview=false']) assert.ok(p.prompt.includes(s), s);
  assert.equal(run(['dispatch']).packets.length, 0);
  const before = fs.readFileSync(state, 'utf8');
  for (const args of [['--limit', '0'], ['--limit', 'abc'], ['--route', 'nope'], ['--risk', 'medium'], ['--mode', 'bad'], ['--model', 'bad']]) run(['dispatch', ...args], false);
  assert.equal(fs.readFileSync(state, 'utf8'), before);
  // Pending-acceptance (review) also occupies a concurrency slot: t1 has moved to review, still 1 active.
  run(['submit', 't1', '--summary', 's', '--evidence', 'e']);
  assert.equal(run(['show', 't1']).status, 'review');
  assert.equal(run(['dispatch']).packets.length, 0);
  run(['review', 't1', '--result', 'pass', '--reviewer', 'qa', '--evidence', 'a']);
  assert.equal(run(['dispatch']).packets.map(x => x.task.id).join(','), 't2');
});

test('显式路由选择、模型覆盖优先且不抹其他配置、reviewer 与 teammate 解析', t => {
  const { dir, run, plan } = fixture(t);
  const cfg = path.join(dir, 'cfg.json');
  fs.writeFileSync(cfg, JSON.stringify({ concurrency: 10 }));
  run(['config', cfg]);
  plan([task('d', ['da']), task('v', ['va']), task('m', ['ma']), task('r', ['ra'])]);
  const dbg = run(['dispatch', '--task', 'd', '--route', 'debug']).packets[0];
  assert.deepEqual([dbg.execution.provider, dbg.execution.model, dbg.execution.route], ['codex-chatgpt', 'gpt-6.1-terra', 'debug']);
  const vis = run(['dispatch', '--task', 'v', '--route', 'visual', '--mode', 'teammate']).packets[0];
  assert.deepEqual([vis.execution.provider, vis.execution.model, vis.execution.mode, vis.execution.route], ['antigravity', 'gemini-3.8-flash', 'teammate', 'visual']);
  assert.deepEqual(vis.execution.skills, ['frontend-design']);
  assert.equal(vis.task.mode, 'teammate');
  const mo = run(['dispatch', '--task', 'm', '--model', 'oprov/omodel']).packets[0];
  assert.deepEqual([mo.execution.provider, mo.execution.model], ['oprov', 'omodel']);
  assert.deepEqual(mo.execution.skills, ['ponytail', 'code-simplification']);
  assert.equal(mo.execution.reasoningEffort, 'high');
  assert.equal(mo.task.modelRoute, 'oprov/omodel');
  assert.ok(mo.execution.warnings.some(w => w.includes('覆盖')));
  assert.ok(mo.prompt.includes('provider=oprov') && mo.prompt.includes('model=omodel'));
  const rv = run(['dispatch', '--task', 'r', '--role', 'reviewer']).packets[0];
  assert.deepEqual([rv.execution.provider, rv.execution.model, rv.execution.role], ['workbuddy-subscription', 'deepseek-v4.1-flash', 'reviewer']);
  assert.equal(rv.task.role, 'reviewer');
});

test('Team 请求路由与继承/实际模型分离，subagent 显式路由及 reviewer 模式覆盖保留', t => {
  const { dir, run, plan } = fixture(t);
  const cfg = path.join(dir, 'cfg.json');
  fs.writeFileSync(cfg, JSON.stringify({ concurrency: 10, roles: {
    engineer: { mode: 'teammate', routes: { coding: { provider: 'requested-provider', model: 'requested-model', reasoningEffort: 'xhigh', skills: ['ponytail'] } } },
    reviewer: { mode: 'teammate', provider: 'review-provider', model: 'review-model', reasoningEffort: 'medium', skills: ['review-skill'] },
  } }));
  run(['config', cfg]);
  plan([task('team', ['team']), task('sub', ['sub']), task('review-team', ['rt']), task('review-sub', ['rs'])]);
  const dispatched = run(['dispatch', '--task', 'team']);
  const team = dispatched.packets[0];
  assert.deepEqual(team.execution.requested, {
    provider: 'requested-provider', model: 'requested-model', reasoningEffort: 'xhigh', skills: ['ponytail'], mode: 'teammate',
  });
  assert.deepEqual(team.execution.effective, {
    tool: 'spawn_teammate', routing: 'inherit-parent', provider: null, model: null, reasoningEffort: null,
  });
  const unknown = { status: 'unverified', provider: null, model: null, reasoningEffort: null };
  assert.deepEqual(team.execution.actual, unknown);
  assert.equal(team.task.modelRouteKind, 'requested');
  assert.equal(team.task.modelRoute, 'requested-provider/requested-model');
  assert.deepEqual(run(['show', 'team']).execution, team.execution);
  for (const text of ['spawn_teammate', 'name/description/prompt/context', '没有 provider/model/reasoningEffort 参数', 'actual 尚未证实', '不能当作 LLM provider', 'call skill']) assert.ok(team.prompt.includes(text), text);
  assert.ok(team.execution.warnings.some(warning => warning.includes('请求路由未应用')));
  assert.ok(dispatched.next.includes('Team') && dispatched.next.includes('不传 provider/model/reasoningEffort'));
  assert.equal(team.prompt.includes('按 execution 真实调用'), false);
  const sub = run(['dispatch', '--task', 'sub', '--mode', 'subagent']).packets[0];
  assert.deepEqual(sub.execution.effective, {
    tool: 'subagent', routing: 'explicit-request', provider: 'requested-provider', model: 'requested-model', reasoningEffort: 'xhigh',
  });
  assert.deepEqual(sub.execution.actual, unknown);
  assert.ok(sub.prompt.includes('provider=requested-provider') && sub.prompt.includes('reasoningEffort=xhigh'));
  assert.deepEqual(sub.execution.skills, ['ponytail']);
  const reviewTeam = run(['dispatch', '--task', 'review-team', '--role', 'reviewer']).packets[0];
  assert.equal(reviewTeam.execution.effective.routing, 'inherit-parent');
  assert.equal(reviewTeam.execution.requested.provider, 'review-provider');
  const reviewSub = run(['dispatch', '--task', 'review-sub', '--role', 'reviewer', '--mode', 'subagent']).packets[0];
  assert.equal(reviewSub.execution.mode, 'subagent');
  assert.equal(reviewSub.execution.effective.tool, 'subagent');
  assert.equal(reviewSub.execution.effective.provider, 'review-provider');
  assert.equal(reviewSub.execution.effective.reasoningEffort, 'medium');
  assert.deepEqual(reviewSub.execution.actual, unknown);
});

test('CLI 和真实 launcher 在不完整 Studio 边界停止，正常嵌套恢复且父账本不变', t => {
  const { dir } = fixture(t);
  const state = path.join(dir, '.studio/state.json');
  const before = fs.readFileSync(state);
  const normal = path.join(dir, 'normal/deep');
  fs.mkdirSync(normal, { recursive: true });
  assert.equal(call(normal, ['resume']).root, fs.realpathSync(dir));
  const boundary = path.join(dir, 'isolated');
  fs.mkdirSync(path.join(boundary, '.studio'), { recursive: true });
  const nested = path.join(boundary, 'nested');
  fs.mkdirSync(nested);
  assert.match(call(nested, ['pause', '--note', '不得跨边界写父账本'], false).error, /未初始化.*\.studio/);
  assert.match(call(nested, ['resume'], false).error, /未初始化.*\.studio/);
  assert.deepEqual(fs.readFileSync(state), before);
  const target = path.join(boundary, '新项目');
  const launched = spawnSync(process.execPath, [path.join(packageRoot, 'bin/start.mjs')], {
    cwd: packageRoot, input: target + '\n边界内项目\n', encoding: 'utf8',
  });
  assert.equal(launched.status, 0, launched.stderr + launched.stdout);
  assert.equal(call(target, ['resume']).root, fs.realpathSync(target));
  assert.equal(JSON.parse(fs.readFileSync(path.join(target, '.studio/state.json'), 'utf8')).name, '边界内项目');
  assert.deepEqual(fs.readFileSync(state), before);
  assert.equal(fs.existsSync(path.join(boundary, '.studio/state.json')), false);
});

test('fastTrackLowRisk 控制低风险主控验收与独立验收要求', t => {
  const { dir, run, plan } = fixture(t);
  const cfg = path.join(dir, 'cfg.json');
  plan([task('ft', ['fa'])]);
  run(['dispatch', '--task', 'ft', '--worker', 'impl-ft']);
  run(['submit', 'ft', '--summary', 's', '--evidence', 'e']);
  const done = run(['review', 'ft', '--result', 'pass', '--reviewer', 'director-audit', '--evidence', 'audit']);
  assert.equal(done.status, 'done');
  assert.equal(done.review.policy.requiresIndependentReview, false);
  fs.writeFileSync(cfg, JSON.stringify({ fastTrackLowRisk: false }));
  run(['config', cfg]);
  plan([task('nf', ['na'])]);
  run(['dispatch', '--task', 'nf', '--worker', 'impl-nf']);
  run(['submit', 'nf', '--summary', 's', '--evidence', 'e']);
  run(['review', 'nf', '--result', 'pass', '--reviewer', 'director-audit', '--evidence', 'a'], false);
  assert.equal(run(['show', 'nf']).status, 'review');
  const nfdone = run(['review', 'nf', '--result', 'pass', '--reviewer', 'reviewer-nf', '--evidence', 'a']);
  assert.equal(nfdone.status, 'done');
  assert.equal(nfdone.review.policy.requiresIndependentReview, true);
  fs.writeFileSync(cfg, JSON.stringify({ fastTrackLowRisk: true }));
  run(['config', cfg]);
  plan([task('hr', ['ha'])]);
  const hrp = run(['dispatch', '--task', 'hr', '--worker', 'impl-hr', '--risk', 'high']).packets[0];
  assert.equal(hrp.execution.risk, 'high');
  assert.equal(hrp.execution.reviewPolicy.requiresIndependentReview, true);
  run(['submit', 'hr', '--summary', 's', '--evidence', 'e']);
  run(['review', 'hr', '--result', 'pass', '--reviewer', 'director-audit', '--evidence', 'a'], false);
  run(['review', 'hr', '--result', 'pass', '--reviewer', 'impl-hr', '--evidence', 'a'], false);
  assert.equal(run(['review', 'hr', '--result', 'pass', '--reviewer', 'reviewer-hr', '--evidence', 'a']).status, 'done');
});

test('无 execution 的旧任务按当前配置判定验收策略', t => {
  const { dir, run, plan } = fixture(t);
  plan([task('legacy', ['la']), task('legacyhi', ['lh'])]);
  const file = path.join(dir, '.studio/state.json');
  const state = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const id of ['legacy', 'legacyhi']) {
    const entry = state.tasks.find(x => x.id === id);
    entry.status = 'review'; entry.owner = 'oldworker'; entry.summary = 's'; entry.evidence = ['e'];
  }
  state.tasks.find(x => x.id === 'legacyhi').risk = 'high';
  fs.writeFileSync(file, JSON.stringify(state, null, 2) + '\n');
  assert.equal(run(['review', 'legacy', '--result', 'pass', '--reviewer', 'director-audit', '--evidence', 'a']).status, 'done');
  run(['review', 'legacyhi', '--result', 'pass', '--reviewer', 'director-audit', '--evidence', 'a'], false);
  assert.equal(run(['show', 'legacyhi']).status, 'review');
});

test('修复前 0.2.0 仅凭已知哈希安全升级到当前模板，保留账本与简报，未知拒绝', t => {
  const { dir } = fixture(t);
  const file = path.join(dir, '.studio/studio.mjs');
  const legacy = legacy020;
  assert.equal(createHash('sha256').update(legacy).digest('hex'), 'f8ad29277bec0a5f2ca03101c8e38872a84447fe68cfb805dc0e5999928b3d4a');
  fs.writeFileSync(file, legacy);
  const state = fs.readFileSync(path.join(dir, '.studio/state.json'));
  const brief = fs.readFileSync(path.join(dir, '.studio/BRIEF.md'));
  const up = call(dir, ['upgrade', dir, '--confirm-stopped']);
  assert.equal(up.upgraded, true);
  assert.equal(up.backup, path.join(dir, '.studio/studio.mjs.pre-ledger.bak'));
  assert.deepEqual(fs.readFileSync(file), fs.readFileSync(cli));
  assert.deepEqual(fs.readFileSync(path.join(dir, '.studio/state.json')), state);
  assert.deepEqual(fs.readFileSync(path.join(dir, '.studio/BRIEF.md')), brief);
  assert.deepEqual(fs.readFileSync(up.backup), legacy);
  fs.writeFileSync(file, Buffer.concat([legacy, Buffer.from('\n// x\n')]));
  assert.match(call(dir, ['upgrade', dir, '--confirm-stopped'], false).error, /定制/);
});

test('已有同名备份与当前 CLI 同内容时复用原名且不生成哈希备份', t => {
  const { dir } = fixture(t);
  const file = path.join(dir, '.studio/studio.mjs');
  const fixed = path.join(dir, '.studio/studio.mjs.pre-ledger.bak');
  const hashBackup = path.join(dir, '.studio/studio.mjs.pre-ledger.f8ad2927.bak');
  fs.writeFileSync(file, legacy020);
  fs.writeFileSync(fixed, legacy020);
  const up = call(dir, ['upgrade', '.', '--confirm-stopped']);
  assert.equal(up.upgraded, true);
  assert.equal(up.backup, fixed);
  assert.deepEqual(fs.readFileSync(fixed), legacy020);
  assert.equal(fs.existsSync(hashBackup), false);
  assert.deepEqual(fs.readFileSync(file), fs.readFileSync(cli));
});

test('项目内旧0.2.0 CLI 入口只按自身版本升级，不能替代安装目录模板', t => {
  const { dir } = fixture(t);
  const oldCli = path.join(dir, '.studio/studio.mjs');
  fs.writeFileSync(oldCli, legacy020);
  const selfState = fs.readFileSync(path.join(dir, '.studio/state.json'));
  const selfRun = call(dir, ['upgrade', dir, '--confirm-stopped'], true, oldCli);
  assert.equal(selfRun.upgraded, false);
  assert.equal(selfRun.reason, '已是当前版本');
  assert.deepEqual(fs.readFileSync(path.join(dir, '.studio/state.json')), selfState);
  // Same entry invoked by a relative path resolves the same self, not cwd or TARGET.
  const relative = spawnSync(process.execPath, ['.studio/studio.mjs', 'upgrade', '.', '--confirm-stopped'], { cwd: dir, encoding: 'utf8' });
  assert.equal(relative.status, 0, relative.stderr);
  assert.equal(JSON.parse(relative.stdout).reason, '已是当前版本');
  const target = fs.mkdtempSync(path.join(scratch, 'old-entry-'));
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));
  call(target, ['init', target]);
  const targetCli = path.join(target, '.studio/studio.mjs');
  fs.writeFileSync(targetCli, legacy011);
  const targetState = fs.readFileSync(path.join(target, '.studio/state.json'));
  const targetBrief = fs.readFileSync(path.join(target, '.studio/BRIEF.md'));
  const result = call(dir, ['upgrade', target, '--confirm-stopped'], true, oldCli);
  assert.equal(result.upgraded, true);
  assert.equal(result.backup, path.join(target, '.studio/studio.mjs.pre-ledger.bak'));
  assert.deepEqual(fs.readFileSync(result.backup), legacy011);
  // The old runner only knows its own f8ad bytes; it cannot install the new template.
  assert.deepEqual(fs.readFileSync(targetCli), legacy020);
  assert.notDeepEqual(fs.readFileSync(targetCli), fs.readFileSync(cli));
  assert.deepEqual(fs.readFileSync(path.join(target, '.studio/state.json')), targetState);
  assert.deepEqual(fs.readFileSync(path.join(target, '.studio/BRIEF.md')), targetBrief);
  // Old 0.2.0 never overwrites an unknown CLI it cannot upgrade.
  fs.writeFileSync(targetCli, 'custom');
  assert.match(call(dir, ['upgrade', target, '--confirm-stopped'], false, oldCli).error, /不是已知原版/);
  assert.equal(fs.readFileSync(targetCli, 'utf8'), 'custom');
});

test('历史备份存在时升级旧0.2.0生成哈希后缀备份，保留历史/账本/简报，两入口行为准确且重跑幂等', t => {
  const { dir } = fixture(t);
  const file = path.join(dir, '.studio/studio.mjs');
  const statePath = path.join(dir, '.studio/state.json');
  const briefPath = path.join(dir, '.studio/BRIEF.md');
  const historical = path.join(dir, '.studio/studio.mjs.pre-ledger.bak');
  const hashBackup = path.join(dir, '.studio/studio.mjs.pre-ledger.f8ad2927.bak');
  const stateBytes = fs.readFileSync(statePath);
  const briefBytes = fs.readFileSync(briefPath);
  fs.writeFileSync(historical, legacy011);
  fs.writeFileSync(file, legacy020);
  // Project-internal old CLI compares against itself: it cannot self-upgrade and must not touch anything.
  const internal = call(dir, ['upgrade', dir, '--confirm-stopped'], true, file);
  assert.equal(internal.upgraded, false);
  assert.equal(internal.reason, '已是当前版本');
  assert.deepEqual(fs.readFileSync(file), legacy020);
  assert.deepEqual(fs.readFileSync(historical), legacy011);
  assert.equal(fs.existsSync(hashBackup), false);
  // Template entry upgrades and keeps the historical 0.1.1 backup byte-identical.
  const up = call(dir, ['upgrade', dir, '--confirm-stopped']);
  assert.equal(up.upgraded, true);
  assert.equal(up.previousSha256, 'f8ad29277bec0a5f2ca03101c8e38872a84447fe68cfb805dc0e5999928b3d4a');
  assert.equal(up.backup, hashBackup);
  assert.deepEqual(fs.readFileSync(hashBackup), legacy020);
  assert.deepEqual(fs.readFileSync(historical), legacy011);
  assert.deepEqual(fs.readFileSync(file), fs.readFileSync(cli));
  assert.deepEqual(fs.readFileSync(statePath), stateBytes);
  assert.deepEqual(fs.readFileSync(briefPath), briefBytes);
  const again = call(dir, ['upgrade', dir, '--confirm-stopped']);
  assert.equal(again.upgraded, false);
  assert.deepEqual(fs.readFileSync(hashBackup), legacy020);
  assert.deepEqual(fs.readFileSync(historical), legacy011);
  // Returning to the old CLI reuses the same hash-named backup when its bytes still match.
  fs.writeFileSync(file, legacy020);
  const replay = call(dir, ['upgrade', dir, '--confirm-stopped']);
  assert.equal(replay.upgraded, true);
  assert.equal(replay.backup, hashBackup);
  assert.deepEqual(fs.readFileSync(historical), legacy011);
  // A conflicting hash-named backup is never overwritten.
  fs.writeFileSync(hashBackup, '用户已有同哈希备份');
  fs.writeFileSync(file, legacy020);
  assert.match(call(dir, ['upgrade', dir, '--confirm-stopped'], false).error, /备份内容不同且哈希备份名冲突/);
  assert.deepEqual(fs.readFileSync(file), legacy020);
  assert.deepEqual(fs.readFileSync(historical), legacy011);
  assert.equal(fs.readFileSync(hashBackup, 'utf8'), '用户已有同哈希备份');
});
