import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm, realpath, link, symlink, unlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import { createServer, request as httpRequest } from 'node:http';
import { createStudioApi } from '../core.js';
import { apply, inject, name } from '../index.js';
import { DEFAULT_CONFIG } from '../../bin/studio.mjs';

const cli = fileURLToPath(new URL('../../bin/studio.mjs', import.meta.url));
const id = 'session-test';
const at = '2026-11-06T00:00:00.000Z';
const scratch = fileURLToPath(new URL('../../.scratch/repair-server-20261109/', import.meta.url));
await mkdir(scratch, { recursive: true });
const testRun = await realpath(await mkdtemp(path.join(scratch, 'core-tests-')));
assert.ok(testRun.startsWith(await realpath(scratch) + path.sep));
await new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [cli, 'init', testRun, '--name=core-tests'], { cwd: testRun, stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', value => { stderr += value; });
  child.once('error', reject);
  child.once('close', code => code === 0 ? resolve() : reject(new Error(stderr)));
});
const runApi = createStudioApi({ sessions: { get: () => ({ header: { cwd: testRun } }) } });
assert.equal((await runApi.project(id)).root, testRun);
await readFile(path.join(testRun, '.studio/state.json'));
const testTemp = path.join(testRun, 'tmp');
// An incomplete Studio marker prevents uninitialized cases from reaching an ancestor ledger.
await mkdir(path.join(testTemp, '.studio'), { recursive: true });
process.env.TEMP = process.env.TMP = testTemp;
after(() => rm(testRun, { recursive: true, force: true }));

async function fixture(t) {
  const root = await realpath(await mkdtemp(path.join(testTemp, 'Agent Studio 中文 空格-')));
  assert.ok(root.startsWith(testTemp + path.sep));
  t.after(() => rm(root, { recursive: true, force: true }));
  const loaded = new Map([[id, { header: { cwd: root } }]]);
  const sessions = { get: value => loaded.get(value) };
  const calls = [];
  const api = createStudioApi({ sessions }, { spawn: (...args) => { calls.push(args); return spawn(...args); } });
  assert.equal((await api.project(id)).root, root);
  const action = async (action, rest = {}) => {
    const project = await api.action({ sessionId: id, action, ...rest });
    if (action === 'init') {
      assert.equal(project.root, await realpath(rest.root ?? root));
      assert.equal(project.initialized, true);
      await readFile(path.join(project.root, '.studio/state.json'));
    }
    return project;
  };
  return { root, sessions, loaded, api, calls, action };
}

async function stateAt(root, update) {
  assert.equal(root, await realpath(root));
  assert.ok(root.startsWith(testTemp + path.sep));
  const file = path.join(root, '.studio', 'state.json');
  const state = JSON.parse(await readFile(file, 'utf8'));
  Object.assign(state, update);
  await writeFile(file, JSON.stringify(state));
}

function task(id, status, dependsOn = []) {
  return {
    id, title: `任务 ${id}`, description: '完整任务说明', scope: ['src/模块'], dependsOn,
    acceptance: ['中文验收项'], status, owner: status === 'in_progress' ? `worker-${id}` : null,
    summary: '已实现成果', evidence: ['node --test 通过', 'artifact.png'], review: null,
    history: [{ at, action: 'submitted', summary: '保留历史' }],
  };
}

async function routes(t, sessions, host) {
  const handlers = new Map();
  const disposed = [];
  let cleanup, releaseHost;
  apply({
    sessions,
    inject(dependencies, callback) {
      assert.deepEqual(dependencies, ['skills', 'agents', 'tools', 'workingDirectory']);
      if (host) releaseHost = callback(host);
    },
    effect(fn, label) { assert.equal(label, 'agent-studio:routes'); cleanup = fn(); },
    webServer: { register(route) {
      assert.equal(route.kind, 'exact');
      handlers.set(route.path, route.handler);
      return () => disposed.push(route.path);
    } },
  });
  t.after(() => cleanup());
  const request = async (route, options = {}) => {
    const raw = options.raw ?? (options.body === undefined ? '' : JSON.stringify(options.body));
    const req = Readable.from([Buffer.from(raw)]);
    req.method = options.method ?? (route.endsWith('project') ? 'GET' : 'POST');
    req.url = options.url ?? `${route}${req.method === 'GET' ? `?sessionId=${id}` : ''}`;
    req.socket = { remoteAddress: options.remote ?? '127.0.0.1', encrypted: options.encrypted ?? false };
    req.headers = {
      host: '127.0.0.1:49276', origin: 'http://127.0.0.1:49276',
      'content-type': 'application/json; charset=utf-8', ...options.headers,
    };
    let status, headers, body;
    const res = { writeHead(code, value) { status = code; headers = value; }, end(value) { body = JSON.parse(value); } };
    await handlers.get(route)(req, res);
    assert.equal(headers['Cache-Control'], 'no-store');
    assert.match(headers['Content-Type'], /application\/json/);
    return { status, body };
  };
  return { request, handlers, disposed, releaseHost: () => releaseHost?.() };
}

const projectRoute = '/agent-studio/api/project';
const actionRoute = '/agent-studio/api/action';
function runProjectCli(root, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(root, '.studio/studio.mjs'), ...args], { cwd: root });
    let stdout = '', stderr = '';
    child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', code => code === 0 ? resolve(JSON.parse(stdout)) : reject(new Error(stderr)));
  });
}

const rejects = (run, status, code) => assert.rejects(run, error => {
  assert.equal(error.status, status, error.message);
  if (code) assert.equal(error.code, code);
  return true;
});

