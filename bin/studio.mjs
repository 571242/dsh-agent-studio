#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createHash, randomUUID } from 'node:crypto';
import { hostname } from 'node:os';

const self = fileURLToPath(import.meta.url);
const isMain = process.argv[1] && path.resolve(process.argv[1]) === self;
const { positionals, values: opt } = parseArgs({
  args: isMain ? process.argv.slice(2) : [],
  allowPositionals: true,
  options: {
    task: { type: 'string' }, worker: { type: 'string' }, mode: { type: 'string' },
    role: { type: 'string' }, model: { type: 'string' }, risk: { type: 'string' },
    route: { type: 'string' },
    name: { type: 'string' }, limit: { type: 'string' },
    summary: { type: 'string' }, evidence: { type: 'string', multiple: true },
    result: { type: 'string' }, reviewer: { type: 'string' },
    note: { type: 'string' }, reason: { type: 'string' },
    continue: { type: 'boolean', default: false },
    'confirm-stopped': { type: 'boolean', default: false },
  },
});
const [command = 'help', arg] = positionals;
const emit = value => console.log(JSON.stringify(value, null, 2));
const now = () => new Date().toISOString();
const need = (condition, message) => { if (!condition) throw new Error(message); };
const text = (value, label) => {
  need(typeof value === 'string' && value.trim(), `${label} 不能为空`);
  return value.trim();
};
const json = file => JSON.parse(fs.readFileSync(file, 'utf8'));
export const DEFAULT_CONFIG = {
  version: '0.2.0', concurrency: 2, fastTrackLowRisk: true,
  roles: {
    director: { mode: 'main', provider: 'main', model: 'current', reasoningEffort: 'default', skills: [] },
    engineer: { mode: 'subagent', routes: {
      coding: { provider: 'workbuddy-subscription', model: 'deepseek-v4.1-flash', reasoningEffort: 'high', skills: ['ponytail', 'code-simplification'] },
      debug: { provider: 'codex-chatgpt', model: 'gpt-6.1-terra', reasoningEffort: 'high', skills: ['systematic-debugging'] },
      visual: { provider: 'antigravity', model: 'gemini-3.8-flash', reasoningEffort: 'high', skills: ['frontend-design'] },
    } },
    reviewer: { mode: 'subagent', provider: 'workbuddy-subscription', model: 'deepseek-v4.1-flash', reasoningEffort: 'high', skills: ['verification-before-completion'] },
  },
};
export const resetConfig = () => structuredClone(DEFAULT_CONFIG);
export function normalizeConfig(input = {}) {
  function merge(base, value, key = 'config') {
    need(value !== null && typeof value === 'object' && !Array.isArray(value), `${key} 必须是对象`);
    for (const name of Object.keys(value)) need(Object.hasOwn(base, name), `未知配置字段：${key}.${name}`);
    const result = {};
    for (const [name, fallback] of Object.entries(base)) {
      const v = Object.hasOwn(value, name) ? value[name] : fallback;
      const field = `${key}.${name}`;
      if (Array.isArray(fallback)) {
        need(Array.isArray(v) && v.every(x => typeof x === 'string' && x.trim()), `${field} 必须是非空字符串数组`);
        result[name] = [...v];
      } else if (fallback && typeof fallback === 'object') result[name] = merge(fallback, v, field);
      else {
        need(typeof v === typeof fallback, `${field} 类型错误`);
        if (typeof v === 'string') need(v.trim(), `${field} 不能为空`);
        if (name === 'version') need(v === '0.2.0', `${field} 版本不支持`);
        if (name === 'concurrency') need(Number.isSafeInteger(v) && v >= 1 && v <= 100, `${field} 必须在 1 到 100 之间`);
        if (name === 'mode') need((key.endsWith('.director') ? ['main'] : ['subagent', 'teammate']).includes(v), `${field} 无效`);
        if (name === 'reasoningEffort') need(['default', 'low', 'medium', 'high', 'xhigh'].includes(v), `${field} 无效`);
        result[name] = v;
      }
    }
    return result;
  }
  return merge(DEFAULT_CONFIG, input);
}
function mergeConfig(base, update) {
  if (!update || typeof update !== 'object' || Array.isArray(update)) return update;
  const result = { ...base };
  for (const [key, value] of Object.entries(update)) {
    result[key] = value && typeof value === 'object' && !Array.isArray(value)
      ? mergeConfig(base?.[key], value) : value;
  }
  return result;
}
const help = `Agent Studio — 本地项目协作，零依赖 / 不注册 MCP 工具

首次：node bin/studio.mjs init TARGET --name "项目名"
以后：node .studio/studio.mjs COMMAND（在项目根目录执行）

status / resume                       查看进度 / 读取交接包
resume --continue                     解除暂停，准备继续派工
brief                                 查看项目目标
plan FILE.json                        追加有依赖和验收条目的任务
revise ID FILE.json --reason TEXT      修订任务定义，下游重新验收
show ID                               查看任务详情
dispatch [--limit N] [--task ID] [--route coding|debug|visual] [--worker NAME] [--mode subagent|teammate] [--role engineer|reviewer] [--model PROVIDER/MODEL] [--risk low|high]
                                      认领就绪任务按 config 路由输出任务包（默认 coding；并发受 config.concurrency 约束）
submit ID --summary TEXT --evidence TEXT
review ID --result pass|fail --reviewer NAME --evidence TEXT
pause --note TEXT                      保存交接说明并暂停派工
release ID --note TEXT                 确认 worker 停止后释放任务
reopen ID --reason TEXT                任务及下游重新进入待办
feedback TEXT                         收集修改意见
feedback-done N --note TEXT            记录意见的处理结果
config [FILE.json]                    查看或更新配置
reset-config                          恢复默认配置
doctor                                检查任务依赖和文件范围
upgrade TARGET --confirm-stopped      停止所有写入后升级已知原版项目 CLI

CLI 只管理状态；主 Agent 调用宿主原生子 Agent 执行与验收。
`;

