import { lstat, realpath, readFile, writeFile, rename, unlink, readdir, open } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { normalizeConfig, resetConfig } from '../bin/studio.mjs';

const cli = fileURLToPath(new URL('../bin/studio.mjs', import.meta.url));
const actions = new Set(['load', 'init', 'resume', 'feedback', 'pause', 'brief', 'config', 'reset-config']);

const statuses = ['todo', 'in_progress', 'review', 'done'];
const writes = new Map();
const revisionOf = text => createHash('sha256').update(text, 'utf8').digest('hex');
const originalCliHashes = new Set([
  '91c404ef83db910fb5080098dd2b1a723076b08711533249d1cde85dd5b20dfd',
  'd23c689a6bcaeb02b2ce30b2c345cca7bc4b4de0483ab266f917657d2349e9d5',
  'f8ad29277bec0a5f2ca03101c8e38872a84447fe68cfb805dc0e5999928b3d4a',
  '9873ff91a774ce8a933d549761871bf36261135c72bcf83adec531df6998085a',
  '6b59a1afe8f095dede7bea5abe08a3ec4226daa52f9d7de1daa1836c6954b611',
  '6c7ee7a1837aefc296e03fdd2b5fdfc60fb0bdc73529002abd37527f027c6cc3',
]);
const sha256 = data => createHash('sha256').update(data).digest('hex');
export const fail = (message, status = 400, code = 'INVALID_REQUEST') => Object.assign(new Error(message), { status, code });

function text(value, label) {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0')) throw fail(`${label} 不能为空且不能包含 NUL`);
  return value.trim();
}

function localPath(value) {
  if (typeof value !== 'string' || !value.trim() || !path.isAbsolute(value) || /[\x00-\x1f]/.test(value) || /^[/\\]{2}/.test(value) ||
      (process.platform === 'win32' && !/^[A-Za-z]:[/\\]/.test(value))) {
    throw fail('root 必须是已存在的本机绝对目录', 400, 'INVALID_ROOT');
  }
  return value;
}

async function entry(file, directory, optional = false) {
  let stat;
  try { stat = await lstat(file); }
  catch (error) {
    if (optional && error.code === 'ENOENT') return null;
    throw fail(`无法访问项目管理路径：${file}`, ['EACCES', 'EPERM'].includes(error.code) ? 403 : error.code === 'ENOENT' ? 404 : 500, 'PROJECT_IO_ERROR');
  }
  if (stat.isSymbolicLink() || (directory ? !stat.isDirectory() : !stat.isFile() || stat.nlink > 1)) {
    throw fail(`项目管理路径必须是普通${directory ? '目录' : '文件'}，不允许链接：${file}`, 400, 'INVALID_PROJECT_PATH');
  }
  return stat;
}

async function projectRoot(input) {
  let start;
  try { start = localPath(await realpath(localPath(input))); }
  catch (error) {
    if (error.status) throw error;
    throw fail('root 不存在或无法访问', ['EACCES', 'EPERM'].includes(error.code) ? 403 : 404, 'ROOT_NOT_FOUND');
  }
  await entry(start, true);
  for (let dir = start; ; dir = path.dirname(dir)) {
    if (await entry(path.join(dir, '.studio'), true, true)) {
      if (await entry(path.join(dir, '.studio', 'state.json'), false, true)) return dir;
      return start; // An incomplete Studio directory must not redirect writes to an ancestor ledger.
    }
    if (path.dirname(dir) === dir) return start;
  }
}

async function inScope(root, run) {
  const key = process.platform === 'win32' ? root.toLowerCase() : root;
  const pending = (writes.get(key) ?? Promise.resolve()).catch(() => {}).then(run);
  writes.set(key, pending);
  try { return await pending; }
  finally { if (writes.get(key) === pending) writes.delete(key); }
}