const defaultSkills = [];
const defaultConfig = () => structuredClone(DEFAULT_CONFIG);
const defaultCatalog = () => ({
  source: 'host.skills.snapshot', available: false, complete: false, toolAvailable: false, reason: 'HOST_SKILLS_UNAVAILABLE',
  entries: ['code-simplification', 'frontend-design', 'ponytail', 'systematic-debugging', 'verification-before-completion'].map(name => ({ name, source: 'config', provider: null, origin: 'config', available: false, status: 'unverified', configured: true })),
});
function sampleConfig() {
  const config = structuredClone(DEFAULT_CONFIG);
  config.concurrency = 5;
  config.fastTrackLowRisk = false;
  config.roles.engineer.routes.coding.model = 'custom-coder';
  config.roles.engineer.routes.visual.skills = ['frontend-design', 'code-simplification'];
  config.roles.reviewer.reasoningEffort = 'medium';
  config.roles.director.skills = ['ponytail'];
  return config;
}

test('未初始化快照来自真实 cwd；load 只读且拒绝不存在会话和无效 root', async t => {
  const { root, api, action, calls, loaded } = await fixture(t);
  assert.deepEqual(await api.project(id), {
    initialized: false, root, name: path.basename(root), paused: false,
    counts: { todo: 0, in_progress: 0, review: 0, done: 0 }, tasks: [], feedback: [], handoff: null, brief: '', revision: null, cliCompatibility: null,
    config: defaultConfig(), skills: defaultSkills, skillCatalog: defaultCatalog(),
  });
  assert.deepEqual(await action('load', { root }), await api.project(id));
  assert.equal(calls.length, 0);
  assert.deepEqual(await readdir(root), []);
  await rejects(() => api.project('missing'), 404, 'SESSION_NOT_FOUND');
  await rejects(() => api.project(''), 400);
  await rejects(() => api.action({ sessionId: 'missing', root, action: 'load' }), 404);
  const invalidRoots = ['', 'relative/path', 123, null, root + '\0', '\\\\server\\share'];
  if (process.platform === 'win32') invalidRoots.push('\\Windows', 'C:relative', '/Windows');
  for (const invalid of invalidRoots) {
    await rejects(() => action('load', { root: invalid }), 400, 'INVALID_ROOT');
  }
  await rejects(() => action('load', { root: path.join(root, 'missing') }), 404, 'ROOT_NOT_FOUND');
  const file = path.join(root, 'ordinary.txt');
  await writeFile(file, 'not a directory');
  await rejects(() => action('load', { root: file }), 400, 'INVALID_PROJECT_PATH');
  loaded.set(id, { cwd: root, header: {} });
  await rejects(() => api.project(id), 400, 'INVALID_ROOT');
});

test('真实 init 支持中文空格并保留规则，重复初始化不覆盖', async t => {
  const { root, action, calls } = await fixture(t);
  await writeFile(path.join(root, 'AGENTS.md'), '# 用户原规则\n');
  await writeFile(path.join(root, 'CLAUDE.md'), '# Claude 原规则\n');
  const project = await action('init', { name: '中文 项目' });
  assert.equal(project.initialized, true);
  assert.equal(project.name, '中文 项目');
  assert.equal(project.revision, createHash('sha256').update(project.brief).digest('hex'));
  assert.equal(project.cliCompatibility, 'current');
  assert.deepEqual(Object.keys(project).sort(), ['initialized', 'root', 'name', 'paused', 'counts', 'tasks', 'feedback', 'handoff', 'brief', 'revision', 'cliCompatibility', 'config', 'skills', 'skillCatalog'].sort());
  for (const file of ['AGENTS.md', 'CLAUDE.md']) {
    const rule = await readFile(path.join(root, file), 'utf8');
    assert.match(rule, /^# .*原规则\n/);
    assert.equal(rule.match(/<!-- agent-studio -->/g).length, 1);
  }
  for (const host of ['.agents', '.claude']) assert.match(await readFile(path.join(root, host, 'skills/project-director/SKILL.md'), 'utf8'), /name: project-director/);
  const before = await readFile(path.join(root, '.studio/state.json'), 'utf8');
  await rejects(() => action('init', { name: '不覆盖' }), 409, 'ALREADY_INITIALIZED');
  assert.equal(await readFile(path.join(root, '.studio/state.json'), 'utf8'), before);
  assert.deepEqual(calls[0][0], process.execPath);
  assert.deepEqual(calls[0][1], [cli, 'init', root, '--name=中文 项目']);
  assert.equal(calls[0][2].cwd, root);
  assert.equal(calls[0][2].env.ELECTRON_RUN_AS_NODE, '1');
  assert.deepEqual(calls[0][2].stdio, ['ignore', 'pipe', 'pipe']);
});

test('已有同名技能时 CLI 报错且保留原内容，不产生 Studio 半成品', async t => {
  const { root, action } = await fixture(t);
  const dir = path.join(root, '.claude', 'skills', 'project-director');
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'SKILL.md'), '用户原技能');
  await rejects(() => action('init'), 422, 'CLI_FAILED');
  assert.equal(await readFile(path.join(dir, 'SKILL.md'), 'utf8'), '用户原技能');
  assert.equal((await readdir(root)).includes('.studio'), false);
  await rejects(() => action('resume'), 409, 'NOT_INITIALIZED');
});

test('realpath 后向父级恢复，快照保留任务详情和全部反馈', async t => {
  const { root, action, api, loaded, calls } = await fixture(t);
  await action('init');
  const tasks = [task('a', 'done'), task('b', 'in_progress', ['a']), task('c', 'todo', ['b']), task('d', 'review')];
  const inbox = [{ id: 1, text: '已经完成', at, resolved: true, note: 'T1' }, { id: 2, text: '待处理', at, resolved: false }];
  await stateAt(root, { tasks, inbox, handoff: { at, note: '交接说明' } });
  const child = path.join(root, 'src', '子 目录');
  await mkdir(child, { recursive: true });
  loaded.set(id, { header: { cwd: child } });
  const before = await readFile(path.join(root, '.studio/state.json'), 'utf8');
  const project = await api.project(id);
  assert.equal(project.root, root);
  assert.deepEqual(project.tasks, tasks);
  assert.deepEqual(project.feedback, inbox);
  assert.deepEqual(project.counts, { todo: 1, in_progress: 1, review: 1, done: 1 });
  assert.equal(project.handoff.note, '交接说明');
  assert.deepEqual(await action('load', { root: path.join(child, '..', '子 目录') }), project);
  assert.equal(await readFile(path.join(root, '.studio/state.json'), 'utf8'), before);
  assert.equal((await readdir(child)).includes('.studio'), false);
  assert.equal(calls.length, 1);
});

