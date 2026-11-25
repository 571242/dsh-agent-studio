import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStudioApi } from '../core.js';

function load({ react, environment = {}, shellOptions = {} } = {}) {
  const entries = new Map();
  const effects = [];
  let descriptor;
  let draftRequest;
  const shell = {
    setDraft() { throw new Error('must not replace draft'); },
    requestDraftInitialization(options) { draftRequest = options; return 'applied'; },
    persistCurrentDraft() {},
    ...shellOptions,
  };
  const React = react || {
    Fragment: 'fragment',
    createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    useState: initial => [typeof initial === 'function' ? initial() : initial, () => {}],
    useEffect() {},
    useRef: value => ({ current: value }),
    useSyncExternalStore: (_subscribe, get) => get(),
  };
  const window = { ...environment.window, __ModuleLoader__: { load(value) { descriptor = value; } } };
  vm.runInNewContext(fs.readFileSync(new URL('../client.js', import.meta.url), 'utf8'), { ...environment, window, console, globalThis: environment.globalThis || {} });
  const plugin = descriptor.factory(name => { assert.equal(name, 'react'); return React; });
  const ctx = {
    effect(fn) { effects.push(fn); },
    uiWorkspace: { mainReference: { sessionId: 's1' } },
    sessions: { list: { subscribe: () => () => {}, getSnapshot: () => ({ current: 's1', byId: {} }) }, scope: () => ({ get: () => ({ input: { for: () => shell } }) }) },
    slots: {
      inject(_name, fn) { fn(); },
      register(options, component) { entries.set(options.id, { options, component }); return () => {}; },
    },
  };
  plugin.apply(ctx);
  return { descriptor, plugin, entries, React, shell, draft: () => draftRequest };
}

function workbench({ api, shellOptions, confirmHandler } = {}) {
  const hooks = [];
  const requests = [];
  const copied = [];
  const confirms = [];
  let confirmResponse = true;
  let pickResponse = '';
  const timers = new Map();
  const events = new Map();
  let cursor = 0;
  let pendingEffects = [];
  let needsRender = false;
  let component;
  let tree;
  let nextTimer = 0;
  const React = {
    Fragment: 'fragment',
    createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    useState(initial) {
      const index = cursor++;
      if (!hooks[index]) hooks[index] = { value: typeof initial === 'function' ? initial() : initial };
      const slot = hooks[index];
      return [slot.value, value => {
        const next = typeof value === 'function' ? value(slot.value) : value;
        if (!Object.is(next, slot.value)) { slot.value = next; needsRender = true; }
      }];
    },
    useRef(value) {
      const index = cursor++;
      return hooks[index] ||= { current: value };
    },
    useEffect(effect, deps) {
      const index = cursor++;
      const prev = hooks[index];
      if (!prev || !deps || deps.some((dep, i) => !Object.is(dep, prev.deps[i]))) {
        pendingEffects.push(() => {
          prev?.cleanup?.();
          hooks[index] = { deps, cleanup: effect() };
        });
      }
    },
    useSyncExternalStore(_subscribe, get) { return get(); },
  };
  const environment = {
    document: { hidden: false },
    navigator: { clipboard: { async writeText(text) { copied.push(text); } } },
    globalThis: { __DSH_DIRECTORY_PICKER__: { async pick() { return pickResponse; } } },
    window: {
      confirm(message) {
        confirms.push(message);
        return typeof confirmHandler === 'function' ? confirmHandler(message) : confirmResponse;
      },
      addEventListener(type, listener) { events.set(type, listener); },
      removeEventListener(type, listener) { if (events.get(type) === listener) events.delete(type); },
    },
    setInterval(fn) { const id = ++nextTimer; timers.set(id, fn); return id; },
    clearInterval(id) { timers.delete(id); },
    fetch(_url, options) {
      return new Promise(resolve => requests.push({
        body: JSON.parse(options.body),
        respond(project) { resolve({ ok: true, json: async () => ({ ok: true, project }) }); },
        reject(error) { resolve({ ok: false, json: async () => ({ ok: false, error }) }); },
        async execute() {
          try {
            const project = await api.action(this.body);
            resolve({ ok: true, json: async () => ({ ok: true, project }) });
          } catch (error) {
            resolve({ ok: false, json: async () => ({ ok: false, error: error.message, code: error.code }) });
          }
        },
      }));
    },
  };
  const { entries } = load({ react: React, environment, shellOptions });
  entries.get('agent-studio-header').component({ header: true }).props.onClick();
  const Overlay = entries.get('agent-studio-footer').component({}).children[1].type;
  component = Overlay().children[0].type;
  hooks.length = 0;
  const props = { sessionId: 's1', close() {}, setDirty() {} };
  function flush() {
    let turns = 0;
    do {
      assert.ok(++turns < 30, 'render loop');
      needsRender = false;
      cursor = 0;
      pendingEffects = [];
      tree = component(props);
      for (const effect of pendingEffects) effect();
    } while (needsRender);
  }
  async function settle() {
    for (let i = 0; i < 8; i++) await Promise.resolve();
    flush();
  }
  function find(predicate) {
    function visit(node) {
      if (Array.isArray(node)) {
        for (const child of node) { const match = visit(child); if (match) return match; }
      } else if (node && typeof node === 'object') {
        if (predicate(node)) return node;
        return visit(node.children);
      }
      return null;
    }
    const result = visit(tree);
    assert.ok(result, 'element not found');
    return result;
  }
  function input(id) { return find(node => node.props?.id === id); }
  function button(label) { return find(node => node.children?.includes(label) && typeof node.props?.onClick === 'function'); }
  function click(label) {
    const element = button(label);
    assert.notEqual(element.props.disabled, true, `${label} is disabled`);
    const result = element.props.onClick();
    flush();
    return result;
  }
  function change(id, value) {
    const element = input(id);
    assert.notEqual(element.props.disabled, true, `${id} is disabled`);
    element.props.onChange({ target: { value } }); flush();
  }
  function refresh() { assert.ok(events.has('focus')); events.get('focus')(); }
  function tick() { assert.equal(timers.size, 1); [...timers.values()][0](); }
  flush();
  return { requests, copied, confirms, setConfirm: v => { confirmResponse = v; }, setPick: v => { pickResponse = v; }, input, button, click, change, refresh, tick, flush, settle, find };
}

function project(root, brief, revision, done = 0) {
  return {
    initialized: true, cliCompatibility: 'current', root, name: root, brief, revision, paused: false,
    counts: { todo: 1 - done, in_progress: 0, review: 0, done },
    tasks: [{ id: 'task', title: '任务', status: done ? 'done' : 'todo' }], feedback: [], handoff: null,
  };
}

test('DSH manifest exports both halves and keeps original CLI', () => {
  const manifest = JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
  assert.equal(manifest.name, 'dsh-agent-studio');
  assert.equal(manifest.exports['./client'], './plugin/client.js');
  assert.equal(manifest.dsh.client.platform, 'web');
  assert.ok(fs.existsSync(new URL('../../bin/studio.mjs', import.meta.url)));
  for (const file of [manifest.main, manifest.exports['./client'], manifest.dsh.bundle.patch]) assert.ok(fs.existsSync(new URL('../../' + file, import.meta.url)), file);
});