async function cliCompatibility(dir) {
  const file = path.join(dir, 'studio.mjs');
  let stat;
  try { stat = await lstat(file); }
  catch (error) {
    if (error.code === 'ENOENT') return 'missing';
    throw fail(`无法访问项目 CLI：${file}`, ['EACCES', 'EPERM'].includes(error.code) ? 403 : 500, 'PROJECT_IO_ERROR');
  }
  if (stat.isSymbolicLink() || !stat.isFile() || stat.nlink > 1) return 'invalid';
  try {
    const [project, current] = await Promise.all([readFile(file), readFile(cli)]);
    const digest = sha256(project);
    return digest === sha256(current) ? 'current' : originalCliHashes.has(digest) ? 'legacy' : 'custom';
  } catch (error) {
    throw fail(`无法读取项目 CLI：${error.message}`, ['EACCES', 'EPERM'].includes(error.code) ? 403 : 500, 'PROJECT_IO_ERROR');
  }
}

async function projectSkills(root) {
  let entries;
  try { entries = await readdir(path.join(root, '.agents', 'skills'), { withFileTypes: true }); }
  catch (error) {
    if (['ENOENT', 'ENOTDIR'].includes(error.code)) return [];
    if (['EACCES', 'EPERM'].includes(error.code)) throw fail('无法读取项目技能目录', 403, 'PROJECT_IO_ERROR');
    throw fail(`无法读取项目技能目录：${error.message}`, 500, 'PROJECT_IO_ERROR');
  }
  const names = [];
  for (const dir of entries) {
    if (!dir.isDirectory()) continue;
    try {
      const stat = await lstat(path.join(root, '.agents', 'skills', dir.name, 'SKILL.md'));
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink > 1) continue;
    } catch (error) {
      if (['ENOENT', 'ENOTDIR'].includes(error.code)) continue;
      if (['EACCES', 'EPERM'].includes(error.code)) throw fail('无法读取项目技能清单', 403, 'PROJECT_IO_ERROR');
      throw fail(`无法读取项目技能清单：${error.message}`, 500, 'PROJECT_IO_ERROR');
    }
    names.push(dir.name);
  }
  return names.sort();
}

async function discoverSkills(host, agent, root, config) {
  const project = await projectSkills(root);
  const configured = new Set([
    ...config.roles.director.skills, ...config.roles.reviewer.skills,
    ...Object.values(config.roles.engineer.routes).flatMap(route => route.skills),
  ]);
  const entries = new Map(project.map(name => [name, {
    name, source: 'project-agents', provider: 'project-scan', origin: 'project',
    available: false, status: 'unverified',
  }]));
  const catalog = {
    source: 'host.skills.snapshot', available: false, complete: false, toolAvailable: false,
    reason: 'HOST_SKILLS_UNAVAILABLE',
  };
  if (host && typeof host.skills?.snapshot === 'function') {
    if (!agent) catalog.reason = 'SESSION_AGENT_UNAVAILABLE';
    else {
      try {
        // Match the host skill tool's agent scope; a global catalog misses preset-local providers.
        const observed = await host.skills.snapshot({ cwd: root, scope: agent, signal: AbortSignal.timeout(2500) });
        if (!observed || typeof observed.complete !== 'boolean' || !Array.isArray(observed.skills) ||
            !observed.skills.every(skill => skill && typeof skill.name === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(skill.name) &&
              typeof skill.source === 'string' && typeof skill.provider === 'string' &&
              typeof skill.invocation?.modelInvocable === 'boolean' && typeof skill.invocation?.userInvocable === 'boolean')) {
          throw fail('宿主技能摘要格式无效');
        }
        catalog.toolAvailable = typeof host.tools?.get === 'function' && Boolean(host.tools.get('skill', agent));
        catalog.available = true;
        catalog.complete = observed.complete;
        catalog.reason = !observed.complete ? 'HOST_SKILLS_INCOMPLETE' : !catalog.toolAvailable ? 'SKILL_TOOL_UNAVAILABLE' : null;
        for (const skill of observed.skills) entries.set(skill.name, {
          name: skill.name, description: skill.description ?? '', source: skill.source, provider: skill.provider,
          origin: 'host', invocation: { modelInvocable: skill.invocation.modelInvocable, userInvocable: skill.invocation.userInvocable },
          available: catalog.toolAvailable && skill.invocation.modelInvocable,
          status: !skill.invocation.modelInvocable ? 'disabled' : catalog.toolAvailable ? 'available' : 'unavailable',
        });
      } catch {
        catalog.reason = 'HOST_SKILLS_FAILED';
      }
    }
  }
  for (const name of configured) {
    if (entries.has(name)) continue;
    entries.set(name, {
      name, source: 'config', provider: null, origin: 'config', available: false,
      status: catalog.complete ? 'missing' : 'unverified',
    });
  }
  catalog.entries = [...entries.values()].sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
    .map(skill => ({ ...skill, configured: configured.has(skill.name) }));
  return {
    skills: catalog.entries.filter(skill => skill.origin !== 'config').map(skill => skill.name),
    skillCatalog: catalog,
  };
}