test('显式项目通过 POST load 独立于会话 cwd，load 不绑定或初始化', async t => {
  const { root, action, api, calls } = await fixture(t);
  const explicit = path.join(root, '另一个项目 空格');
  await mkdir(explicit);
  assert.equal((await action('load', { root: explicit })).root, await realpath(explicit));
  assert.deepEqual(await readdir(explicit), []);
  assert.equal((await api.project(id)).root, root);
  const initialized = await action('init', { root: explicit, name: '另一个项目' });
  assert.equal(initialized.root, await realpath(explicit));
  assert.equal((await api.project(id)).initialized, false);
  assert.equal(calls.length, 1);
});

test('反馈必填；暂停只保存交接，resume --continue 不重派仍在执行的任务', async t => {
  const { root, action, calls } = await fixture(t);
  await action('init');
  const tasks = [task('working', 'in_progress'), task('waiting', 'todo')];
  await stateAt(root, { tasks });
  const before = await readFile(path.join(root, '.studio/state.json'), 'utf8');
  for (const text of ['', '   ', 123, null, undefined]) await rejects(() => action('feedback', { text }), 400);
  for (const note of ['', '   ', null, undefined]) await rejects(() => action('pause', { note }), 400);
  assert.equal(await readFile(path.join(root, '.studio/state.json'), 'utf8'), before);
  const feedback = await action('feedback', { text: '  --name=反馈 中文 空格  ' });
  assert.equal(feedback.feedback[0].text, '--name=反馈 中文 空格');
  assert.equal(feedback.feedback[0].resolved, false);
  const paused = await action('pause', { note: '--continue 只是交接；worker 尚未确认停止' });
  assert.equal(paused.paused, true);
  assert.match(paused.handoff.note, /尚未确认停止/);
  assert.deepEqual(paused.tasks, tasks);
  assert.deepEqual((await action('load')).tasks, tasks);
  assert.equal((await action('load')).paused, true);
  const resumed = await action('resume');
  assert.equal(resumed.paused, false);
  assert.deepEqual(resumed.tasks, tasks);
  assert.deepEqual(resumed.handoff, paused.handoff);
  assert.deepEqual(calls.map(call => call[1].slice(1)), [
    ['init', root, `--name=${path.basename(root)}`],
    ['feedback', '--', '--name=反馈 中文 空格'],
    ['pause', '--note=--continue 只是交接；worker 尚未确认停止'],
    ['resume', '--continue'],
  ]);
});

test('同一 realpath 的并发写入串行化，多个 API 实例不会丢反馈', async t => {
  const { root, sessions, action, api } = await fixture(t);
  await action('init');
  const child = path.join(root, '子目录');
  await mkdir(child);
  const second = createStudioApi({ sessions });
  await Promise.all(Array.from({ length: 8 }, (_, i) => (i % 2 ? second : api).action({
    sessionId: id, root: i % 2 ? child : root, action: 'feedback', text: `反馈 ${i}`,
  })));
  const project = await api.project(id);
  assert.deepEqual(project.feedback.map(item => item.id), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.equal(new Set(project.feedback.map(item => item.text)).size, 8);
});

test('插件 API 与项目独立 CLI 多进程并发写入共享同一账本锁', async t => {
  const { root, sessions, action } = await fixture(t);
  await action('init');
  const moduleUrl = new URL('../core.js', import.meta.url).href;
  const script = `import { createStudioApi } from ${JSON.stringify(moduleUrl)}; const root=process.argv[1], n=process.argv[2]; const api=createStudioApi({sessions:{get:()=>({header:{cwd:root}})}}); await api.action({sessionId:'s',action:'feedback',text:'插件 '+n});`;
  const workers = Array.from({ length: 8 }, (_, i) => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', script, root, String(i)], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stdout.resume();
    child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', code => code === 0 ? resolve() : reject(new Error(stderr)));
  }));
  const separateApi = createStudioApi({ sessions });
  await Promise.all([
    ...workers,
    ...Array.from({ length: 8 }, (_, i) => runProjectCli(root, ['feedback', `CLI ${i}`])),
    ...Array.from({ length: 4 }, (_, i) => separateApi.action({ sessionId: id, action: 'feedback', text: `API ${i}` })),
  ]);
  const result = JSON.parse(await readFile(path.join(root, '.studio/state.json'), 'utf8'));
  assert.equal(result.inbox.length, 20);
  assert.equal(new Set(result.inbox.map(item => item.id)).size, 20);
  assert.equal(new Set(result.inbox.map(item => item.text)).size, 20);
});