test('client registers native header and a single sidebar-owned modal without another app', () => {
  const { descriptor, plugin, entries } = load();
  assert.equal(descriptor.id, 'dsh-agent-studio');
  assert.deepEqual(Array.from(plugin.inject), ['slots', 'sessions', 'uiWorkspace']);
  assert.deepEqual(Array.from(entries.keys()), ['agent-studio-header', 'agent-studio-footer']);
  assert.equal(entries.get('agent-studio-header').options.name, 'conversation.session.header.actions');
  const footer = entries.get('agent-studio-footer').component({ wide: true });
  const entry = footer.children[0].type(footer.children[0].props);
  assert.equal(entry.props['aria-label'], '项目工作台');
  assert.equal(entry.props.className, 'as-entry as-wide');
  const overlay = footer.children[1].type();
  assert.equal(overlay.type, 'dialog');
  assert.equal(overlay.props['aria-labelledby'], 'agent-studio-title');
});

test('closed workbench does not fetch project data; entry toggles the overlay', () => {
  const { entries } = load();
  const Overlay = entries.get('agent-studio-footer').component({}).children[1].type;
  assert.equal(Overlay().children[0], null);
  entries.get('agent-studio-header').component({ header: true }).props.onClick();
  const content = Overlay().children[0];
  assert.equal(typeof content.type, 'function');
  assert.equal(content.props.sessionId, 's1');
});

test('in-flight refresh preserves the edited brief and its original revision, so a conflict is detected', async () => {
  const ui = workbench();
  ui.requests.shift().respond(project('A', 'original', 'rev-1'));
  await ui.settle();
  ui.click('项目简报');
  ui.refresh();
  const refresh = ui.requests.shift();
  assert.equal(refresh.body.root, 'A');
  ui.change('as-brief', 'my changes');
  refresh.respond(project('A', 'external changes', 'rev-2', 1));
  await ui.settle();
  assert.equal(ui.input('as-brief').props.value, 'my changes');
  assert.equal(ui.button('保存简报').props.disabled, false);
  assert.ok(ui.find(node => node.type === 'span' && node.children.includes('1 / 1 项已验收')));
  ui.click('保存简报');
  const save = ui.requests.shift();
  assert.equal(save.body.brief, 'my changes');
  assert.equal(save.body.revision, 'rev-1');
  save.reject('目标已被修改，请重新加载后再保存');
  await ui.settle();
  assert.equal(ui.input('as-brief').props.value, 'my changes');
  assert.ok(ui.find(node => node.props?.role === 'alert' && node.children.includes('目标已被修改，请重新加载后再保存')));
  assert.equal(ui.button('保存简报').props.disabled, false);
});

test('a reverted in-flight edit keeps its old revision until the next clean refresh', async () => {
  const ui = workbench();
  ui.requests.shift().respond(project('A', 'original', 'rev-1'));
  await ui.settle();
  ui.click('项目简报');
  ui.refresh();
  const stale = ui.requests.shift();
  ui.change('as-brief', 'temporary');
  ui.change('as-brief', 'original');
  stale.respond(project('A', 'external changes', 'rev-2'));
  await ui.settle();
  assert.equal(ui.input('as-brief').props.value, 'original');
  assert.equal(ui.button('保存简报').props.disabled, true);
  ui.change('as-brief', 'new draft');
  ui.click('保存简报');
  const save = ui.requests.shift();
  assert.equal(save.body.revision, 'rev-1');
  save.reject('目标已被修改，请重新加载后再保存');
  await ui.settle();
  assert.equal(ui.input('as-brief').props.value, 'new draft');
  ui.change('as-brief', 'original');
  ui.tick();
  ui.requests.shift().respond(project('A', 'external changes', 'rev-2'));
  await ui.settle();
  assert.equal(ui.input('as-brief').props.value, 'external changes');
  ui.change('as-brief', 'after reload');
  ui.click('保存简报');
  assert.equal(ui.requests.shift().body.revision, 'rev-2');
});

test('manual refresh, brief save and feedback preserve an unsubmitted project path', async () => {
  const ui = workbench();
  ui.requests.shift().respond(project('A', 'original', 'rev-1'));
  await ui.settle();
  assert.equal(ui.input('as-root').props.value, 'A');
  ui.change('as-root', 'B');
  ui.click('刷新进度');
  const refresh = ui.requests.shift();
  assert.equal(refresh.body.root, 'A');
  refresh.respond(project('A', 'external', 'rev-2', 1));
  await ui.settle();
  assert.equal(ui.input('as-root').props.value, 'B');
  assert.ok(ui.find(node => node.type === 'span' && node.children.includes('1 / 1 项已验收')));
  ui.click('项目简报');
  ui.change('as-brief', 'saved');
  ui.click('保存简报');
  const save = ui.requests.shift();
  assert.equal(save.body.root, 'A');
  assert.equal(save.body.revision, 'rev-2');
  save.respond(project('A', 'saved', 'rev-3', 1));
  await ui.settle();
  assert.equal(ui.input('as-root').props.value, 'B');
  assert.equal(ui.button('保存简报').props.disabled, true);
  ui.click('反馈与交接');
  ui.change('as-feedback', '反馈');
  ui.click('记录反馈');
  const feedback = ui.requests.shift();
  assert.equal(feedback.body.root, 'A');
  assert.equal(feedback.body.text, '反馈');
  feedback.respond(project('A', 'saved', 'rev-3', 1));
  await ui.settle();
  assert.equal(ui.input('as-root').props.value, 'B');
  assert.equal(ui.input('as-feedback').props.value, '');
  ui.click('打开');
  const open = ui.requests.shift();
  assert.equal(open.body.root, 'B');
  open.respond(project('B-normalized', 'brief B', 'rev-b'));
  await ui.settle();
  assert.equal(ui.input('as-root').props.value, 'B-normalized');
});

test('a manual refresh keeps inputs disabled until its response', async () => {
  const ui = workbench();
  ui.requests.shift().respond(project('A', 'original', 'rev-1'));
  await ui.settle();
  ui.click('项目简报');
  ui.click('刷新进度');
  assert.equal(ui.input('as-root').props.disabled, true);
  assert.equal(ui.input('as-brief').props.disabled, true);
  ui.requests.shift().respond(project('A', 'external changes', 'rev-2'));
  await ui.settle();
  assert.equal(ui.input('as-root').props.disabled, false);
  assert.equal(ui.input('as-brief').props.disabled, false);
  assert.equal(ui.input('as-brief').props.value, 'external changes');
});

