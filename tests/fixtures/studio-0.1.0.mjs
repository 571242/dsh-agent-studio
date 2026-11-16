#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const self = fileURLToPath(import.meta.url);
const { positionals, values: opt } = parseArgs({
  allowPositionals: true,
  options: {
    name: { type: 'string' }, limit: { type: 'string', default: '2' },
    summary: { type: 'string' }, evidence: { type: 'string', multiple: true },
    result: { type: 'string' }, reviewer: { type: 'string' },
    note: { type: 'string' }, reason: { type: 'string' },
    continue: { type: 'boolean', default: false },
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
const help = `Agent Studio — 本地项目协作，零依赖 / 不注册 MCP 工具

首次：node bin/studio.mjs init TARGET --name "项目名"
以后：node .studio/studio.mjs COMMAND（在项目根目录执行）

status / resume                       查看进度 / 读取交接包
resume --continue                     解除暂停，准备继续派工
brief                                 查看项目目标
plan FILE.json                        追加有依赖和验收条目的任务
revise ID FILE.json --reason TEXT      修订任务定义，下游重新验收
show ID                               查看任务详情
dispatch --limit 2                    认领就绪任务，输出子 Agent 任务包
submit ID --summary TEXT --evidence TEXT
review ID --result pass|fail --reviewer NAME --evidence TEXT
pause --note TEXT                      保存交接说明并暂停派工
release ID --note TEXT                 确认 worker 停止后释放任务
reopen ID --reason TEXT                任务及下游重新进入待办
feedback TEXT                         收集修改意见
feedback-done N --note TEXT            记录意见的处理结果
doctor                                检查任务依赖和文件范围

CLI 只管理状态；主 Agent 调用宿主原生子 Agent 执行与验收。
`;

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
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(self, path.join(dir, 'studio.mjs'));
  fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({
    name, createdAt: now(), updatedAt: now(), paused: false,
    tasks: [], inbox: [], handoff: null,
  }, null, 2) + '\n');
  fs.writeFileSync(path.join(dir, 'BRIEF.md'), `# ${name}\n\n## 目标与使用者\n待主 Agent 与用户确认。\n\n## 当前版本范围\n待确认。\n\n## 已确定的决策\n暂无。\n\n## 启动与验收方式\n待确定技术栈后填写。\n`);
  fs.writeFileSync(path.join(dir, '.gitignore'), 'state.json.tmp\n');
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

function run() {
  if (command === 'help') { console.log(help); return; }
  if (command === 'init') { init(arg); return; }
  const root = projectRoot();
  const stateFile = path.join(root, '.studio/state.json');
  const state = json(stateFile);
  const briefFile = path.join(root, '.studio/BRIEF.md');
  const get = id => {
    const task = state.tasks.find(t => t.id === id);
    need(task, `任务不存在：${id}`);
    return task;
  };
  const save = () => {
    state.updatedAt = now();
    fs.writeFileSync(stateFile + '.tmp', JSON.stringify(state, null, 2) + '\n');
    fs.renameSync(stateFile + '.tmp', stateFile);
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
      const limit = Number(opt.limit);
      need(Number.isInteger(limit) && limit > 0, 'limit 必须是正整数');
      const running = state.tasks.filter(active);
      const selected = [];
      for (const task of ready()) {
        if (running.length >= limit) break;
        if (running.some(other => conflict(task, other))) continue;
        task.status = 'in_progress'; task.owner = `worker-${task.id}`;
        log(task, 'dispatched', { owner: task.owner });
        running.push(task); selected.push(task);
      }
      if (selected.length) save();
      emit({ packets: selected.map(task => ({
        task, owner: task.owner,
        prompt: `你负责项目 ${root} 的任务 ${task.id}：${task.title}。\n先读取 .studio/BRIEF.md 和宿主项目规则。\n任务说明：${task.description}\n最近交接：${JSON.stringify(task.history.slice(-3))}\n允许修改的文件/目录：${task.scope.join(', ')}。不要修改 .studio、.agents、.claude、AGENTS.md、CLAUDE.md；不要替主Agent提交或回退Git。文件范围是协作约定，不是文件系统沙箱。\n验收：\n${task.acceptance.map(x => '- ' + x).join('\n')}\n只处理此任务；发现跨范围改动需要时向主Agent报告。完成后返回改动文件、实际运行的测试与结果、未解决问题，不自行标记任务通过。`,
      })), next: selected.length ? '主 Agent 现在必须调用宿主原生子 Agent 执行这些任务包；CLI 未启动任何模型。' : '当前没有可派发任务；查看在执行/待验收任务、依赖及文件范围。' });
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
      const evidence = (opt.evidence || []).map(x => text(x, 'evidence'));
      need(evidence.length, '评审需要实际验收证据');
      const review = { result: opt.result, reviewer, evidence };
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
      const item = { id: state.inbox.length + 1, text: text(arg, '反馈'), at: now(), resolved: false };
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

try { run(); } catch (error) {
  console.error(JSON.stringify({ error: error.message }));
  process.exitCode = 1;
}