test('临时共享冲突重试同一原子提交，持续冲突与其他错误保留账本', async t => {
  const { root, action } = await fixture(t);
  await action('init');
  const studio = path.join(root, '.studio');
  const stateFile = path.join(studio, 'state.json');
  const shim = path.join(root, 'intercept.cjs');
  await writeFile(shim, `
const fs = require('node:fs'), path = require('node:path');
const rename = fs.renameSync;
let count = 0, previous;
fs.renameSync = (from, to) => {
  if (path.basename(to) !== 'state.json') return rename(from, to);
  if (!fs.existsSync(path.join(path.dirname(to), 'state.json.lock'))) throw new Error('lock missing during rename');
  if (previous && previous !== from) throw new Error('temporary file changed');
  previous = from;
  count++;
  fs.appendFileSync(process.env.RENAME_TRACE, String(count) + ':' + from + '\\n');
  if (count <= Number(process.env.RENAME_FAILURES)) throw Object.assign(new Error('injected ' + process.env.RENAME_CODE), { code: process.env.RENAME_CODE });
  return rename(from, to);
};
`);
  async function attempt(code, failures, label) {
    const trace = path.join(root, `${label}.trace`);
    const result = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ['--require', shim, cli, 'feedback', label], {
        cwd: root, env: { ...process.env, RENAME_TRACE: trace, RENAME_CODE: code, RENAME_FAILURES: String(failures) },
      });
      let stdout = '', stderr = '';
      child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk; });
      child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
      child.once('error', reject);
      child.once('close', code => resolve({ code, stdout, stderr }));
    });
    return { ...result, attempts: (await readFile(trace, 'utf8')).trim().split('\n').length };
  }
  for (const code of ['EPERM', 'EACCES', 'EBUSY']) {
    const result = await attempt(code, 2, code);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.attempts, 3);
  }
  const before = await readFile(stateFile, 'utf8');
  const permanent = await attempt('EPERM', 100, 'permanent');
  assert.equal(permanent.code, 1, permanent.stderr);
  assert.equal(permanent.attempts, 20);
  assert.match(permanent.stderr, /injected EPERM/);
  assert.equal(await readFile(stateFile, 'utf8'), before);
  const invalid = await attempt('EIO', 100, 'immediate');
  assert.equal(invalid.code, 1, invalid.stderr);
  assert.equal(invalid.attempts, 1);
  assert.match(invalid.stderr, /injected EIO/);
  assert.equal(await readFile(stateFile, 'utf8'), before);
  assert.deepEqual((await readdir(studio)).filter(name => name.endsWith('.tmp') || name.endsWith('.lock')), []);
  assert.equal((await readFile(stateFile, 'utf8')).includes('permanent'), false);
});