// Field-level completion of stored config against defaults; never throws, falls back per field.
function normalizeStored(input, base = normalizeConfig({})) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return base;
  const result = {};
  for (const [key, fallback] of Object.entries(base)) {
    const value = Object.hasOwn(input, key) ? input[key] : undefined;
    if (fallback && typeof fallback === 'object' && !Array.isArray(fallback)) {
      result[key] = normalizeStored(value, fallback);
    } else if (Array.isArray(fallback)) {
      result[key] = Array.isArray(value) && value.every(item => typeof item === 'string') ? [...value] : [...fallback];
    } else if (typeof value === typeof fallback) {
      result[key] = value;
    } else {
      result[key] = fallback;
    }
  }
  return result;
}

async function snapshot(root, host, agent) {
  const empty = {
    initialized: false, root, name: path.basename(root) || root, paused: false,
    counts: Object.fromEntries(statuses.map(status => [status, 0])),
    tasks: [], feedback: [], handoff: null, brief: '', revision: null, cliCompatibility: null,
    config: normalizeConfig({}),
  };
  const dir = path.join(root, '.studio');
  if (!await entry(dir, true, true) || !await entry(path.join(dir, 'state.json'), false, true)) {
    return { ...empty, ...await discoverSkills(host, agent, root, empty.config) };
  }
  let state;
  try { state = JSON.parse(await readFile(path.join(dir, 'state.json'), 'utf8')); }
  catch (error) {
    throw fail(`无法读取 Studio 状态：${error.message}`, 422, 'INVALID_STATE');
  }
  if (!state || typeof state !== 'object' || Array.isArray(state) || typeof state.name !== 'string' ||
      typeof state.paused !== 'boolean' || !Array.isArray(state.tasks) || !Array.isArray(state.inbox) ||
      ![...state.tasks, ...state.inbox].every(item => item && typeof item === 'object' && !Array.isArray(item))) {
    throw fail('Studio 状态格式无效', 422, 'INVALID_STATE');
  }
  const briefFile = path.join(dir, 'BRIEF.md');
  await entry(briefFile, false);
  const brief = await readFile(briefFile, 'utf8');
  const config = normalizeStored(state.config);
  return {
    initialized: true, root, name: state.name, paused: state.paused,
    counts: Object.fromEntries(statuses.map(status => [status, state.tasks.filter(task => task.status === status).length])),
    tasks: state.tasks, feedback: state.inbox, handoff: state.handoff ?? null,
    brief, revision: revisionOf(brief), cliCompatibility: await cliCompatibility(dir),
    config, ...await discoverSkills(host, agent, root, config),
  };
}