test('overlapping automatic refreshes accept only the newest response after the effect restarts', async () => {
  const ui = workbench();
  ui.requests.shift().respond(project('A', 'original', 'rev-1'));
  await ui.settle();
  ui.click('项目简报');
  ui.refresh();
  const older = ui.requests.shift();
  ui.change('as-brief', 'temporary');
  ui.change('as-brief', 'original');
  ui.refresh();
  const newer = ui.requests.shift();
  assert.ok(newer, 'effect restart starts a new refresh');
  newer.respond(project('A', 'new external', 'rev-new', 1));
  await ui.settle();
  older.respond(project('A', 'old external', 'rev-old', 0));
  await ui.settle();
  assert.equal(ui.input('as-brief').props.value, 'new external');
  assert.ok(ui.find(node => node.type === 'span' && node.children.includes('1 / 1 项已验收')));
  ui.change('as-brief', 'new draft');
  ui.click('保存简报');
  const save = ui.requests.shift();
  assert.equal(save.body.revision, 'rev-new');
});

test('automatic refresh preserves a path typed before and during requests while updating the saved project', async () => {
  const ui = workbench();
  ui.requests.shift().respond(project('A', 'brief A', 'rev-a'));
  await ui.settle();
  ui.change('as-root', 'B-before');
  ui.refresh();
  const first = ui.requests.shift();
  assert.equal(first.body.root, 'A');
  ui.change('as-root', 'B-after');
  first.respond(project('A', 'brief A', 'rev-a', 1));
  await ui.settle();
  assert.equal(ui.input('as-root').props.value, 'B-after');
  assert.ok(ui.find(node => node.type === 'span' && node.children.includes('1 / 1 项已验收')));
  ui.tick();
  const second = ui.requests.shift();
  assert.equal(second.body.root, 'A');
  second.respond(project('A', 'brief A', 'rev-a', 0));
  await ui.settle();
  assert.equal(ui.input('as-root').props.value, 'B-after');
  assert.ok(ui.find(node => node.type === 'span' && node.children.includes('0 / 1 项已验收')));
  ui.click('打开');
  const open = ui.requests.shift();
  assert.equal(open.body.root, 'B-after');
  open.respond(project('B', 'brief B', 'rev-b'));
  await ui.settle();
  assert.equal(ui.input('as-root').props.value, 'B');
  ui.click('项目简报');
  assert.equal(ui.input('as-brief').props.value, 'brief B');
});

test('clean refresh, manual save, and an explicit project switch keep their normal behavior', async () => {
  const ui = workbench();
  ui.requests.shift().respond(project('A', 'original', 'rev-1'));
  await ui.settle();
  ui.click('项目简报');
  ui.tick();
  ui.requests.shift().respond(project('A', 'updated externally', 'rev-2'));
  await ui.settle();
  assert.equal(ui.input('as-brief').props.value, 'updated externally');
  ui.change('as-brief', 'saved by user');
  ui.click('保存简报');
  const save = ui.requests.shift();
  assert.equal(save.body.revision, 'rev-2');
  save.respond(project('A', 'saved by user', 'rev-3'));
  await ui.settle();
  assert.equal(ui.input('as-brief').props.value, 'saved by user');
  assert.equal(ui.button('保存简报').props.disabled, true);
  ui.refresh();
  const stale = ui.requests.shift();
  ui.change('as-root', 'B');
  ui.click('打开');
  const open = ui.requests.shift();
  assert.equal(open.body.root, 'B');
  open.respond(project('B', 'brief B', 'rev-b'));
  await ui.settle();
  stale.respond(project('A', 'stale A', 'rev-old'));
  await ui.settle();
  assert.equal(ui.input('as-root').props.value, 'B');
  assert.equal(ui.input('as-brief').props.value, 'brief B');
  ui.change('as-brief', 'saved in B');
  ui.click('保存简报');
  const saveB = ui.requests.shift();
  assert.equal(saveB.body.root, 'B');
  assert.equal(saveB.body.revision, 'rev-b');
  saveB.respond(project('B', 'saved in B', 'rev-b2'));
  await ui.settle();
  assert.equal(ui.button('保存简报').props.disabled, true);
});

test('only compatible initialized projects allow continue, pause and copied directives', async () => {
  for (const cliCompatibility of ['legacy', 'custom', 'missing', 'invalid', null, undefined]) {
    const ui = workbench();
    ui.requests.shift().respond({ ...project('A', 'brief', 'rev'), cliCompatibility });
    await ui.settle();
    assert.ok(ui.find(node => node.props?.role === 'alert' && node.children.some(child => typeof child === 'string' && child.includes('项目命令尚未升级'))), String(cliCompatibility));
    for (const label of ['开始 / 继续项目', '交接并暂停', '复制继续指令']) {
      assert.equal(ui.button(label).props.disabled, true, `${label} ${cliCompatibility}`);
    }
    assert.equal(ui.button('刷新进度').props.disabled, false);
    ui.click('项目简报');
    assert.equal(ui.input('as-brief').props.value, 'brief');
  }
  const ui = workbench();
  ui.requests.shift().respond(project('A', 'brief', 'rev'));
  await ui.settle();
  for (const label of ['开始 / 继续项目', '交接并暂停', '复制继续指令']) {
    assert.notEqual(ui.button(label).props.disabled, true, label);
  }
});

test('a previously prepared directive cannot be copied after compatibility changes', async () => {
  const ui = workbench({ shellOptions: { requestDraftInitialization() { throw new Error('host unavailable'); } } });
  ui.requests.shift().respond(project('A', 'brief', 'rev'));
  await ui.settle();
  ui.click('开始 / 继续项目');
  assert.notEqual(ui.button('复制指令').props.disabled, true);
  ui.refresh();
  ui.requests.shift().respond({ ...project('A', 'brief', 'rev'), cliCompatibility: 'legacy' });
  await ui.settle();
  assert.equal(ui.button('复制指令').props.disabled, true);
  assert.doesNotMatch(ui.input('as-directive').props.value, /node \.studio\/studio\.mjs/);
  assert.equal(ui.button('复制继续指令').props.disabled, true);
});

test('switching projects clears an old prepared directive only after a successful switch', async () => {
  const ui = workbench({ shellOptions: { requestDraftInitialization() { throw new Error('host unavailable'); } } });
  ui.requests.shift().respond(project('A', 'brief A', 'rev-a'));
  await ui.settle();
  ui.click('开始 / 继续项目');
  assert.match(ui.input('as-directive').props.value, /项目目录：A/);
  ui.click('刷新进度');
  ui.requests.shift().respond(project('A', 'brief A', 'rev-a', 1));
  await ui.settle();
  assert.match(ui.input('as-directive').props.value, /项目目录：A/);
  ui.change('as-root', 'B');
  ui.click('打开');
  const failed = ui.requests.shift();
  assert.equal(failed.body.root, 'B');
  failed.reject('打开失败');
  await ui.settle();
  assert.match(ui.input('as-directive').props.value, /项目目录：A/);
  ui.click('打开');
  const open = ui.requests.shift();
  assert.match(ui.input('as-directive').props.value, /项目目录：A/);
  open.respond(project('B', 'brief B', 'rev-b'));
  await ui.settle();
  assert.equal(ui.input('as-root').props.value, 'B');
  assert.throws(() => ui.input('as-directive'), /element not found/);
  ui.click('复制继续指令');
  await ui.settle();
  assert.equal(ui.copied.length, 1);
  assert.match(ui.copied[0], /项目目录：B/);
  assert.doesNotMatch(ui.copied[0], /项目目录：A/);
});