test('旧项目的插件写入拒绝但只读与定制脚本保留', async t => {
  const { root, action } = await fixture(t);
  await action('init');
  const file = path.join(root, '.studio/studio.mjs');
  const legacy = await readFile(new URL('../../tests/fixtures/studio-0.1.0.mjs', import.meta.url));
  await writeFile(file, legacy);
  const before = await readFile(path.join(root, '.studio/state.json'), 'utf8');
  assert.equal((await action('load')).cliCompatibility, 'legacy');
  await rejects(() => action('feedback', { text: '拒绝混用' }), 422, 'CLI_FAILED');
  assert.equal(await readFile(path.join(root, '.studio/state.json'), 'utf8'), before);
  assert.deepEqual(await readFile(file), legacy);
  const { gunzipSync } = await import('node:zlib');
  const goldenSource = await readFile(new URL('../../tests/studio.test.mjs', import.meta.url), 'utf8');
  const golden = [...goldenSource.matchAll(/gunzipSync\(Buffer\.from\('([A-Za-z0-9+/=]+)'/g)]
    .map(match => gunzipSync(Buffer.from(match[1], 'base64')));
  for (const hash of [
    'd23c689a6bcaeb02b2ce30b2c345cca7bc4b4de0483ab266f917657d2349e9d5',
    'f8ad29277bec0a5f2ca03101c8e38872a84447fe68cfb805dc0e5999928b3d4a',
  ]) {
    const original = golden.find(bytes => createHash('sha256').update(bytes).digest('hex') === hash);
    assert.ok(original, `reuse exact CLI golden fixture ${hash}`);
    await writeFile(file, original);
    assert.equal((await action('load')).cliCompatibility, 'legacy');
    assert.equal(await readFile(path.join(root, '.studio/state.json'), 'utf8'), before);
  }
  await writeFile(file, '用户定制');
  assert.equal((await action('load')).cliCompatibility, 'custom');
  await unlink(file);
  assert.equal((await action('load')).cliCompatibility, 'missing');
  const source = path.join(root, 'user-cli');
  await writeFile(source, 'do not modify');
  await link(source, file);
  assert.equal((await action('load')).cliCompatibility, 'invalid');
  assert.equal(await readFile(source, 'utf8'), 'do not modify');
  assert.equal(await readFile(path.join(root, '.studio/state.json'), 'utf8'), before);
});

test('brief 使用 hash revision，原子写入；过期和并发修改返回 409 且不丢内容', async t => {
  const { root, action, api, calls } = await fixture(t);
  const initial = await action('init');
  const stateBefore = await readFile(path.join(root, '.studio/state.json'), 'utf8');
  await rejects(() => action('brief', { brief: '无 revision' }), 400);
  await rejects(() => action('brief', { brief: 123, revision: initial.revision }), 400);
  const saved = await action('brief', { brief: '# 中文目标\n\n保留 空格\n', revision: initial.revision });
  assert.equal(saved.brief, '# 中文目标\n\n保留 空格\n');
  assert.notEqual(saved.revision, initial.revision);
  await rejects(() => action('brief', { brief: '旧页面覆盖', revision: initial.revision }), 409, 'REVISION_CONFLICT');
  assert.equal((await api.project(id)).brief, saved.brief);
  const outcomes = await Promise.allSettled([
    action('brief', { brief: '并发版本 A', revision: saved.revision }),
    action('brief', { brief: '并发版本 B', revision: saved.revision }),
  ]);
  assert.equal(outcomes.filter(item => item.status === 'fulfilled').length, 1);
  const rejected = outcomes.find(item => item.status === 'rejected').reason;
  assert.equal(rejected.status, 409);
  assert.equal(rejected.code, 'REVISION_CONFLICT');
  const current = await api.project(id);
  assert.equal(rejected.revision, current.revision);
  await writeFile(path.join(root, '.studio/BRIEF.md'), '外部工具更新');
  await rejects(() => action('brief', { brief: '不能覆盖外部内容', revision: current.revision }), 409);
  const external = await api.project(id);
  const cleared = await action('brief', { brief: '', revision: external.revision });
  assert.equal(cleared.brief, '');
  assert.equal(await readFile(path.join(root, '.studio/state.json'), 'utf8'), stateBefore);
  assert.deepEqual((await readdir(path.join(root, '.studio'))).filter(name => name.endsWith('.tmp')), []);
  assert.equal(calls.length, 1);
});

test('拒绝非法动作、损坏状态和管理文件链接，不读取任意文件', async t => {
  const { root, api, action } = await fixture(t);
  for (const body of [null, [], 'init', {}, { action: 'dispatch' }, { action: 'submit' }]) {
    await rejects(() => api.action(body), 400, 'INVALID_ACTION');
  }
  await action('init');
  const stateFile = path.join(root, '.studio/state.json');
  const original = await readFile(stateFile, 'utf8');
  await writeFile(stateFile, '{broken');
  await rejects(() => api.project(id), 422, 'INVALID_STATE');
  await writeFile(stateFile, JSON.stringify({ name: '坏状态', tasks: [], inbox: [] }));
  await rejects(() => api.project(id), 422, 'INVALID_STATE');
  await writeFile(stateFile, original);
  const other = path.join(root, 'other.txt');
  await link(stateFile, other);
  await rejects(() => api.project(id), 400, 'INVALID_PROJECT_PATH');
});

test('CLI spawn 错误被正确传播；锁失败后仍能继续；等待操作重新验证会话', async t => {
  const { root, sessions, action, loaded } = await fixture(t);
  await action('init');
  const startFailure = createStudioApi({ sessions }, { spawn() {
    const child = new EventEmitter();
    child.stdout = new Readable({ read() {} });
    child.stderr = new Readable({ read() {} });
    queueMicrotask(() => child.emit('error', new Error('spawn unavailable')));
    return child;
  } });
  await rejects(() => startFailure.action({ sessionId: id, action: 'resume' }), 500, 'CLI_START_FAILED');
  assert.equal((await action('resume')).paused, false);
  const blocked = createStudioApi({ sessions }, { spawn(...args) {
    loaded.delete(id);
    return spawn(...args);
  } });
  const outcomes = await Promise.allSettled([
    blocked.action({ sessionId: id, action: 'pause', note: '仍然是状态记录' }),
    blocked.action({ sessionId: id, action: 'feedback', text: '会话卸载后不允许写入' }),
  ]);
  assert.equal(outcomes.filter(item => item.status === 'fulfilled').length, 1);
  assert.equal(outcomes.find(item => item.status === 'rejected').reason.code, 'SESSION_NOT_FOUND');
  loaded.set(id, { header: { cwd: root } });
  const project = await action('load');
  assert.equal(project.feedback.length, outcomes[1].status === 'fulfilled' ? 1 : 0);
  assert.equal(project.paused, outcomes[0].status === 'fulfilled');
});

test('路由导出与生命周期正确；GET/POST shape 和 brief 冲突契约', async t => {
  const { root, sessions } = await fixture(t);
  assert.equal(name, 'dsh-agent-studio');
  assert.deepEqual(inject, ['webServer', 'sessions']);
  const { request, handlers } = await routes(t, sessions);
  assert.deepEqual([...handlers.keys()], [projectRoute, actionRoute]);
  const empty = await request(projectRoute);
  assert.equal(empty.status, 200);
  assert.equal(empty.body.ok, true);
  assert.equal(empty.body.project.root, root);
  const initialized = await request(actionRoute, { body: { sessionId: id, action: 'init', name: '路由项目' } });
  assert.equal(initialized.status, 200);
  assert.equal(initialized.body.project.name, '路由项目');
  const revision = initialized.body.project.revision;
  const saved = await request(actionRoute, { body: { sessionId: id, action: 'brief', brief: '路由更新', revision } });
  assert.equal(saved.status, 200);
  const conflict = await request(actionRoute, { body: { sessionId: id, action: 'brief', brief: '路由冲突', revision } });
  assert.equal(conflict.status, 409);
  assert.deepEqual(conflict.body, { ok: false, error: '目标已被修改，请重新加载后再保存', code: 'REVISION_CONFLICT', revision: saved.body.project.revision });
});

test('目录别名先 realpath，管理目录链接和已有规则硬链接拒绝写入', async t => {
  const { root, action, api } = await fixture(t);
  const project = path.join(root, '实际项目');
  const alias = path.join(root, '项目别名');
  await mkdir(project);
  await action('init', { root: project });
  await symlink(project, alias, process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal((await action('load', { root: alias })).root, await realpath(project));
  const linked = path.join(root, '链接管理目录');
  await mkdir(linked);
  await symlink(path.join(project, '.studio'), path.join(linked, '.studio'), process.platform === 'win32' ? 'junction' : 'dir');
  await rejects(() => action('load', { root: linked }), 400, 'INVALID_PROJECT_PATH');
  const ruleProject = path.join(root, '硬链接规则');
  await mkdir(ruleProject);
  const source = path.join(root, '原规则');
  await writeFile(source, '原规则不能被覆盖');
  await link(source, path.join(ruleProject, 'AGENTS.md'));
  await rejects(() => action('init', { root: ruleProject }), 400, 'INVALID_PROJECT_PATH');
  assert.equal(await readFile(source, 'utf8'), '原规则不能被覆盖');
  assert.equal((await api.project(id)).initialized, false);
  const state = await readFile(path.join(project, '.studio/state.json'), 'utf8');
  await link(source, path.join(project, '.studio/state.json.tmp'));
  await rejects(() => action('feedback', { root: project, text: '不允许覆盖链接' }), 400, 'INVALID_PROJECT_PATH');
  assert.equal(await readFile(source, 'utf8'), '原规则不能被覆盖');
  assert.equal(await readFile(path.join(project, '.studio/state.json'), 'utf8'), state);
});

test('真实 HTTP 传输覆盖分块 body 限制、同源 GET 和 JSON action', async t => {
  const { root, sessions } = await fixture(t);
  const { handlers } = await routes(t, sessions);
  const server = createServer((req, res) => {
    const handler = handlers.get(new URL(req.url, 'http://localhost').pathname);
    if (!handler) { res.writeHead(404); res.end(); return; }
    handler(req, res);
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(() => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  const port = server.address().port;
  const origin = `http://127.0.0.1:${port}`;
  const send = (route, raw = '', headers = {}) => new Promise((resolve, reject) => {
    const request = httpRequest({
      hostname: '127.0.0.1', port, path: route, method: route.startsWith(projectRoute) ? 'GET' : 'POST',
      headers: { origin, 'content-type': 'application/json', ...headers },
    }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => {
        try { resolve({ status: response.statusCode, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) }); }
        catch (error) { reject(error); }
      });
    });
    request.on('error', reject);
    request.end(raw);
  });
  const get = `${projectRoute}?sessionId=${id}`;
  assert.equal((await send(get)).status, 200);
  assert.equal((await send(get, '', { origin: 'http://evil.test' })).status, 403);
  const initialized = await send(actionRoute, JSON.stringify({ sessionId: id, root, action: 'init', name: '真实 HTTP' }));
  assert.equal(initialized.status, 200);
  assert.equal(initialized.body.project.name, '真实 HTTP');
  const huge = JSON.stringify({ sessionId: id, action: 'feedback', text: '中'.repeat(50_000) });
  assert.equal((await send(actionRoute, huge, { 'transfer-encoding': 'chunked' })).status, 413);
  assert.equal((await send(actionRoute, '{invalid')).status, 400);
  const feedback = await send(actionRoute, JSON.stringify({ sessionId: id, action: 'feedback', text: '真实网络写入' }));
  assert.equal(feedback.status, 200);
  assert.deepEqual(feedback.body.project.feedback.map(item => item.text), ['真实网络写入']);
});

test('GET 和 POST 都校验同源、本机、方法；错误 JSON/类型/超大 body 不更改项目', async t => {
  const { root, sessions, action } = await fixture(t);
  await action('init');
  const before = await readFile(path.join(root, '.studio/state.json'), 'utf8');
  const { request } = await routes(t, sessions);
  const body = { sessionId: id, action: 'feedback', text: '必须拒绝' };
  for (const route of [projectRoute, actionRoute]) {
    for (const headers of [
      { origin: 'http://evil.test' },
      { origin: 'https://127.0.0.1:49276' },
      { origin: 'http://127.0.0.1:49277' },
      { origin: 'null' },
      { origin: undefined, 'sec-fetch-site': 'cross-site' },
      { 'sec-fetch-site': 'same-site' },
      { host: 'evil.test', origin: 'http://evil.test' },
    ]) assert.equal((await request(route, { headers, body })).status, 403);
    assert.equal((await request(route, { remote: '192.168.1.2', body })).status, 403);
    assert.equal((await request(route, { method: 'DELETE', body })).status, 405);
  }
  for (const raw of ['{bad', '', 'null', '[]', '123']) assert.equal((await request(actionRoute, { raw })).status, 400);
  assert.equal((await request(actionRoute, { headers: { 'content-type': 'text/plain' }, body })).status, 415);
  assert.equal((await request(actionRoute, { body: { ...body, action: 'dispatch' } })).status, 400);
  assert.equal((await request(actionRoute, { body: { ...body, sessionId: 'not-loaded' } })).status, 404);
  assert.equal((await request(actionRoute, { body: { ...body, text: '' } })).status, 400);
  assert.equal((await request(actionRoute, { raw: 'x'.repeat(128 * 1024 + 1) })).status, 413);
  assert.equal((await request(actionRoute, { headers: { 'content-length': String(128 * 1024 + 1) }, body })).status, 413);
  for (const suffix of ['', `?sessionId=${id}&root=${encodeURIComponent(root)}`, `?sessionId=${id}&sessionId=${id}`]) {
    assert.equal((await request(projectRoute, { url: projectRoute + suffix })).status, 400);
  }
  assert.equal((await request(projectRoute, { headers: { origin: undefined, 'sec-fetch-site': 'same-origin' } })).status, 200);
  assert.equal((await request(projectRoute, { remote: '::ffff:127.0.0.1' })).status, 200);
  assert.equal((await request(projectRoute, { remote: '::1', headers: { host: '[::1]:49276', origin: 'http://[::1]:49276' } })).status, 200);
  assert.equal(await readFile(path.join(root, '.studio/state.json'), 'utf8'), before);
});

test('宿主不可用不伪造清单；项目技能仅作未确认补充', async t => {
  const { root, action, api } = await fixture(t);
  const empty = await api.project(id);
  assert.deepEqual(empty.config, defaultConfig());
  assert.deepEqual(empty.skills, []);
  assert.deepEqual(empty.skillCatalog, defaultCatalog());
  const project = await action('init');
  assert.deepEqual(project.skills, ['project-director']);
  assert.equal(project.skillCatalog.available, false);
  for (const name of ['zeta', 'alpha']) {
    const dir = path.join(root, '.agents', 'skills', name);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'SKILL.md'), `# ${name}\n`);
  }
  await mkdir(path.join(root, '.agents', 'skills', 'no-skill'), { recursive: true });
  const discovered = await api.project(id);
  assert.deepEqual(discovered.skills, ['alpha', 'project-director', 'zeta']);
  assert.ok(discovered.skillCatalog.entries.every(skill => !skill.available && skill.status === 'unverified'));
  assert.equal(await realpath(path.join(root, '.agents')), path.join(root, '.agents'));
  await rm(path.join(root, '.agents'), { recursive: true, force: true });
  assert.deepEqual((await api.project(id)).skills, []);
});

test('宿主技能使用当前Agent scope，合并项目/配置并保留禁用、缺失和不完整状态', async t => {
  const { root, action, sessions, loaded } = await fixture(t);
  await action('init');
  await action('config', { config: { roles: { reviewer: { skills: ['absent-skill'] } } } });
  const before = await readFile(path.join(root, '.studio/state.json'), 'utf8');
  const agent = { session: loaded.get(id) };
  let complete = true, toolVisible = true;
  const skill = (name, modelInvocable = true) => ({ name, description: name, source: 'runtime', provider: 'host-provider', invocation: { modelInvocable, userInvocable: true } });
  let observe = async options => {
    assert.equal(options.cwd, root);
    assert.equal(options.scope, agent);
    assert.ok(options.signal instanceof AbortSignal);
    return { complete, skills: [skill('ponytail'), skill('project-director'), skill('user-only', false)] };
  };
  const host = {
    skills: { snapshot: options => observe(options) }, agents: { get: () => agent },
    tools: { get(name, scope) { assert.equal(name, 'skill'); assert.equal(scope, agent); return toolVisible ? { name: 'skill' } : undefined; } },
    workingDirectory: { get(session) { assert.equal(session, agent.session); return root; } },
  };
  const api = createStudioApi({ sessions }, { host: () => host });
  loaded.get(id).header.cwd = path.join(root, 'stale-header-directory');
  const found = await api.project(id);
  assert.equal(found.skillCatalog.available, true);
  assert.equal(found.skillCatalog.complete, true);
  assert.deepEqual(found.skills, ['ponytail', 'project-director', 'user-only']);
  const entry = (project, name) => project.skillCatalog.entries.find(skill => skill.name === name);
  assert.equal(entry(found, 'ponytail').available, true);
  assert.equal(entry(found, 'project-director').origin, 'host');
  assert.equal(entry(found, 'user-only').status, 'disabled');
  assert.equal(entry(found, 'absent-skill').status, 'missing');
  const { request, releaseHost } = await routes(t, sessions, host);
  assert.equal((await request(projectRoute)).body.project.skillCatalog.toolAvailable, true);
  releaseHost();
  loaded.get(id).header.cwd = root;
  assert.equal((await request(projectRoute)).body.project.skillCatalog.reason, 'HOST_SKILLS_UNAVAILABLE');
  complete = false;
  assert.equal(entry(await api.project(id), 'absent-skill').status, 'unverified');
  toolVisible = false;
  complete = true;
  const noTool = await api.project(id);
  assert.equal(noTool.skillCatalog.reason, 'SKILL_TOOL_UNAVAILABLE');
  assert.equal(entry(noTool, 'ponytail').available, false);
  observe = async () => { throw new Error('private host diagnostics must not leak'); };
  const failed = await api.project(id);
  assert.equal(failed.skillCatalog.reason, 'HOST_SKILLS_FAILED');
  assert.equal(JSON.stringify(failed).includes('private host diagnostics'), false);
  observe = async () => ({ skills: [], complete: 'yes' });
  assert.equal((await api.project(id)).skillCatalog.available, false);
  host.agents.get = () => undefined;
  assert.equal((await api.project(id)).skillCatalog.reason, 'SESSION_AGENT_UNAVAILABLE');
  assert.equal(await readFile(path.join(root, '.studio/state.json'), 'utf8'), before);
});

test('不完整Studio目录阻止未初始化子目录向上命中真实父账本', async t => {
  const { root, action } = await fixture(t);
  await action('init');
  const before = await readFile(path.join(root, '.studio/state.json'), 'utf8');
  const child = path.join(root, 'isolated');
  await mkdir(path.join(child, '.studio'), { recursive: true });
  const api = createStudioApi({ sessions: { get: () => ({ header: { cwd: child } }) } });
  assert.equal((await api.project(id)).root, await realpath(child));
  await rejects(() => api.action({ sessionId: id, action: 'config', config: { concurrency: 99 } }), 409, 'NOT_INITIALIZED');
  assert.equal(await readFile(path.join(root, '.studio/state.json'), 'utf8'), before);
});

test('安装中宿主SDK真实注册表、文件系统发现和skill加载集成', {
  skip: !process.env.AGENT_STUDIO_HOST_NODE || !process.env.AGENT_STUDIO_HOST_MODULES ? 'set host executable and public module directory to run installed SDK integration' : false,
}, async t => {
  const { root, action } = await fixture(t);
  await action('init');
  const probe = path.join(root, 'host-sdk.cjs');
  await writeFile(probe, `
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const base = process.env.AGENT_STUDIO_HOST_MODULES;
const { Context } = require(path.join(base, '@deepseek-ai/cordis/lib/index.js'));
const { SkillRegistry } = require(path.join(base, '@deepseek-ai/dsh-skill/lib/index.js'));
const { FileSystemSkillProvider } = require(path.join(base, '@deepseek-ai/dsh-skill-filesystem/lib/index.js'));
const { apply: installSkillTool } = require(path.join(base, '@deepseek-ai/dsh-tool-skill/lib/index.js'));
const { createStudioApi } = require(${JSON.stringify(fileURLToPath(new URL('../core.js', import.meta.url)))});
(async () => {
  const root = ${JSON.stringify(root)};
  assert.equal(fs.realpathSync(root), root);
  assert.ok(fs.statSync(path.join(root, '.studio/state.json')).isFile());
  const ctx = new Context();
  const registry = new SkillRegistry(ctx);
  const controller = new AbortController();
  const provider = new FileSystemSkillProvider(ctx, { signal: controller.signal, invalidate() {} }, { watch: false });
  const dispose = registry.registerProvider(() => provider);
  let skillTool;
  const session = { header: { cwd: root } };
  const agent = { session };
  const tools = { register(tool) { skillTool = tool; }, get() { return skillTool; } };
  installSkillTool({ tools, skills: registry, workingDirectory: { ensure: async () => root }, on() {} });
  const api = createStudioApi({
    sessions: { get: () => session }, agents: { get: () => agent }, tools, skills: registry,
    workingDirectory: { get: () => root },
  });
  const snapshot = await api.project('sdk-probe');
  assert.equal(snapshot.root, root);
  assert.equal(snapshot.skillCatalog.available, true);
  assert.equal(snapshot.skillCatalog.complete, true);
  const ponytail = snapshot.skillCatalog.entries.find(skill => skill.name === 'ponytail');
  assert.equal(ponytail.origin, 'host');
  assert.equal(ponytail.available, true);
  assert.equal(ponytail.provider, 'filesystem');
  assert.equal(ponytail.source, 'user-agents');
  const loaded = await skillTool.execute({ name: 'ponytail' }, { agent, signal: AbortSignal.timeout(2500) });
  assert.equal(loaded.name, 'ponytail');
  assert.ok(loaded.content.includes('Ponytail'));
  const handlers = new Map();
  ctx.provide('sessions', { get: () => session });
  ctx.provide('agents', { get: () => agent });
  ctx.provide('tools', tools);
  ctx.provide('workingDirectory', { get: () => root });
  ctx.provide('webServer', { register(route) { handlers.set(route.path, route.handler); return () => handlers.delete(route.path); } });
  const mounted = ctx.plugin(require(${JSON.stringify(fileURLToPath(new URL('../index.js', import.meta.url)))}));
  await mounted;
  await Promise.all([...ctx.registry.values()].flatMap(runtime => [...runtime.fibers].map(fiber => fiber.await())));
  const { Readable } = require('node:stream');
  const request = Readable.from([]);
  request.method = 'GET'; request.url = '/agent-studio/api/project?sessionId=sdk-probe';
  request.socket = { remoteAddress: '127.0.0.1' };
  request.headers = { host: '127.0.0.1:54004', origin: 'http://127.0.0.1:54004' };
  let response;
  await handlers.get('/agent-studio/api/project')(request, {
    writeHead(status) { assert.equal(status, 200); }, end(body) { response = JSON.parse(body); },
  });
  assert.equal(response.project.skillCatalog.available, true);
  assert.equal(response.project.skillCatalog.entries.find(skill => skill.name === 'ponytail').available, true);
  await mounted.dispose();
  assert.equal(handlers.size, 0);
  console.log(JSON.stringify({ source: ponytail.source, provider: ponytail.provider, confirmed: snapshot.skills.length, loaded: loaded.name }));
  dispose();
  await provider.dispose();
})().catch(error => { console.error(error); process.exitCode = 1; });
`);
  const result = await new Promise((resolve, reject) => {
    const child = spawn(process.env.AGENT_STUDIO_HOST_NODE, [probe], {
      cwd: root, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '', stderr = '';
    child.stdout.on('data', value => { stdout += value; });
    child.stderr.on('data', value => { stderr += value; });
    child.once('error', reject);
    child.once('close', code => resolve({ code, stdout, stderr }));
  });
  assert.equal(result.code, 0, result.stderr);
  const summary = JSON.parse(result.stdout.trim());
  assert.equal(summary.loaded, 'ponytail');
  assert.ok(summary.confirmed > 1);
  t.diagnostic(`installed SDK: ${summary.provider}/${summary.source}; loaded=${summary.loaded}; confirmed=${summary.confirmed}`);
});

test('action config 校验后原子落盘并返回新 config；reset-config 恢复默认', async t => {
  const { root, action, api } = await fixture(t);
  await action('init');
  const chosen = sampleConfig();
  const saved = await action('config', { config: chosen });
  assert.deepEqual(saved.config, chosen);
  assert.deepEqual(Object.keys(saved).sort(), ['initialized', 'root', 'name', 'paused', 'counts', 'tasks', 'feedback', 'handoff', 'brief', 'revision', 'cliCompatibility', 'config', 'skills', 'skillCatalog'].sort());
  const onDisk = JSON.parse(await readFile(path.join(root, '.studio/state.json'), 'utf8'));
  assert.deepEqual(onDisk.config, chosen);
  assert.deepEqual((await api.project(id)).config, chosen);
  // 缺省字段经 normalize 补齐后写入
  const partial = await action('config', { config: { concurrency: 7 } });
  assert.equal(partial.config.concurrency, 7);
  assert.deepEqual(partial.config.roles, defaultConfig().roles);
  // reset-config 恢复默认并落盘
  const reset = await action('reset-config');
  assert.deepEqual(reset.config, defaultConfig());
  assert.deepEqual(JSON.parse(await readFile(path.join(root, '.studio/state.json'), 'utf8')).config, defaultConfig());
});

test('非法 config 被拒绝且不改变原值', async t => {
  const { root, action, api } = await fixture(t);
  await action('init');
  const chosen = sampleConfig();
  await action('config', { config: chosen });
  const before = await readFile(path.join(root, '.studio/state.json'), 'utf8');
  const illegal = [
    { config: { concurrency: 0 } },
    { config: { concurrency: 101 } },
    { config: { concurrency: '2' } },
    { config: { version: '9.9.9' } },
    { config: { fastTrackLowRisk: 'yes' } },
    { config: { unknownField: true } },
    { config: { roles: { director: { mode: 'subagent' } } } },
    { config: { roles: { engineer: { routes: { coding: { reasoningEffort: 'ultra' } } } } } },
    { config: { roles: { reviewer: { skills: 'not-array' } } } },
    { config: [] },
    { config: 'nope' },
  ];
  for (const body of illegal) await rejects(() => action('config', body), 400);
  assert.equal(await readFile(path.join(root, '.studio/state.json'), 'utf8'), before);
  assert.deepEqual((await api.project(id)).config, chosen);
});

test('config 写入与项目独立 CLI 并发遵循同一账本锁，不丢其它状态', async t => {
  const { root, action, api } = await fixture(t);
  await action('init');
  await action('feedback', { text: '并发前反馈' });
  const cliDir = path.join(root, 'cfg');
  await mkdir(cliDir);
  const writes = [];
  for (let i = 0; i < 6; i++) {
    const file = path.join(cliDir, `c${i}.json`);
    await writeFile(file, JSON.stringify({ concurrency: i + 1 }));
    writes.push(runProjectCli(root, ['config', file]));
  }
  for (let i = 0; i < 6; i++) {
    writes.push(api.action({ sessionId: id, action: 'config', config: { concurrency: i + 3 } }));
  }
  await Promise.all(writes);
  const state = JSON.parse(await readFile(path.join(root, '.studio/state.json'), 'utf8'));
  assert.equal(state.config.version, '0.2.0');
  assert.ok(Number.isSafeInteger(state.config.concurrency) && state.config.concurrency >= 1 && state.config.concurrency <= 100);
  assert.deepEqual(state.config.roles, defaultConfig().roles);
  assert.equal(state.inbox.length, 1);
  assert.equal(state.inbox[0].text, '并发前反馈');
  assert.deepEqual((await readdir(path.join(root, '.studio'))).filter(n => n.endsWith('.tmp') || n.endsWith('.lock')), []);
  assert.deepEqual((await api.project(id)).config, state.config);
});