const originalCliHashes = new Set(['91c404ef83db910fb5080098dd2b1a723076b08711533249d1cde85dd5b20dfd', 'd23c689a6bcaeb02b2ce30b2c345cca7bc4b4de0483ab266f917657d2349e9d5', 'f8ad29277bec0a5f2ca03101c8e38872a84447fe68cfb805dc0e5999928b3d4a', '9873ff91a774ce8a933d549761871bf36261135c72bcf83adec531df6998085a']);
const digest = data => createHash('sha256').update(data).digest('hex');
const delay = new Int32Array(new SharedArrayBuffer(4));
const wait = ms => Atomics.wait(delay, 0, 0, ms);

function regularFile(file) {
  const stat = fs.lstatSync(file);
  need(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1, `不允许链接或非普通文件：${file}`);
  return stat;
}

function atomicWrite(file, data, mode = 0o666) {
  const temp = path.join(path.dirname(file), `.${path.basename(file)}-${randomUUID()}.tmp`);
  let created = false;
  try {
    const fd = fs.openSync(temp, 'wx', mode);
    created = true;
    try { fs.writeFileSync(fd, data); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    for (let attempt = 0; ; attempt++) {
      try { fs.renameSync(temp, file); break; }
      catch (error) {
        if (!['EPERM', 'EACCES', 'EBUSY'].includes(error.code) || attempt === 19) throw error;
        wait(25);
      }
    }
    created = false;
  } finally {
    if (created) { try { fs.unlinkSync(temp); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
  }
}

function withLock(dir, run) {
  const lock = path.join(dir, 'state.json.lock');
  const owner = JSON.stringify({ host: hostname(), pid: process.pid, token: randomUUID() });
  const deadline = Date.now() + 5000;
  let fd;
  while (fd === undefined) {
    try { fd = fs.openSync(lock, 'wx', 0o600); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (Date.now() >= deadline) throw new Error(`账本锁被占用：${lock}；确认所有写入进程停止后按 README 恢复`);
      wait(20 + Math.floor(Math.random() * 30));
    }
  }
  let written = false, started = false, outcome, failure;
  try {
    fs.writeFileSync(fd, owner);
    written = true;
    fs.closeSync(fd);
    fd = undefined;
    started = true;
    outcome = run();
  } catch (error) { failure = error; }
  try {
    if (fd !== undefined) fs.closeSync(fd);
    // An incomplete owner record is left intact for offline recovery.
    if (written) {
      need(fs.readFileSync(lock, 'utf8') === owner, '锁所有者已变化');
      fs.unlinkSync(lock);
    }
  } catch (error) {
    throw new Error(`${started ? '操作可能已提交，请先查看账本，勿直接重试' : '锁创建未完成'}；确认所有写入进程停止后按 README 处理锁 ${lock}：${error.message}`);
  }
  if (failure) {
    if (!written) throw new Error(`锁创建未完成；确认所有写入进程停止后按 README 处理锁 ${lock}：${failure.message}`);
    throw failure;
  }
  return outcome;
}

function requireProjectCli(dir) {
  const projectCli = path.join(dir, 'studio.mjs');
  try {
    regularFile(projectCli);
    const current = digest(fs.readFileSync(self));
    const target = digest(fs.readFileSync(projectCli));
    if (target === current) return;
    if (originalCliHashes.has(target)) throw new Error('项目 CLI 尚未升级，拒绝写账本；请停止所有旧进程并按 README 执行 upgrade');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  throw new Error('项目 CLI 与当前版本不一致或可能包含定制，拒绝写账本；请停止所有旧进程并人工迁移');
}

function ignoreLedgerArtifacts(dir) {
  const file = path.join(dir, '.gitignore');
  const patterns = ['state.json.lock', '.state.json-*.tmp', '.studio.mjs-*.tmp', '..gitignore-*.tmp'];
  const rules = patterns.join('\n') + '\n';
  let contents;
  try {
    regularFile(file);
    contents = fs.readFileSync(file, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    fs.writeFileSync(file, rules, { flag: 'wx' });
    return;
  }
  // Append the authoritative block after user negations; repeated upgrades remain idempotent.
  const lines = contents.split(/\r?\n/).map(line => line.trim());
  const safe = patterns.every(pattern => {
    const index = lines.lastIndexOf(pattern);
    return index !== -1 && !lines.slice(index + 1).some(line => line.startsWith('!'));
  });
  if (!safe) {
    const stat = regularFile(file);
    atomicWrite(file, contents + (contents && !contents.endsWith('\n') ? '\n' : '') + rules, stat.mode & 0o777);
  }
}

function backupCli(dir, previous, mode) {
  const hash = digest(previous);
  // Keep the fixed historical backup; when it holds different history, name the new backup by the previous CLI hash.
  for (const backup of [path.join(dir, 'studio.mjs.pre-ledger.bak'), path.join(dir, `studio.mjs.pre-ledger.${hash.slice(0, 8)}.bak`)]) {
    try { fs.writeFileSync(backup, previous, { flag: 'wx', mode }); return backup; }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      regularFile(backup);
      if (digest(fs.readFileSync(backup)) === hash) return backup;
    }
  }
  throw new Error('已有 CLI 备份内容不同且哈希备份名冲突；未覆盖，请人工核对 .studio/studio.mjs.pre-ledger*.bak');
}

function upgrade(target) {
  need(opt['confirm-stopped'], '请先停止所有项目 CLI 和插件写入进程，再指定 --confirm-stopped');
  const root = fs.realpathSync(path.resolve(text(target, 'TARGET')));
  const dir = path.join(root, '.studio');
  const directory = fs.lstatSync(dir);
  need(directory.isDirectory() && !directory.isSymbolicLink(), '项目 .studio 必须是普通目录');
  regularFile(path.join(dir, 'state.json'));
  withLock(dir, () => {
    const file = path.join(dir, 'studio.mjs');
    const stat = regularFile(file);
    const previous = fs.readFileSync(file);
    const current = fs.readFileSync(self);
    if (digest(previous) === digest(current)) { ignoreLedgerArtifacts(dir); emit({ project: root, upgraded: false, reason: '已是当前版本' }); return; }
    need(originalCliHashes.has(digest(previous)), '项目 CLI 不是已知原版，可能包含用户定制；未覆盖，请人工迁移');
    const backup = backupCli(dir, previous, stat.mode & 0o777);
    need(digest(fs.readFileSync(file)) === digest(previous), '项目 CLI 已变化，未覆盖');
    ignoreLedgerArtifacts(dir);
    atomicWrite(file, current, stat.mode & 0o777);
    emit({ project: root, upgraded: true, backup, previousSha256: digest(previous) });
  });
}

function init(target) {
  const root = path.resolve(text(target, 'TARGET'));
  const dir = path.join(root, '.studio');
  need(!fs.existsSync(dir), `${dir} 已存在；请使用 resume`);
  const packageSkill = path.resolve(path.dirname(self), '../skills/project-director/SKILL.md');
  const projectSkill = path.resolve(path.dirname(self), '../.agents/skills/project-director/SKILL.md');
  const skill = fs.readFileSync(fs.existsSync(packageSkill) ? packageSkill : projectSkill, 'utf8');
  const name = opt.name || path.basename(root);
  for (const host of ['.agents', '.claude']) {
    const file = path.join(root, host, 'skills/project-director/SKILL.md');
    need(!fs.existsSync(file), `${file} 已存在，未覆盖`);
  }
  fs.mkdirSync(root, { recursive: true });
  fs.mkdirSync(dir);
  fs.copyFileSync(self, path.join(dir, 'studio.mjs'));
  fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({
    name, createdAt: now(), updatedAt: now(), paused: false,
    tasks: [], inbox: [], handoff: null, config: resetConfig(),
  }, null, 2) + '\n');
  fs.writeFileSync(path.join(dir, 'BRIEF.md'), `# ${name}\n\n## 目标与使用者\n待主 Agent 与用户确认。\n\n## 当前版本范围\n待确认。\n\n## 已确定的决策\n暂无。\n\n## 启动与验收方式\n待确定技术栈后填写。\n`);
  fs.writeFileSync(path.join(dir, '.gitignore'), 'state.json.tmp\nstate.json.lock\n.state.json-*.tmp\n.studio.mjs-*.tmp\n..gitignore-*.tmp\n');
  for (const host of ['.agents', '.claude']) {
    const destination = path.join(root, host, 'skills/project-director');
    fs.mkdirSync(destination, { recursive: true });
    const file = path.join(destination, 'SKILL.md');
    fs.writeFileSync(file, skill);
  }
  const entry = '\n\n<!-- agent-studio -->\n## 项目协作\n用户开始、继续项目或提出修改意见时，读取 `.agents/skills/project-director/SKILL.md`。\n先运行 `node .studio/studio.mjs resume`；你是唯一对话入口与状态记录者，使用宿主原生子 Agent 派工。\n<!-- /agent-studio -->\n';
  for (const name of ['AGENTS.md', 'CLAUDE.md']) {
    const file = path.join(root, name);
    const old = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
    if (!old.includes('<!-- agent-studio -->')) fs.writeFileSync(file, old + entry);
  }
  emit({ project: root, next: '在本地 Agent 中打开此项目，说：开始制作，先和我确定目标。', cli: 'node .studio/studio.mjs resume' });
}

function projectRoot() {
  let dir = process.cwd();
  while (!fs.existsSync(path.join(dir, '.studio/state.json'))) {
    need(!fs.existsSync(path.join(dir, '.studio')), '发现未初始化的 .studio，拒绝跨越边界查找父项目');
    const parent = path.dirname(dir);
    need(parent !== dir, '当前目录不在已初始化的项目中');
    dir = parent;
  }
  return dir;
}

function scopePath(value) {
  const input = text(value, 'scope 路径').replaceAll('\\', '/');
  need(!path.posix.isAbsolute(input) && !/^[A-Za-z]:/.test(input) && !input.split('/').includes('..'), 'scope 必须是项目内的相对文件或目录');
  need(!/[?*\[\]{}]/.test(input), 'scope 请写文件或目录，不使用 glob');
  const normalized = path.posix.normalize(input).replace(/\/$/, '') || '.';
  need(!/^(\.studio|\.agents|\.claude)(\/|$)/i.test(normalized) && !/^(AGENTS|CLAUDE)\.md$/i.test(normalized), '任务不能改写项目管理文件');
  return normalized;
}

function overlap(a, b) {
  a = a.toLowerCase(); b = b.toLowerCase();
  return a === '.' || b === '.' || a === b || a.startsWith(b + '/') || b.startsWith(a + '/');
}
const active = task => ['in_progress', 'review'].includes(task.status);
const conflict = (a, b) => a.scope.some(x => b.scope.some(y => overlap(x, y)));

function validate(tasks) {
  const byId = new Map();
  for (const t of tasks) {
    need(typeof t.id === 'string' && /^[A-Za-z0-9_-]+$/.test(t.id), '任务 id 只能包含字母、数字、下划线和短横线');
    need(!byId.has(t.id), `任务 id 重复：${t.id}`);
    text(t.title, `${t.id}.title`);
    need(Array.isArray(t.acceptance) && t.acceptance.length > 0, `${t.id} 必须有验收条目`);
    t.acceptance.forEach(item => text(item, `${t.id}.acceptance`));
    need(Array.isArray(t.scope) && t.scope.length > 0, `${t.id} 必须声明文件范围 scope`);
    t.scope.forEach(scopePath);
    need(Array.isArray(t.dependsOn), `${t.id}.dependsOn 必须是数组`);
    byId.set(t.id, t);
  }
  const visiting = new Set(), visited = new Set();
  function visit(id) {
    need(byId.has(id), `依赖不存在：${id}`);
    need(!visiting.has(id), `循环依赖：${id}`);
    if (visited.has(id)) return;
    visiting.add(id);
    byId.get(id).dependsOn.forEach(visit);
    visiting.delete(id); visited.add(id);
  }
  tasks.forEach(t => visit(t.id));
}

// Resolve a requested route and the host capability boundary; the CLI never observes a running model.
function buildExecution(config, task, opt, route) {
  if (route !== 'coding' && route !== 'debug' && route !== 'visual') throw new Error('route 必须为 coding、debug 或 visual');
  const role = opt.role || 'engineer';
  const risks = [];
  const picks = {};
  if (role === 'reviewer') {
    const rv = config.roles.reviewer;
    picks.mode = rv.mode; picks.provider = rv.provider; picks.model = rv.model; picks.reasoningEffort = rv.reasoningEffort; picks.skills = [...rv.skills];
  } else {
    const eng = config.roles.engineer, routeCfg = eng.routes[route];
    picks.mode = opt.mode || eng.mode || 'subagent';
    picks.provider = routeCfg.provider; picks.model = routeCfg.model;
    picks.reasoningEffort = routeCfg.reasoningEffort; picks.skills = [...routeCfg.skills];
  }
  if (opt.model) {
    // Keep other resolved fields; only override provider/model when they differ, note that config route was replaced.
    const [p, m] = opt.model.split('/');
    if (p !== picks.provider || m !== picks.model) risks.push('显式 --model 覆盖配置路由');
    picks.provider = p; picks.model = m;
  }
  if (opt.mode) picks.mode = opt.mode;
  const teammate = picks.mode === 'teammate';
  const requested = { ...picks, skills: [...picks.skills] };
  const effective = teammate
    ? { tool: 'spawn_teammate', routing: 'inherit-parent', provider: null, model: null, reasoningEffort: null }
    : { tool: 'subagent', routing: 'explicit-request', provider: picks.provider, model: picks.model, reasoningEffort: picks.reasoningEffort };
  if (teammate) risks.push('Team 不支持成员级 model/reasoningEffort 参数；请求路由未应用，实际继承父会话。spawn 等 provider 是传输实现，不是 LLM provider。');
  const risk = opt.risk || task.risk || 'low';
  return {
    ...picks, requested, effective,
    // Legacy provider/model/reasoningEffort aliases above describe requested config, never observed execution.
    actual: { status: 'unverified', provider: null, model: null, reasoningEffort: null },
    role, risk, route,
    reviewPolicy: { fastTrackLowRisk: config.fastTrackLowRisk, requiresIndependentReview: risk === 'high' || !config.fastTrackLowRisk },
    warnings: risks,
  };
}

function run() {
  if (command === 'help') { console.log(help); return; }
  if (command === 'init') { init(arg); return; }
  if (command === 'upgrade') { upgrade(arg); return; }
  const root = projectRoot();
  const dir = path.join(root, '.studio');
  const readOnly = (command === 'config' && !arg) || ['status', 'brief', 'show', 'doctor'].includes(command) || (command === 'resume' && !opt.continue);
  if (!readOnly) return withLock(dir, () => { requireProjectCli(dir); runProject(root); });
  return runProject(root);
}

function runProject(root) {
  const stateFile = path.join(root, '.studio/state.json');
  if (!(command === 'config' && !arg) && !['status', 'brief', 'show', 'doctor'].includes(command) && !(command === 'resume' && !opt.continue)) regularFile(stateFile);
  const state = json(stateFile);
  const briefFile = path.join(root, '.studio/BRIEF.md');
  const get = id => {
    const task = state.tasks.find(t => t.id === id);
    need(task, `任务不存在：${id}`);
    return task;
  };
  const save = () => {
    state.updatedAt = now();
    atomicWrite(stateFile, JSON.stringify(state, null, 2) + '\n', fs.statSync(stateFile).mode & 0o777);
  };
  const log = (task, action, detail) => task.history.push({ at: now(), action, ...detail });
  const reset = task => Object.assign(task, { status: 'todo', owner: null, summary: '', evidence: [], review: null });
  const ready = () => state.tasks.filter(t => t.status === 'todo' && t.dependsOn.every(id => get(id).status === 'done'));
  const short = t => ({ id: t.id, title: t.title, status: t.status, owner: t.owner });
  const overview = () => ({
    project: state.name, root, paused: state.paused,
    counts: Object.fromEntries(['todo', 'in_progress', 'review', 'done'].map(s => [s, state.tasks.filter(t => t.status === s).length])),
    active: state.tasks.filter(active).map(short),
    ready: ready().slice(0, 10).map(short),
    recentDone: state.tasks.filter(t => t.status === 'done').slice(-5).map(short),
    feedback: state.inbox.filter(item => !item.resolved),
    handoff: state.handoff,
  });

  switch (command) {
    case 'config':
      if (arg) { state.config = normalizeConfig(mergeConfig(normalizeConfig(state.config), json(path.resolve(arg)))); save(); }
      emit(normalizeConfig(state.config)); break;
    case 'reset-config': state.config = resetConfig(); save(); emit(state.config); break;
    case 'status': emit(overview()); break;
    case 'resume':
      if (opt.continue) { state.paused = false; save(); }
      emit({ ...overview(), brief: fs.readFileSync(briefFile, 'utf8'),
        next: state.paused ? '已暂停。确认继续后运行 resume --continue。' : state.tasks.some(active)
          ? 'review 任务已提交成果：用 show 查看并继续独立验收，不要重新派工。in_progress 任务核实 worker；确认已中断才 release。' : '查看反馈与目标，按需补充计划，然后 dispatch。',
      });
      break;
    case 'brief': emit({ brief: fs.readFileSync(briefFile, 'utf8') }); break;
    case 'show': emit(get(arg)); break;
    case 'plan': {
      const plan = json(path.resolve(text(arg, '计划文件')));
      need(Array.isArray(plan.tasks) && plan.tasks.length, '计划需包含非空 tasks 数组');
      const tasks = plan.tasks.map(t => ({
        id: t.id, title: t.title, description: t.description || '',
        dependsOn: t.dependsOn ?? [], scope: t.scope, acceptance: t.acceptance,
        status: 'todo', owner: null, summary: '', evidence: [], review: null, history: [],
      }));
      validate([...state.tasks, ...tasks]);
      tasks.forEach(t => { t.scope = t.scope.map(scopePath); log(t, 'planned', {}); });
      state.tasks.push(...tasks); save(); emit({ added: tasks.map(t => t.id) });
      break;
    }
    case 'dispatch': {
      need(!state.paused, '项目已暂停；先 resume --continue');
      const config = normalizeConfig(state.config);
      const rawLimit = opt.limit === undefined ? config.concurrency : Number(opt.limit);
      need(Number.isInteger(rawLimit) && rawLimit > 0, 'limit 必须是正整数');
      // Explicit --limit may narrow but never widen the config concurrency cap.
      const limit = Math.min(rawLimit, config.concurrency);
      if (opt.task !== undefined) get(text(opt.task, 'task'));
      if (opt.worker !== undefined) text(opt.worker, 'worker');
      if (opt.mode !== undefined) need(['subagent', 'teammate'].includes(opt.mode), 'mode 无效');
      if (opt.role !== undefined) need(['engineer', 'reviewer'].includes(opt.role), 'role 无效');
      if (opt.model !== undefined) need(/^[^\s/]+\/[^\s/]+$/.test(opt.model), 'model 必须为 PROVIDER/MODEL');
      if (opt.risk !== undefined) need(['low', 'high'].includes(opt.risk), 'risk 无效');
      if (opt.route !== undefined) need(['coding', 'debug', 'visual'].includes(opt.route), 'route 必须为 coding、debug 或 visual');
      const brief = fs.readFileSync(briefFile, 'utf8');
      const running = state.tasks.filter(active);
      const selected = [];
      for (const task of ready().filter(t => !opt.task || t.id === opt.task)) {
        if (running.length >= limit) break;
        if (running.some(other => conflict(task, other))) continue;
        // Route: explicit --route, else the task's last dispatched route, else the coding default.
        const route = opt.route || task.route || 'coding';
        const execution = buildExecution(config, task, opt, route);
        task.status = 'in_progress'; task.owner = opt.worker || `worker-${task.id}`;
        for (const [key, value] of Object.entries({ worker: opt.worker, mode: opt.mode, role: opt.role, modelRoute: opt.model, risk: opt.risk })) {
          if (value !== undefined) task[key] = value;
        }
        // Preserve the legacy route display as a requested-config alias, not an observed model.
        task.execution = execution;
        task.modelRoute = `${execution.provider}/${execution.model}`;
        task.modelRouteKind = 'requested';
        log(task, 'dispatched', { owner: task.owner });
        running.push(task); selected.push(task);
      }
      if (selected.length) save();
      emit({ packets: selected.map(task => {
        const ex = task.execution;
        const hostExecution = ex.mode === 'teammate'
          ? `Team 请求路由仅作记录：requested.provider=${ex.requested.provider}、requested.model=${ex.requested.model}、requested.reasoningEffort=${ex.requested.reasoningEffort}；没有应用到成员级模型选择。调用 spawn_teammate 仅使用 name/description/prompt/context；没有 provider/model/reasoningEffort 参数。effective 为 inherit-parent，实际沿父会话继承，actual 尚未证实；spawn 等传输 provider 不能当作 LLM provider。`
          : `调用宿主原生 subagent：provider=${ex.requested.provider}、model=${ex.requested.model}、reasoningEffort=${ex.requested.reasoningEffort}。这些是待宿主应用的请求，CLI 未启动模型，actual 尚未证实。`;
        return {
          task, owner: task.owner, config, execution: ex,
          prompt: `你负责项目 ${root} 的任务 ${task.id}：${task.title}。\n先读取 .studio/BRIEF.md 和宿主项目规则。\nBRIEF 锚点（目标、范围、全局契约）：\n${brief}\n主控零开发：所有代码探查、实现、排障与测试均由子 Agent 完成，主控只审结构化回执。\n【宿主执行】${hostExecution}\nmode=${ex.mode}、role=${ex.role}、route=${ex.route}、risk=${ex.risk}。execution 顶层 provider/model/reasoningEffort 和 task.modelRoute 仅为 requested 兼容别名，不是实际执行证据；以宿主返回与独立回执确认实际 LLM，未知就保持未证实。技能${ex.skills.length ? ` ${ex.skills.join('、')} ` : '（无）'}不得作为宿主参数杜撰，必须在子代理任务开场先 call skill 逐个加载。\n【验收策略】fastTrackLowRisk=${ex.reviewPolicy.fastTrackLowRisk}；requiresIndependentReview=${ex.reviewPolicy.requiresIndependentReview}。实现者不得自验；需要独立验收时必须 dispatch 给 reviewer 配置的独立 worker（请求 mode=${config.roles.reviewer.mode}、provider=${config.roles.reviewer.provider}/model=${config.roles.reviewer.model}；同样遵守上述 Team 继承与 actual 未证实边界）。\n任务说明：${task.description}\n最近交接：${JSON.stringify(task.history.slice(-3))}\n允许修改的文件/目录：${task.scope.join(', ')}。不要修改 .studio、.agents、.claude、AGENTS.md、CLAUDE.md；不要替主Agent提交或回退Git。文件范围是协作约定，不是文件系统沙箱。\n验收：\n${task.acceptance.map(x => '- ' + x).join('\n')}\n只处理此任务；发现跨范围改动需要时向主Agent报告。完成后只返回不超过 15 行的结构化回执：【改动文件清单 | 核心变更摘要(≤5行) | 实际执行的验证命令与退出码/通过数 | 契约变更说明 | 阻塞/问题】，不自行标记任务通过。`,
        };
      }), next: selected.length ? '主 Agent 按 execution.effective.tool 调用原生工具：subagent 使用 requested 路由；Team 只用受支持参数并继承父会话，不传 provider/model/reasoningEffort。技能先 call skill 加载；CLI 未启动任何模型，actual 保持未证实直到宿主返回真实证据。' : '当前没有可派发任务；查看在执行/待验收任务、依赖及文件范围。' });
      break;
    }
    case 'submit': {
      const task = get(arg);
      need(task.status === 'in_progress', '只有执行中的任务可以提交验收');
      const summary = text(opt.summary, 'summary');
      const evidence = (opt.evidence || []).map(x => text(x, 'evidence'));
      need(evidence.length, '提交需要实际测试或产物证据');
      Object.assign(task, { status: 'review', summary, evidence });
      log(task, 'submitted', { summary, evidence }); save(); emit(task);
      break;
    }
    case 'review': {
      const task = get(arg);
      need(task.status === 'review', '只有待验收任务可以登记评审');
      need(['pass', 'fail'].includes(opt.result), 'result 必须为 pass 或 fail');
      const reviewer = text(opt.reviewer, 'reviewer');
      need(reviewer !== task.owner, '验收者不能是任务执行者');
      // fastTrackLowRisk drives real routing: only low risk with the switch on may take director-audit;
      // legacy tasks without a recorded execution are judged by the current config.
      const cfg = normalizeConfig(state.config);
      const policy = task.execution?.reviewPolicy || { fastTrackLowRisk: cfg.fastTrackLowRisk, requiresIndependentReview: (task.risk || 'low') === 'high' || !cfg.fastTrackLowRisk };
      need(!(policy.requiresIndependentReview && reviewer === 'director-audit'), '该任务需独立验收，不能用 director-audit 绕过');
      const evidence = (opt.evidence || []).map(x => text(x, 'evidence'));
      need(evidence.length, '评审需要实际验收证据');
      const review = { result: opt.result, reviewer, evidence, policy };
      log(task, 'reviewed', review);
      task.status = opt.result === 'pass' ? 'done' : 'todo';
      task.review = review;
      if (opt.result === 'fail') task.owner = null;
      save(); emit(task); break;
    }
    case 'pause':
      state.handoff = { at: now(), note: text(opt.note, 'note') };
      state.paused = true; save();
      emit({ ...overview(), next: '暂停派工已记录。实际 worker 需由主 Agent 停止或等待完成。' }); break;
    case 'release': {
      const task = get(arg);
      need(active(task), '只能释放执行中或待验收任务');
      const note = text(opt.note, 'note');
      log(task, 'released', { note });
      task.status = 'todo'; task.owner = null;
      save(); emit(task); break;
    }
    case 'revise':
    case 'reopen': {
      const task = get(arg);
      const reason = text(opt.reason, 'reason');
      let revised;
      if (command === 'revise') {
        const update = json(path.resolve(text(positionals[2], '修订文件')));
        revised = { ...task, title: update.title, description: update.description || '',
          dependsOn: update.dependsOn ?? [], scope: update.scope, acceptance: update.acceptance };
        validate(state.tasks.map(t => t.id === arg ? revised : t));
        revised.scope = revised.scope.map(scopePath);
      }
      const ids = new Set([arg]);
      let changed = true;
      while (changed) {
        changed = false;
        for (const task of state.tasks) {
          if (!ids.has(task.id) && task.dependsOn.some(id => ids.has(id))) { ids.add(task.id); changed = true; }
        }
      }
      const tasks = state.tasks.filter(t => ids.has(t.id));
      need(!tasks.some(active), '相关任务仍在执行或验收；确认 worker 停止后先 release');
      if (revised) {
        const { title, description, dependsOn, scope, acceptance } = task;
        log(task, 'revised', { reason, previous: { title, description, dependsOn, scope, acceptance } });
        Object.assign(task, revised);
      }
      tasks.forEach(t => { log(t, 'reopened', { reason }); reset(t); });
      save(); emit({ reopened: [...ids] }); break;
    }
    case 'feedback': {
      const id = state.inbox.reduce((max, item) => Number.isSafeInteger(item.id) && item.id > max ? item.id : max, 0) + 1;
      need(Number.isSafeInteger(id), '反馈 ID 已达到安全整数上限');
      const item = { id, text: text(arg, '反馈'), at: now(), resolved: false };
      state.inbox.push(item); save(); emit(item); break;
    }
    case 'feedback-done': {
      const item = state.inbox.find(x => x.id === Number(arg));
      need(item, `反馈不存在：${arg}`);
      item.note = text(opt.note, 'note'); item.resolved = true; item.resolvedAt = now();
      save(); emit(item); break;
    }
    case 'doctor': {
      validate(state.tasks);
      const running = state.tasks.filter(active);
      const conflicts = running.flatMap((a, i) => running.slice(i + 1).filter(b => conflict(a, b)).map(b => [a.id, b.id]));
      need(!conflicts.length, `执行范围冲突：${JSON.stringify(conflicts)}`);
      emit({ ok: true, tasks: state.tasks.length, active: running.length }); break;
    }
    default: throw new Error(`未知命令：${command}；使用 help 查看用法`);
  }
}

if (isMain) try { run(); } catch (error) {
  console.error(JSON.stringify({ error: error.message }));
  process.exitCode = 1;
}