export function createStudioApi(ctx, { spawn: spawnProcess = spawn, host: hostContext = () => ctx } = {}) {
  function session(id) {
    text(id, 'sessionId');
    const loaded = ctx.sessions.get(id);
    if (!loaded) throw fail('会话不存在或未载入', 404, 'SESSION_NOT_FOUND');
    return loaded;
  }

  function takeSnapshot(root, id) {
    const loaded = ctx.sessions.get(id);
    const host = hostContext();
    const agent = host?.agents?.get?.(id);
    return snapshot(root, host, agent?.session === loaded ? agent : undefined);
  }

  function runCli(args, cwd) {
    return new Promise((resolve, reject) => {
      const child = spawnProcess(process.execPath, [cli, ...args], {
        cwd, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stderr = '';
      child.stdout.resume();
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(0, 8192); });
      child.once('error', error => reject(fail(`无法启动 Studio CLI：${error.message}`, 500, 'CLI_START_FAILED')));
      child.once('close', (code, signal) => {
        if (code === 0) { resolve(); return; }
        let message = stderr.trim();
        try { message = JSON.parse(message).error || message; } catch {}
        reject(fail(message || `Studio CLI 执行失败（${signal || code}）`, 422, 'CLI_FAILED'));
      });
    });
  }

  async function withProject(id, input, run) {
    const loaded = session(id);
    const root = await projectRoot(input === undefined ? hostContext()?.workingDirectory?.get?.(loaded) ?? loaded.header?.cwd : input);
    return inScope(root, async () => {
      session(id); // A queued operation must not outlive its loaded session.
      return run(root);
    });
  }

  // Cross-process lock shared with bin/studio.mjs (state.json.lock), same owner record and recovery rules.
  async function acquireLock(dir, run) {
    const file = path.join(dir, 'state.json.lock');
    const owner = JSON.stringify({ host: os.hostname(), pid: process.pid, token: randomUUID() });
    const deadline = Date.now() + 5000;
    let handle;
    while (handle === undefined) {
      try { handle = await open(file, 'wx', 0o600); }
      catch (error) {
        if (error.code !== 'EEXIST') throw fail(`无法创建账本锁：${error.message}`, 500, 'PROJECT_IO_ERROR');
        if (Date.now() >= deadline) throw fail(`账本锁被占用：${file}`, 423, 'LEDGER_LOCKED');
        await new Promise(resolve => setTimeout(resolve, 20 + Math.floor(Math.random() * 30)));
      }
    }
    let written = false, started = false, outcome, failure;
    try {
      await handle.writeFile(owner);
      written = true;
      await handle.close();
      handle = undefined;
      started = true;
      outcome = await run();
    } catch (error) { failure = error; }
    try {
      if (handle) await handle.close().catch(() => {});
      if (written) {
        if (await readFile(file, 'utf8') !== owner) throw fail('锁所有者已变化，请检查账本', 500, 'LEDGER_LOCK_ERROR');
        await unlink(file);
      }
    } catch (error) {
      throw fail(`${started ? '操作可能已提交，请先查看账本，勿直接重试' : '锁创建未完成'}：${error.message}`, 500, 'LEDGER_LOCK_ERROR');
    }
    if (failure) {
      if (!written) throw fail(`锁创建未完成：${failure.message}`, 500, 'LEDGER_LOCK_ERROR');
      throw failure;
    }
    return outcome;
  }

  // Read current config under its own lock, normalize, write atomically via temp + rename.
  async function saveConfig(root, produce) {
    const dir = path.join(root, '.studio');
    const file = path.join(dir, 'state.json');
    await entry(file, false);
    return acquireLock(dir, async () => {
      let state;
      try { state = JSON.parse(await readFile(file, 'utf8')); }
      catch (error) { throw fail(`无法读取 Studio 状态：${error.message}`, 422, 'INVALID_STATE'); }
      if (!state || typeof state !== 'object' || Array.isArray(state)) throw fail('Studio 状态格式无效', 422, 'INVALID_STATE');
      state.config = produce(state.config);
      state.updatedAt = new Date().toISOString();
      const temp = path.join(dir, `.${path.basename(file)}-${randomUUID()}.tmp`);
      try {
        await writeFile(temp, JSON.stringify(state, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
        await rename(temp, file);
      } finally {
        await unlink(temp).catch(error => { if (error.code !== 'ENOENT') throw error; });
      }
      return state.config;
    });
  }

  return {
    project(id) { return withProject(id, undefined, root => takeSnapshot(root, id)); },
    async action(body) {
      if (!body || typeof body !== 'object' || Array.isArray(body) || !actions.has(body.action)) {
        throw fail('action 必须是 load/init/resume/feedback/pause/brief/config/reset-config', 400, 'INVALID_ACTION');
      }
      const { sessionId, root: input, action } = body;
      return withProject(sessionId, input, async root => {
        const project = await takeSnapshot(root, sessionId);
        if (action === 'load') return project;
        if (project.initialized && ['config', 'reset-config', 'brief'].includes(action) && project.cliCompatibility !== 'current') {
          throw fail('项目 CLI 尚未升级或无法验证；请停止所有旧进程，检查或升级项目 CLI 后再保存。', 409, 'CLI_INCOMPATIBLE');
        }
        if (action === 'config' || action === 'reset-config') {
          if (action === 'reset-config' && body.config !== undefined) throw fail('reset-config 不接受 config 参数');
          const produce = action === 'reset-config'
            ? () => resetConfig()
            : () => {
              try { return normalizeConfig(body.config === undefined ? {} : body.config); }
              catch (error) { throw fail(error.message, 400, 'INVALID_CONFIG'); }
            };
          if (action === 'config') {
            // Validate before any write so a bad config leaves the ledger untouched.
            produce();
          }
          if (!project.initialized) throw fail('项目尚未初始化', 409, 'NOT_INITIALIZED');
          const config = await saveConfig(root, produce);
          return { ...(await takeSnapshot(root, sessionId)), config };
        }
        if (action === 'init') {
          if (project.initialized) throw fail('项目已初始化，请使用 load 或 resume', 409, 'ALREADY_INITIALIZED');
          const name = body.name === undefined ? path.basename(root) || root : text(body.name, 'name');
          for (const host of ['.agents', '.claude']) {
            for (const suffix of [host, `${host}/skills`, `${host}/skills/project-director`]) await entry(path.join(root, suffix), true, true);
            await entry(path.join(root, host, 'skills/project-director/SKILL.md'), false, true);
          }
          for (const file of ['AGENTS.md', 'CLAUDE.md']) await entry(path.join(root, file), false, true);
          await runCli(['init', root, `--name=${name}`], root);
        } else {
          if (!project.initialized) throw fail('项目尚未初始化', 409, 'NOT_INITIALIZED');
          if (action === 'brief') {
            if (typeof body.brief !== 'string' || body.brief.includes('\0')) throw fail('brief 必须是文本且不能包含 NUL');
            if (typeof body.revision !== 'string' || !/^[a-f0-9]{64}$/.test(body.revision)) throw fail('brief 更新需要有效 revision');
            if (body.revision !== project.revision) {
              throw Object.assign(fail('目标已被修改，请重新加载后再保存', 409, 'REVISION_CONFLICT'), { revision: project.revision });
            }
            const file = path.join(root, '.studio', 'BRIEF.md');
            const temp = path.join(root, '.studio', `.BRIEF-${randomUUID()}.tmp`);
            try {
              await writeFile(temp, body.brief, { encoding: 'utf8', flag: 'wx' });
              await rename(temp, file);
            } finally {
              await unlink(temp).catch(error => { if (error.code !== 'ENOENT') throw error; });
            }
          } else {
            await entry(path.join(root, '.studio', 'state.json.tmp'), false, true);
            if (action === 'resume') await runCli(['resume', '--continue'], root);
            if (action === 'feedback') await runCli(['feedback', '--', text(body.text, 'text')], root);
            if (action === 'pause') await runCli(['pause', `--note=${text(body.note, 'note')}`], root);
          }
        }
        return takeSnapshot(root, sessionId);
      });
    },
  };
}