test('real API rejects stale revision after a refresh returns an external edit', async t => {
  const scratch = new URL('../../.scratch/', import.meta.url);
  fs.mkdirSync(scratch, { recursive: true });
  const root = fs.mkdtempSync(path.join(fileURLToPath(scratch), 'refresh-input-safety-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, '.studio'));
  fs.writeFileSync(path.join(root, '.studio', 'state.json'), JSON.stringify({ name: '测试项目', paused: false, tasks: [], inbox: [] }));
  const briefFile = path.join(root, '.studio', 'BRIEF.md');
  fs.writeFileSync(briefFile, 'original');
  fs.copyFileSync(new URL('../../bin/studio.mjs', import.meta.url), path.join(root, '.studio', 'studio.mjs'));
  const api = createStudioApi({ sessions: { get: () => ({ header: { cwd: root } }) } });
  const ui = workbench({ api });
  await ui.requests.shift().execute();
  await ui.settle();
  ui.click('项目简报');
  ui.refresh();
  const refresh = ui.requests.shift();
  ui.change('as-brief', 'my changes');
  fs.writeFileSync(briefFile, 'external changes');
  await refresh.execute();
  await ui.settle();
  assert.equal(ui.input('as-brief').props.value, 'my changes');
  ui.click('保存简报');
  const save = ui.requests.shift();
  assert.equal(save.body.brief, 'my changes');
  await save.execute();
  await ui.settle();
  assert.equal(fs.readFileSync(briefFile, 'utf8'), 'external changes');
  assert.equal(ui.input('as-brief').props.value, 'my changes');
  assert.ok(ui.find(node => node.props?.role === 'alert' && node.children.includes('目标已被修改，请重新加载后再保存')));
});

test('source uses semantic append, guards concurrent edits, and never submits the conversation', () => {
  const source = fs.readFileSync(new URL('../client.js', import.meta.url), 'utf8');
  assert.match(source, /requestDraftInitialization\(\{ prompt: text, whenDraftExists: 'append' \}\)/);
  assert.doesNotMatch(source, /input\.setDraft\(/);
  assert.doesNotMatch(source, /\.submit\(/);
  assert.match(source, /version === requestVersion\.current/);
  assert.match(source, /busy \|\| briefDirty/);
  assert.match(source, /setRevision\(next\.revision/);
});

test('roles tab renders director, engineer, and reviewer roles with default config values', async () => {
  const ui = workbench();
  ui.requests.shift().respond(project('A', 'brief A', 'rev-1'));
  await ui.settle();
  ui.click('角色与路由');

  assert.ok(ui.find(node => typeof node.children === 'string' && /director/i.test(node.children) || Array.isArray(node.children) && node.children.some(c => typeof c === 'string' && /director/i.test(c))));
  assert.ok(ui.find(node => typeof node.children === 'string' && /engineer/i.test(node.children) || Array.isArray(node.children) && node.children.some(c => typeof c === 'string' && /engineer/i.test(c))));
  assert.ok(ui.find(node => typeof node.children === 'string' && /reviewer/i.test(node.children) || Array.isArray(node.children) && node.children.some(c => typeof c === 'string' && /reviewer/i.test(c))));

  assert.equal(ui.input('as-concurrency').props.value, 2);
  assert.equal(ui.input('as-fast-track').props.checked, true);
  assert.equal(ui.input('as-route-coding-provider').props.value, 'workbuddy-subscription');
  assert.equal(ui.input('as-route-coding-model').props.value, 'deepseek-v4.1-flash');
  assert.equal(ui.input('as-route-coding-effort').props.value, 'high');
  assert.equal(ui.input('as-route-coding-skills').props.value, 'ponytail, code-simplification');
  assert.equal(ui.input('as-route-debug-model').props.value, 'gpt-6.1-terra');
  assert.equal(ui.input('as-route-visual-model').props.value, 'gemini-3.8-flash');
  assert.equal(ui.input('as-route-reviewer-model').props.value, 'deepseek-v4.1-flash');
});

test('config save and reset buttons dispatch correct action requests and update form values', async () => {
  const ui = workbench();
  ui.requests.shift().respond(project('A', 'brief A', 'rev-1'));
  await ui.settle();
  ui.click('角色与路由');

  ui.change('as-concurrency', 4);
  ui.change('as-route-coding-model', 'custom-coding-model');
  ui.change('as-route-coding-skills', 'ponytail, code-simplification');

  ui.click('保存配置');
  const saveReq = ui.requests.shift();
  assert.equal(saveReq.body.action, 'config');
  assert.equal(saveReq.body.config.concurrency, 4);
  assert.equal(saveReq.body.config.roles.engineer.routes.coding.model, 'custom-coding-model');
  assert.deepEqual(saveReq.body.config.roles.engineer.routes.coding.skills, ['ponytail', 'code-simplification']);

  saveReq.respond({
    ...project('A', 'brief A', 'rev-1'),
    config: saveReq.body.config,
  });
  await ui.settle();
  assert.equal(ui.input('as-concurrency').props.value, 4);
  assert.equal(ui.input('as-route-coding-model').props.value, 'custom-coding-model');

  ui.click('恢复默认');
  const resetReq = ui.requests.shift();
  assert.equal(resetReq.body.action, 'reset-config');
  resetReq.respond({
    ...project('A', 'brief A', 'rev-1'),
    config: {
      version: '0.2.0',
      concurrency: 2,
      fastTrackLowRisk: true,
      roles: {
        director: { mode: 'main', provider: 'main', model: 'current', reasoningEffort: 'default', skills: [] },
        engineer: {
          mode: 'subagent',
          routes: {
            coding: { provider: 'workbuddy-subscription', model: 'deepseek-v4.1-flash', reasoningEffort: 'high', skills: ['ponytail'] },
            debug: { provider: 'codex-chatgpt', model: 'gpt-6.1-terra', reasoningEffort: 'high', skills: [] },
            visual: { provider: 'antigravity', model: 'gemini-3.8-flash', reasoningEffort: 'high', skills: ['frontend-design'] },
          },
        },
        reviewer: { mode: 'subagent', provider: 'workbuddy-subscription', model: 'deepseek-v4.1-flash', reasoningEffort: 'high', skills: [] },
      },
    },
  });
  await ui.settle();
  assert.equal(ui.input('as-concurrency').props.value, 2);
  assert.equal(ui.input('as-route-coding-model').props.value, 'deepseek-v4.1-flash');
});

test('in-flight refresh does not overwrite edited configuration form inputs', async () => {
  const ui = workbench();
  ui.requests.shift().respond(project('A', 'brief A', 'rev-1'));
  await ui.settle();
  ui.click('角色与路由');

  ui.refresh();
  const refreshReq = ui.requests.shift();
  assert.equal(refreshReq.body.root, 'A');

  ui.change('as-route-coding-model', 'my-editing-model');

  refreshReq.respond({
    ...project('A', 'brief A', 'rev-2', 1),
    config: {
      version: '0.2.0',
      concurrency: 3,
      fastTrackLowRisk: false,
      roles: {
        director: { mode: 'main', provider: 'main', model: 'current', reasoningEffort: 'default', skills: [] },
        engineer: {
          mode: 'subagent',
          routes: {
            coding: { provider: 'remote', model: 'remote-model', reasoningEffort: 'low', skills: [] },
            debug: { provider: 'codex-chatgpt', model: 'gpt-6.1-terra', reasoningEffort: 'high', skills: [] },
            visual: { provider: 'antigravity', model: 'gemini-3.8-flash', reasoningEffort: 'high', skills: ['frontend-design'] },
          },
        },
        reviewer: { mode: 'subagent', provider: 'workbuddy-subscription', model: 'deepseek-v4.1-flash', reasoningEffort: 'high', skills: [] },
      },
    },
  });
  await ui.settle();

  assert.equal(ui.input('as-route-coding-model').props.value, 'my-editing-model');
});

test('task cards display mode, worker, modelRoute, and risk metadata, omitting missing fields gracefully', async () => {
  const ui = workbench();
  const t1 = {
    id: 't1',
    title: '完整元数据任务',
    status: 'in_progress',
    mode: 'subagent',
    worker: 'worker-1',
    modelRoute: 'workbuddy-subscription/deepseek-v4.1-flash',
    risk: 'low',
  };
  const t2 = {
    id: 't2',
    title: '缺失元数据任务',
    status: 'todo',
  };
  ui.requests.shift().respond({
    ...project('A', 'brief A', 'rev-1'),
    tasks: [t1, t2],
  });
  await ui.settle();

  const taskNodes = [];
  function collectTasks(node) {
    if (Array.isArray(node)) node.forEach(collectTasks);
    else if (node && typeof node === 'object') {
      if (typeof node.type === 'function' && node.props?.task) taskNodes.push(node);
      if (node.children) collectTasks(node.children);
    }
  }
  collectTasks(ui.find(n => n.props?.className === 'as-tasks'));
  assert.equal(taskNodes.length, 2);

  function hasText(root, text) {
    let found = false;
    function walk(n) {
      if (found) return;
      if (Array.isArray(n)) n.forEach(walk);
      else if (n && typeof n === 'object') {
        if (typeof n.children === 'string' && n.children.includes(text)) found = true;
        if (Array.isArray(n.children) && n.children.some(c => typeof c === 'string' && c.includes(text))) found = true;
        if (n.children) walk(n.children);
      }
    }
    walk(root);
    return found;
  }

  const t1Tree = taskNodes[0].type(taskNodes[0].props);
  assert.ok(hasText(t1Tree, 'Subagent'));
  assert.ok(hasText(t1Tree, 'worker-1'));
  assert.ok(hasText(t1Tree, 'workbuddy-subscription/deepseek-v4.1-flash'));
  assert.ok(hasText(t1Tree, '低风险'));

  const t2Tree = taskNodes[1].type(taskNodes[1].props);
  assert.equal(hasText(t2Tree, 'Subagent'), false);
  assert.equal(hasText(t2Tree, 'Teammate'), false);
  assert.equal(hasText(t2Tree, '模型路由'), false);
});

test('prepared directive explicitly includes discipline rules: 主控零开发、双轨委派、只审结构化回执', async () => {
  const ui = workbench();
  ui.requests.shift().respond(project('A', 'brief A', 'rev-1'));
  await ui.settle();
  ui.click('开始 / 继续项目');
  const directiveText = ui.input('as-directive').props.value;
  assert.match(directiveText, /主控零开发/);
  assert.match(directiveText, /双轨委派/);
  assert.match(directiveText, /只审结构化回执/);
});

test('switching project with unsaved config draft prompts confirmation; cancel preserves draft while confirm discards and loads new project config', async () => {
  const ui = workbench();
  ui.requests.shift().respond({
    ...project('A', 'brief A', 'rev-a'),
    config: {
      version: '0.2.0',
      concurrency: 2,
      fastTrackLowRisk: true,
      roles: {
        director: { mode: 'main', provider: 'main', model: 'current', reasoningEffort: 'default', skills: [] },
        engineer: {
          mode: 'subagent',
          routes: {
            coding: { provider: 'workbuddy-subscription', model: 'deepseek-v4.1-flash', reasoningEffort: 'high', skills: ['ponytail'] },
            debug: { provider: 'codex-chatgpt', model: 'gpt-6.1-terra', reasoningEffort: 'high', skills: [] },
            visual: { provider: 'antigravity', model: 'gemini-3.8-flash', reasoningEffort: 'high', skills: ['frontend-design'] },
          },
        },
        reviewer: { mode: 'subagent', provider: 'workbuddy-subscription', model: 'deepseek-v4.1-flash', reasoningEffort: 'high', skills: [] },
      },
    },
  });
  await ui.settle();

  ui.click('角色与路由');
  ui.change('as-route-coding-model', 'UNSAVED-ROUTING-MODEL');
  assert.equal(ui.input('as-route-coding-model').props.value, 'UNSAVED-ROUTING-MODEL');

  ui.change('as-root', 'B');

  ui.refresh();
  const inFlightRefresh = ui.requests.shift();
  assert.equal(inFlightRefresh.body.action, 'load');
  assert.equal(inFlightRefresh.body.root, 'A');

  ui.setConfirm(false);
  ui.click('打开');

  assert.equal(ui.confirms.length, 1);
  assert.match(ui.confirms[0], /未保存修改/);
  assert.equal(ui.requests.length, 0);

  inFlightRefresh.respond({
    ...project('A', 'brief A', 'rev-a-new'),
    config: {
      version: '0.2.0',
      concurrency: 2,
      fastTrackLowRisk: true,
      roles: {
        director: { mode: 'main', provider: 'main', model: 'current', reasoningEffort: 'default', skills: [] },
        engineer: {
          mode: 'subagent',
          routes: {
            coding: { provider: 'workbuddy-subscription', model: 'deepseek-v4.1-flash', reasoningEffort: 'high', skills: ['ponytail'] },
            debug: { provider: 'codex-chatgpt', model: 'gpt-6.1-terra', reasoningEffort: 'high', skills: [] },
            visual: { provider: 'antigravity', model: 'gemini-3.8-flash', reasoningEffort: 'high', skills: ['frontend-design'] },
          },
        },
        reviewer: { mode: 'subagent', provider: 'workbuddy-subscription', model: 'deepseek-v4.1-flash', reasoningEffort: 'high', skills: [] },
      },
    },
  });
  await ui.settle();

  assert.equal(ui.input('as-route-coding-model').props.value, 'UNSAVED-ROUTING-MODEL');

  ui.setConfirm(true);
  ui.click('打开');

  assert.equal(ui.confirms.length, 2);
  assert.equal(ui.requests.length, 1);
  const switchReq = ui.requests.shift();
  assert.equal(switchReq.body.action, 'load');
  assert.equal(switchReq.body.root, 'B');

  switchReq.respond({
    ...project('B', 'brief B', 'rev-b'),
    config: {
      version: '0.2.0',
      concurrency: 4,
      fastTrackLowRisk: false,
      roles: {
        director: { mode: 'main', provider: 'main', model: 'current', reasoningEffort: 'default', skills: [] },
        engineer: {
          mode: 'subagent',
          routes: {
            coding: { provider: 'custom-provider', model: 'project-b-model', reasoningEffort: 'low', skills: [] },
            debug: { provider: 'codex-chatgpt', model: 'gpt-6.1-terra', reasoningEffort: 'high', skills: [] },
            visual: { provider: 'antigravity', model: 'gemini-3.8-flash', reasoningEffort: 'high', skills: ['frontend-design'] },
          },
        },
        reviewer: { mode: 'subagent', provider: 'workbuddy-subscription', model: 'deepseek-v4.1-flash', reasoningEffort: 'high', skills: [] },
      },
    },
  });
  await ui.settle();

  assert.equal(ui.input('as-root').props.value, 'B');
  assert.equal(ui.input('as-route-coding-model').props.value, 'project-b-model');
  assert.equal(ui.input('as-concurrency').props.value, 4);
});

test('saving or resetting config clears configDirty allowing project switch without confirmation', async () => {
  const ui = workbench();
  ui.requests.shift().respond(project('A', 'brief A', 'rev-a'));
  await ui.settle();

  ui.click('角色与路由');
  ui.change('as-route-coding-model', 'edited-model');
  assert.equal(ui.input('as-route-coding-model').props.value, 'edited-model');

  ui.click('保存配置');
  const saveReq = ui.requests.shift();
  assert.equal(saveReq.body.action, 'config');
  saveReq.respond({
    ...project('A', 'brief A', 'rev-a2'),
    config: saveReq.body.config,
  });
  await ui.settle();

  ui.change('as-root', 'B');
  ui.click('打开');

  assert.equal(ui.confirms.length, 0);
  assert.equal(ui.requests.length, 1);
  const switchReq = ui.requests.shift();
  assert.equal(switchReq.body.root, 'B');
  switchReq.respond(project('B', 'brief B', 'rev-b'));
  await ui.settle();

  assert.equal(ui.input('as-root').props.value, 'B');

  // 恢复默认路径：编辑配置 → 点「恢复默认」→ 响应返回默认 config → 表单恢复默认 → 切换无需确认
  ui.change('as-route-coding-model', 'edited-again');
  assert.equal(ui.input('as-route-coding-model').props.value, 'edited-again');

  ui.click('恢复默认');
  const resetReq = ui.requests.shift();
  assert.equal(resetReq.body.action, 'reset-config');
  resetReq.respond(project('B', 'brief B', 'rev-b2'));
  await ui.settle();
  assert.equal(ui.input('as-route-coding-model').props.value, 'deepseek-v4.1-flash');
  assert.equal(ui.input('as-concurrency').props.value, 2);

  ui.change('as-root', 'C');
  ui.click('打开');

  assert.equal(ui.confirms.length, 0);
  assert.equal(ui.requests.length, 1);
  const resetSwitch = ui.requests.shift();
  assert.equal(resetSwitch.body.root, 'C');
  resetSwitch.respond(project('C', 'brief C', 'rev-c'));
  await ui.settle();

  assert.equal(ui.input('as-root').props.value, 'C');
});

test('directory picker protects the unsaved brief and clears feedback only on a successful project switch', async () => {
  const ui = workbench();
  ui.requests.shift().respond(project('A', 'brief A', 'rev-a'));
  await ui.settle();
  ui.click('反馈与交接'); ui.change('as-feedback', '仅项目 A 的反馈');
  ui.click('项目简报'); ui.change('as-brief', '未保存的简报');
  ui.setPick('B'); ui.setConfirm(false); ui.click('选择');
  await ui.settle();
  assert.equal(ui.confirms.length, 1);
  assert.equal(ui.requests.length, 0);
  assert.equal(ui.input('as-brief').props.value, '未保存的简报');
  ui.setConfirm(true); ui.click('选择'); await ui.settle();
  ui.requests.shift().respond(project('B', 'brief B', 'rev-b'));
  await ui.settle();
  assert.equal(ui.input('as-brief').props.value, 'brief B');
  ui.click('反馈与交接');
  assert.equal(ui.input('as-feedback').props.value, '');
});

test('browsing to the current project root with an unsaved config draft still prompts; cancel preserves draft and root, confirm loads', async () => {
  const ui = workbench();
  const baseProject = {
    ...project('A', 'brief A', 'rev-a'),
    config: {
      version: '0.2.0',
      concurrency: 2,
      fastTrackLowRisk: true,
      roles: {
        director: { mode: 'main', provider: 'main', model: 'current', reasoningEffort: 'default', skills: [] },
        engineer: {
          mode: 'subagent',
          routes: {
            coding: { provider: 'workbuddy-subscription', model: 'deepseek-v4.1-flash', reasoningEffort: 'high', skills: ['ponytail'] },
            debug: { provider: 'codex-chatgpt', model: 'gpt-6.1-terra', reasoningEffort: 'high', skills: [] },
            visual: { provider: 'antigravity', model: 'gemini-3.8-flash', reasoningEffort: 'high', skills: ['frontend-design'] },
          },
        },
        reviewer: { mode: 'subagent', provider: 'workbuddy-subscription', model: 'deepseek-v4.1-flash', reasoningEffort: 'high', skills: [] },
      },
    },
  };
  ui.requests.shift().respond(baseProject);
  await ui.settle();

  ui.click('角色与路由');
  ui.change('as-route-coding-model', 'BROWSE-UNSAVED');
  assert.equal(ui.input('as-route-coding-model').props.value, 'BROWSE-UNSAVED');

  // 选择器返回当前项目根 A：即便没有"换项目"，也不能静默丢弃未保存草稿
  ui.setPick('A');
  ui.setConfirm(false);
  ui.click('选择');
  await ui.settle();

  assert.equal(ui.confirms.length, 1);
  assert.match(ui.confirms[0], /未保存修改/);
  assert.equal(ui.requests.length, 0);
  assert.equal(ui.input('as-route-coding-model').props.value, 'BROWSE-UNSAVED');
  assert.equal(ui.input('as-root').props.value, 'A');

  ui.setConfirm(true);
  ui.click('选择');
  await ui.settle();

  assert.equal(ui.confirms.length, 2);
  assert.equal(ui.requests.length, 1);
  const reload = ui.requests.shift();
  assert.equal(reload.body.action, 'load');
  assert.equal(reload.body.root, 'A');
  reload.respond(baseProject);
  await ui.settle();
  assert.equal(ui.input('as-root').props.value, 'A');
  assert.equal(ui.input('as-route-coding-model').props.value, 'deepseek-v4.1-flash');
});

function configWith(overrides = {}) {
  const cfg = {
    version: '0.2.0',
    concurrency: 2,
    fastTrackLowRisk: true,
    roles: {
      director: { mode: 'main', provider: 'main', model: 'current', reasoningEffort: 'default', skills: [] },
      engineer: {
        mode: 'subagent',
        routes: {
          coding: { provider: 'workbuddy-subscription', model: 'deepseek-v4.1-flash', reasoningEffort: 'high', skills: ['ponytail'] },
          debug: { provider: 'codex-chatgpt', model: 'gpt-6.1-terra', reasoningEffort: 'high', skills: [] },
          visual: { provider: 'antigravity', model: 'gemini-3.8-flash', reasoningEffort: 'high', skills: ['frontend-design'] },
        },
      },
      reviewer: { mode: 'subagent', provider: 'workbuddy-subscription', model: 'deepseek-v4.1-flash', reasoningEffort: 'high', skills: [] },
    },
  };
  return { ...cfg, ...overrides };
}

test('directive is built from the SAVED project config, not a default, per role route, review policy and concurrency', async () => {
  const ui = workbench();
  ui.requests.shift().respond({
    ...project('A', 'brief A', 'rev-1'),
    config: configWith({
      concurrency: 1,
      fastTrackLowRisk: false,
      roles: {
        director: { mode: 'main', provider: 'main', model: 'current', reasoningEffort: 'default', skills: [] },
        engineer: {
          mode: 'subagent',
          routes: {
            coding: { provider: 'saved-prov', model: 'saved-coding-model', reasoningEffort: 'low', skills: ['saved-skill'] },
            debug: { provider: 'codex-chatgpt', model: 'gpt-6.1-terra', reasoningEffort: 'high', skills: [] },
            visual: { provider: 'antigravity', model: 'gemini-3.8-flash', reasoningEffort: 'high', skills: ['frontend-design'] },
          },
        },
        reviewer: { mode: 'subagent', provider: 'reviewer-prov', model: 'reviewer-model', reasoningEffort: 'medium', skills: [] },
      },
    }),
  });
  await ui.settle();
  ui.click('开始 / 继续项目');
  const text = ui.input('as-directive').props.value;
  // Uses saved config values verbatim.
  assert.match(text, /saved-prov\/saved-coding-model · low · 技能 saved-skill/);
  assert.match(text, /reviewer-prov\/reviewer-model · medium/);
  assert.match(text, /concurrency=1/);
  assert.match(text, /fastTrackLowRisk=关/);
  // Points the main agent to resolve config + dispatch (real native tool params), not a static route.
  assert.match(text, /node \.studio\/studio\.mjs config/);
  assert.match(text, /node \.studio\/studio\.mjs dispatch/);
  assert.match(text, /packet\.config/);
  assert.match(text, /packet\.execution/);
  assert.match(text, /execution\.requested\.skills/);
  assert.match(text, /Team\(teammate\)/);
  // Does NOT leak default model ids that are absent from the saved config.
  assert.doesNotMatch(text, /workbuddy-subscription\/deepseek-v4\.1-flash/);
  assert.doesNotMatch(text, /未保存的配置修改/);
});

test('an unsaved config draft does NOT silently claim to be in effect in the prepared directive', async () => {
  const ui = workbench();
  ui.requests.shift().respond({ ...project('A', 'brief A', 'rev-1'), config: configWith() });
  await ui.settle();
  ui.click('角色与路由');
  ui.change('as-route-coding-model', 'UNSAVED-MODEL');
  ui.change('as-concurrency', 5);
  ui.click('开始 / 继续项目');
  const text = ui.input('as-directive').props.value;
  // Saved values remain referenced; unsaved draft values are never presented as effective.
  assert.match(text, /workbuddy-subscription\/deepseek-v4\.1-flash/);
  assert.match(text, /concurrency=2/);
  assert.doesNotMatch(text, /UNSAVED-MODEL/);
  assert.doesNotMatch(text, /concurrency=5/);
  assert.match(text, /未保存的配置修改/);
});

test('saving config then preparing directive reflects the newly saved routing', async () => {
  const ui = workbench();
  ui.requests.shift().respond({ ...project('A', 'brief A', 'rev-1'), config: configWith() });
  await ui.settle();
  ui.click('角色与路由');
  ui.change('as-route-coding-model', 'fresh-saved-model');
  ui.change('as-route-coding-provider', 'fresh-prov');
  ui.click('保存配置');
  const saveReq = ui.requests.shift();
  assert.equal(saveReq.body.action, 'config');
  saveReq.respond({ ...project('A', 'brief A', 'rev-1'), config: saveReq.body.config });
  await ui.settle();
  ui.click('开始 / 继续项目');
  const text = ui.input('as-directive').props.value;
  assert.match(text, /engineer\.coding：fresh-prov\/fresh-saved-model/);
  assert.doesNotMatch(text, /engineer\.coding：workbuddy-subscription/);
});

test('host skillCatalog renders real source and per-entry availability/missing/unverified; project scan is not host-available', async () => {
  const ui = workbench();
  ui.requests.shift().respond({
    ...project('A', 'brief A', 'rev-1'),
    skillCatalog: {
      source: 'host.skills.snapshot', available: true, complete: true, toolAvailable: true, reason: null,
      entries: [
        { name: 'ponytail', source: 'preset', provider: 'preset-1', origin: 'host', available: true, status: 'available', invocation: { modelInvocable: true, userInvocable: true }, configured: true },
        { name: 'project-only-skill', source: 'project-agents', provider: 'project-scan', origin: 'project', available: false, status: 'unverified', configured: false },
        { name: 'ghost-skill', source: 'config', provider: null, origin: 'config', available: false, status: 'missing', configured: true },
      ],
    },
  });
  await ui.settle();
  ui.click('角色与路由');
  const catalog = ui.find(n => n.props?.['data-skill-catalog']);
  assert.equal(catalog.props['data-skill-catalog'], 'available');
  assert.ok(ui.find(n => n.props?.['data-skill-source'] === 'host.skills.snapshot'));
  const statuses = [];
  (function walk(n) {
    if (Array.isArray(n)) { n.forEach(walk); return; }
    if (!n || typeof n !== 'object') return;
    if (n.props?.['data-skill-status']) statuses.push(n.props['data-skill-status']);
    if (n.children) walk(n.children);
  })(catalog);
  assert.deepEqual(statuses, ['available', 'unverified', 'missing']);
  const text = JSON.stringify(catalog);
  assert.match(text, /可用/);
  assert.match(text, /未确认/);
  assert.match(text, /缺失/);
});

test('absent or legacy skillCatalog degrades gracefully without breaking free-form skill input', async () => {
  const ui = workbench();
  ui.requests.shift().respond(project('A', 'brief A', 'rev-1'));
  await ui.settle();
  ui.click('角色与路由');
  const catalog = ui.find(n => n.props?.['data-skill-catalog']);
  assert.equal(catalog.props['data-skill-catalog'], 'absent');
  assert.match(JSON.stringify(catalog), /宿主技能状态不可用/);
  // Free-form input still accepts an arbitrary skill name.
  ui.change('as-route-coding-skills', 'totally-custom-skill');
  assert.equal(ui.input('as-route-coding-skills').props.value, 'totally-custom-skill');
});

test('task card separates requested route from actual for a Team task and shows inheritance, never spawn as LLM', async () => {
  const ui = workbench();
  const teamTask = {
    id: 't-team',
    title: 'Team 任务',
    status: 'in_progress',
    mode: 'teammate',
    worker: 'eng-x',
    modelRoute: 'workbuddy-subscription/deepseek-v4.1-flash',
    modelRouteKind: 'requested',
    risk: 'high',
    execution: {
      mode: 'teammate', role: 'engineer', route: 'coding', risk: 'high',
      requested: { mode: 'teammate', provider: 'workbuddy-subscription', model: 'deepseek-v4.1-flash', reasoningEffort: 'high', skills: [] },
      effective: { tool: 'spawn_teammate', routing: 'inherit-parent', provider: null, model: null, reasoningEffort: null },
      actual: { status: 'unverified', provider: null, model: null, reasoningEffort: null },
    },
  };
  const subTask = {
    id: 't-sub',
    title: 'Subagent 任务',
    status: 'in_progress',
    mode: 'subagent',
    worker: 'eng-y',
    modelRoute: 'codex-chatgpt/gpt-6.1-terra',
    modelRouteKind: 'requested',
    risk: 'low',
    execution: {
      mode: 'subagent', role: 'engineer', route: 'debug', risk: 'low',
      requested: { mode: 'subagent', provider: 'codex-chatgpt', model: 'gpt-6.1-terra', reasoningEffort: 'high', skills: [] },
      effective: { tool: 'subagent', routing: 'explicit-request', provider: 'codex-chatgpt', model: 'gpt-6.1-terra', reasoningEffort: 'high' },
      actual: { status: 'unverified', provider: null, model: null, reasoningEffort: null },
    },
  };
  const doneTask = {
    id: 't-done',
    title: '已确认实际的任务',
    status: 'done',
    mode: 'subagent',
    modelRoute: 'prov-a/model-a',
    execution: {
      mode: 'subagent', requested: { provider: 'prov-a', model: 'model-a', reasoningEffort: 'high', skills: [] },
      effective: { tool: 'subagent', routing: 'explicit-request' },
      actual: { status: 'confirmed', provider: 'prov-a', model: 'model-a', reasoningEffort: 'high' },
    },
  };
  ui.requests.shift().respond({ ...project('A', 'brief A', 'rev-1'), tasks: [teamTask, subTask, doneTask] });
  await ui.settle();

  const taskNodes = [];
  (function collect(node) {
    if (Array.isArray(node)) node.forEach(collect);
    else if (node && typeof node === 'object') {
      if (typeof node.type === 'function' && node.props?.task) taskNodes.push(node);
      if (node.children) collect(node.children);
    }
  })(ui.find(n => n.props?.className === 'as-tasks'));
  assert.equal(taskNodes.length, 3);
  const byId = id => taskNodes.find(n => n.props.task.id === id).type(taskNodes.find(n => n.props.task.id === id).props);

  function gather(root) {
    const items = [];
    (function walk(n) {
      if (!n || typeof n !== 'object') return;
      if (n.props?.['data-route-kind']) items.push(n);
      if (n.children) (Array.isArray(n.children) ? n.children : [n.children]).forEach(walk);
    })(root);
    return items;
  }
  const flat = node => JSON.stringify(node);

  const team = byId('t-team');
  const teamKinds = gather(team).map(n => n.props['data-route-kind']);
  assert.ok(teamKinds.includes('requested'));
  assert.ok(teamKinds.includes('team-inherit'));
  assert.match(flat(team), /请求路由：workbuddy-subscription\/deepseek-v4\.1-flash/);
  assert.match(flat(team), /继承父会话/);
  assert.match(flat(team), /spawn 等传输 provider 不是 LLM 供应商/);
  assert.match(flat(team), /未核实/);
  assert.doesNotMatch(flat(team), /实际：workbuddy-subscription/);

  const sub = byId('t-sub');
  assert.match(flat(sub), /请求路由：codex-chatgpt\/gpt-6\.1-terra/);
  assert.match(flat(sub), /未核实/);
  assert.equal(gather(sub).some(n => n.props['data-route-kind'] === 'team-inherit'), false);

  const done = byId('t-done');
  const actualNode = gather(done).find(n => n.props['data-route-kind'] === 'actual');
  assert.ok(actualNode);
  assert.match(flat(actualNode), /实际：prov-a \/ model-a \/ high/);
});

test('legacy task without execution still renders mode/modelRoute/risk and does not crash', async () => {
  const ui = workbench();
  const legacy = { id: 'old', title: '旧账本任务', status: 'todo', mode: 'subagent', modelRoute: 'legacy-prov/legacy-model', risk: 'low' };
  ui.requests.shift().respond({ ...project('A', 'brief A', 'rev-1'), tasks: [legacy] });
  await ui.settle();
  const nodes = [];
  (function collect(node) {
    if (Array.isArray(node)) node.forEach(collect);
    else if (node && typeof node === 'object') {
      if (typeof node.type === 'function' && node.props?.task) nodes.push(node);
      if (node.children) collect(node.children);
    }
  })(ui.find(n => n.props?.className === 'as-tasks'));
  assert.equal(nodes.length, 1);
  const tree = nodes[0].type(nodes[0].props);
  const text = JSON.stringify(tree);
  assert.match(text, /请求路由：legacy-prov\/legacy-model/);
  assert.match(text, /低风险/);
  assert.match(text, /Subagent/);
});

test('background refresh / save / switch still protect an unsaved config draft while catalog and task rendering coexist', async () => {
  const ui = workbench();
  ui.requests.shift().respond({
    ...project('A', 'brief A', 'rev-1'),
    config: configWith(),
    skillCatalog: { source: 'host.skills.snapshot', available: true, complete: true, toolAvailable: true, reason: null, entries: [] },
  });
  await ui.settle();
  ui.click('角色与路由');
  ui.change('as-route-coding-model', 'keep-draft-model');

  ui.refresh();
  const refreshReq = ui.requests.shift();
  refreshReq.respond({ ...project('A', 'brief A', 'rev-2', 1), config: configWith({ concurrency: 3 }), skillCatalog: { source: 'host.skills.snapshot', available: true, complete: true, toolAvailable: true, reason: null, entries: [] } });
  await ui.settle();
  assert.equal(ui.input('as-route-coding-model').props.value, 'keep-draft-model');

  // Switching project must warn and, on cancel, keep the draft.
  ui.change('as-root', 'B');
  ui.setConfirm(false);
  ui.click('打开');
  assert.equal(ui.confirms.length, 1);
  assert.equal(ui.requests.length, 0);
  assert.equal(ui.input('as-route-coding-model').props.value, 'keep-draft-model');
});
