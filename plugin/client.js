window.__ModuleLoader__.load({
  id: 'dsh-agent-studio',
  factory: require => {
    const React = require('react');
    const { createElement: h, useState, useEffect, useRef, useSyncExternalStore } = React;
    const views = { todo: '待办', in_progress: '进行中', review: '待验收', done: '已完成' };
    let ctx;
    let opened = false;
    const listeners = new Set();
    const panel = {
      subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
      snapshot: () => opened,
      set(value) { opened = value; listeners.forEach(fn => fn()); },
    };

    const defaultRoles = {
      director: { mode: 'main', provider: 'main', model: 'current', reasoningEffort: 'default', skills: [] },
      engineer: {
        mode: 'subagent',
        routes: {
          coding: { provider: 'workbuddy-subscription', model: 'deepseek-v4.1-flash', reasoningEffort: 'high', skills: ['ponytail', 'code-simplification'] },
          debug: { provider: 'codex-chatgpt', model: 'gpt-6.1-terra', reasoningEffort: 'high', skills: ['systematic-debugging'] },
          visual: { provider: 'antigravity', model: 'gemini-3.8-flash', reasoningEffort: 'high', skills: ['frontend-design'] },
        },
      },
      reviewer: { mode: 'subagent', provider: 'workbuddy-subscription', model: 'deepseek-v4.1-flash', reasoningEffort: 'high', skills: ['verification-before-completion'] },
    };

    const defaultConfig = {
      version: '0.2.0',
      concurrency: 2,
      fastTrackLowRisk: true,
      roles: defaultRoles,
    };

    function normalizeConfig(cfg) {
      if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) return JSON.parse(JSON.stringify(defaultConfig));
      const roles = cfg.roles || {};
      const eng = roles.engineer || {};
      const engRoutes = eng.routes || {};
      return {
        version: typeof cfg.version === 'string' ? cfg.version : '0.2.0',
        concurrency: typeof cfg.concurrency === 'number' ? cfg.concurrency : 2,
        fastTrackLowRisk: typeof cfg.fastTrackLowRisk === 'boolean' ? cfg.fastTrackLowRisk : true,
        roles: {
          director: {
            mode: 'main',
            provider: roles.director?.provider || defaultRoles.director.provider,
            model: roles.director?.model || defaultRoles.director.model,
            reasoningEffort: roles.director?.reasoningEffort || defaultRoles.director.reasoningEffort,
            skills: Array.isArray(roles.director?.skills) ? roles.director.skills : defaultRoles.director.skills,
          },
          engineer: {
            mode: 'subagent',
            routes: {
              coding: {
                provider: engRoutes.coding?.provider || defaultRoles.engineer.routes.coding.provider,
                model: engRoutes.coding?.model || defaultRoles.engineer.routes.coding.model,
                reasoningEffort: engRoutes.coding?.reasoningEffort || defaultRoles.engineer.routes.coding.reasoningEffort,
                skills: Array.isArray(engRoutes.coding?.skills) ? engRoutes.coding.skills : defaultRoles.engineer.routes.coding.skills,
              },
              debug: {
                provider: engRoutes.debug?.provider || defaultRoles.engineer.routes.debug.provider,
                model: engRoutes.debug?.model || defaultRoles.engineer.routes.debug.model,
                reasoningEffort: engRoutes.debug?.reasoningEffort || defaultRoles.engineer.routes.debug.reasoningEffort,
                skills: Array.isArray(engRoutes.debug?.skills) ? engRoutes.debug.skills : defaultRoles.engineer.routes.debug.skills,
              },
              visual: {
                provider: engRoutes.visual?.provider || defaultRoles.engineer.routes.visual.provider,
                model: engRoutes.visual?.model || defaultRoles.engineer.routes.visual.model,
                reasoningEffort: engRoutes.visual?.reasoningEffort || defaultRoles.engineer.routes.visual.reasoningEffort,
                skills: Array.isArray(engRoutes.visual?.skills) ? engRoutes.visual.skills : defaultRoles.engineer.routes.visual.skills,
              },
            },
          },
          reviewer: {
            mode: 'subagent',
            provider: roles.reviewer?.provider || defaultRoles.reviewer.provider,
            model: roles.reviewer?.model || defaultRoles.reviewer.model,
            reasoningEffort: roles.reviewer?.reasoningEffort || defaultRoles.reviewer.reasoningEffort,
            skills: Array.isArray(roles.reviewer?.skills) ? roles.reviewer.skills : defaultRoles.reviewer.skills,
          },
        },
      };
    }

    function toPayloadConfig(cfg) {
      const norm = normalizeConfig(cfg);
      const parse = val => Array.isArray(val) ? val : (typeof val === 'string' ? val.split(/[,，]/).map(s => s.trim()).filter(Boolean) : []);
      norm.concurrency = typeof cfg.concurrency === 'number' ? cfg.concurrency : Number(cfg.concurrency) || 2;
      norm.fastTrackLowRisk = Boolean(cfg.fastTrackLowRisk);
      norm.roles.engineer.routes.coding.skills = parse(cfg.roles?.engineer?.routes?.coding?.skills);
      norm.roles.engineer.routes.debug.skills = parse(cfg.roles?.engineer?.routes?.debug?.skills);
      norm.roles.engineer.routes.visual.skills = parse(cfg.roles?.engineer?.routes?.visual?.skills);
      norm.roles.reviewer.skills = parse(cfg.roles?.reviewer?.skills);
      return norm;
    }

    async function api(action, payload = {}) {
      const response = await fetch('/agent-studio/api/action', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...payload }),
      });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || '项目工作台请求失败');
      return result.project || (result.config ? { config: result.config } : result);
    }
    function currentId() {
      return ctx.uiWorkspace.mainReference?.sessionId || ctx.sessions.list.getSnapshot().current ||
        Object.values(ctx.sessions.list.getSnapshot().byId).find(row => (row.retainedBy?.mainView || 0) > 0)?.id || '';
    }
    function useSessionId() {
      return useSyncExternalStore(fn => ctx.sessions.list.subscribe(fn), currentId, currentId);
    }
    function inputFor(id) {
      const scope = ctx.sessions.scope(id);
      const conversation = scope?.get('conversation');
      return conversation?.input?.for(scope);
    }
    function prepareDraft(id, text) {
      if (currentId() !== id) throw new Error('会话已切换，请重新打开项目工作台');
      const input = inputFor(id);
      if (!input || typeof input.setDraft !== 'function') throw new Error('当前会话输入框尚未就绪');
      if (typeof input.requestDraftInitialization !== 'function') throw new Error('宿主未提供追加草稿接口，未覆盖输入框；可使用复制指令');
      if (input.requestDraftInitialization({ prompt: text, whenDraftExists: 'append' }) !== 'applied') throw new Error('输入框正在提交，请稍后重试；原草稿未改动');
      input.persistCurrentDraft?.();
    }
    function routeLine(label, route) {
      const skills = Array.isArray(route?.skills) ? route.skills.filter(Boolean) : [];
      return `${label}：${route?.provider || '未设置'}/${route?.model || '未设置'} · ${route?.reasoningEffort || 'default'} · 技能 ${skills.length ? skills.join('、') : '无'}`;
    }
    function savedConfigSummary(cfg) {
      const norm = normalizeConfig(cfg);
      const routes = norm.roles.engineer.routes;
      return [
        `并发上限 concurrency=${norm.concurrency}：dispatch 一次最多派 ${norm.concurrency} 个任务，--limit 只能收窄不能突破。`,
        `低风险快速通道 fastTrackLowRisk=${norm.fastTrackLowRisk ? '开' : '关'}：${norm.fastTrackLowRisk ? '低风险任务可由主控凭结构化回执直接收口，高风险仍须独立 worker 验收。' : '所有任务都必须由实现者之外的独立 worker 验收，主控不能自审。'}`,
        routeLine('engineer.coding', routes.coding),
        routeLine('engineer.debug', routes.debug),
        routeLine('engineer.visual', routes.visual),
        routeLine('reviewer', norm.roles.reviewer),
      ];
    }
    // Directive is built from the saved project.config (never the unsaved form), so what it tells the main
    // agent to dispatch is what the CLI will actually resolve; a dirty draft only adds a warning, never takes effect.
    function directive(project, kind, { configDirty = false } = {}) {
      const dirtyNote = configDirty
        ? '\n【注意】工作台表单里有未保存的配置修改，以下不是生效配置；必须先在「角色与路由」点保存（或恢复默认）后才生效，当前生效值仍是下面这份已保存配置。'
        : '';
      const base = `项目目录：${project.root}（所有项目命令均在此目录执行，不要在其他会话目录运行）\n先读取该项目的 .agents/skills/project-director/SKILL.md 和 .studio/BRIEF.md，再运行 node .studio/studio.mjs resume。你是唯一对话入口与账本记录者，主控零开发、双轨委派、只审结构化回执，使用 DSH 原生子 Agent 分派与独立验收，只有实际验收通过才记为完成。\n【启动先解析】先执行 node .studio/studio.mjs config 读取最新已保存配置，再执行 node .studio/studio.mjs dispatch 生成任务包；严格按任务包里的 packet.config 与 packet.execution 调用真实原生工具，并按 execution.requested.skills 在子代理开场先 call skill 逐个加载，不要凭记忆虚构模型路由或技能。\n【已保存配置】\n${savedConfigSummary(project.config).join('\n')}\n【执行契约】subagent 按 execution.requested 显式传 provider/model/reasoningEffort；Team(teammate) 通过原生 subagent 创建并用 send_message 续接，只传宿主原生支持的 name/description/prompt，继承父会话，不传 provider/model/effort，也不要把 spawn 传输 provider 当 LLM 供应商；只有拿到真实 actual 才算已确认实际值，否则保持未核实。${dirtyNote}`;
      if (kind === 'pause') return `${base}\n请先停止或等完实际 worker，保存当前成果与交接，再通过 pause 命令暂停派工；不要仅修改账本就声称任务进程已停止。`;
      if (kind === 'feedback') return `${base}\n请处理账本中新登记的反馈，先评估影响、更新计划，再执行和验收。`;
      return `${base}\n请开始或继续这个项目，先概括当前进度与下一步；若尚无明确目标，先和我确定首版范围。若项目已暂停，我授权恢复，先运行 resume --continue。不要重复启动还在运行的任务。`;
    }
    function skillStatusText(entry) {
      switch (entry && entry.status) {
        case 'available': return '可用';
        case 'disabled': return '不可调用';
        case 'unavailable': return '宿主不可用';
        case 'missing': return '缺失';
        case 'unverified': return '未确认';
        default: return (entry && entry.status) || '未确认';
      }
    }
    function catalogReasonText(reason) {
      return ({
        HOST_SKILLS_UNAVAILABLE: '宿主技能接口不可用',
        SESSION_AGENT_UNAVAILABLE: '会话 Agent 不可用',
        HOST_SKILLS_INCOMPLETE: '宿主技能清单不完整',
        SKILL_TOOL_UNAVAILABLE: '技能调用工具不可用',
        HOST_SKILLS_FAILED: '宿主技能读取失败',
      })[reason] || (reason || '');
    }
    // Renders the real host skill catalog; project scans and config references stay unverified, never faked as host-available.
    function renderSkillCatalog(catalog) {
      if (!catalog || !Array.isArray(catalog.entries)) {
        return h('p', { className: 'as-muted', 'data-skill-catalog': 'absent' }, '宿主技能状态不可用（旧接口或未返回）。技能名仍可自由填写，不硬拦未知名称。');
      }
      const summary = `来源 ${catalog.source || '未知'} · ${catalog.available ? '可发现' : '不可发现'} · ${catalog.complete ? '清单完整' : '清单不完整'} · 技能工具${catalog.toolAvailable ? '可用' : '不可用'}${catalog.reason ? ' · ' + catalogReasonText(catalog.reason) : ''}`;
      return h('div', { className: 'as-skill-catalog', 'data-skill-catalog': catalog.available ? 'available' : 'unavailable' },
        h('p', { className: 'as-muted', 'data-skill-source': catalog.source || '' }, '宿主技能：' + summary),
        catalog.entries.length
          ? h('ul', { className: 'as-skill-list' }, catalog.entries.map((entry, i) => h('li', { key: entry.name || i, 'data-skill-status': entry.status || 'unverified' },
            h('strong', null, entry.name || '(未命名)'),
            h('span', { className: 'as-skill-tag', 'data-status': entry.status || 'unverified' }, skillStatusText(entry)),
            entry.configured ? h('span', { className: 'as-tag' }, '已配置') : null,
            h('small', { className: 'as-muted' }, ' · ' + [entry.source, entry.provider].filter(Boolean).join(' / ') + (entry.origin ? '（' + entry.origin + '）' : '')))))
          : h('p', { className: 'as-muted' }, '宿主当前未返回任何技能。'));
    }
    function Icon() {
      return h('svg', { viewBox: '0 0 20 20', width: 17, height: 17, fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, 'aria-hidden': true },
        h('path', { d: 'M2.5 4h5l2 2h8v10h-15z', strokeLinejoin: 'round' }),
        h('path', { d: 'M6 10h8M6 13h5', strokeLinecap: 'round' }));
    }
    function Button({ children, primary = false, ...props }) {
      return h('button', { type: 'button', ...props, className: 'as-button' + (primary ? ' as-primary' : '') }, children);
    }
    function Entry(props) {
      return h('button', { type: 'button', className: 'as-entry' + (props.wide ? ' as-wide' : ''), title: '项目工作台', 'aria-label': '项目工作台', onClick: () => panel.set(true) }, h(Icon), props.wide || props.header ? h('span', null, '项目工作台') : null);
    }
    function Footer(props) {
      return h(React.Fragment, null, h(Entry, props), h(Overlay));
    }
    function routeName(requested) {
      if (!requested) return null;
      if (requested.provider && requested.model) return requested.provider + '/' + requested.model;
      return requested.provider || requested.model || null;
    }
    function actualText(actual) {
      if (!actual || actual.status !== 'confirmed' || (!actual.provider && !actual.model)) return '未核实（等待宿主返回真实执行证据）';
      return [actual.provider, actual.model, actual.reasoningEffort].filter(Boolean).join(' / ');
    }
    function Task({ task }) {
      const ex = task.execution || null;
      const mode = ex?.mode ?? task.mode;
      const modeLabel = mode ? (mode === 'subagent' ? 'Subagent' : mode === 'teammate' ? 'Teammate' : mode) : null;
      const requestedRoute = ex?.requested || (task.modelRoute ? { provider: task.modelRoute.split('/')[0], model: task.modelRoute.split('/').slice(1).join('/') } : null);
      const requestedLabel = routeName(requestedRoute);
      const isTeam = mode === 'teammate' || ex?.effective?.tool === 'spawn_teammate' || ex?.effective?.routing === 'inherit-parent';
      const actual = ex?.actual;
      const actualConfirmed = actual?.status === 'confirmed';
      const risk = task.risk ?? ex?.risk;
      return h('details', { className: 'as-task' },
        h('summary', null,
          h('span', { className: 'as-status', 'data-status': task.status }, views[task.status] || task.status),
          modeLabel ? h('span', { className: 'as-mode-badge', 'data-mode': mode }, modeLabel) : null,
          h('span', { className: 'as-task-title' }, task.title),
          h('small', null, task.id)),
        h('div', { className: 'as-task-body' },
          task.description ? h('p', null, task.description) : null,
          task.worker ? h('p', { className: 'as-muted' }, '执行 Worker：' + task.worker) : (task.owner ? h('p', { className: 'as-muted' }, '执行者：' + task.owner) : null),
          requestedLabel ? h('p', { className: 'as-muted', 'data-route-kind': 'requested' }, '请求路由：' + requestedLabel) : null,
          isTeam ? h('p', { className: 'as-muted', 'data-route-kind': 'team-inherit' }, 'Team：继承父会话；spawn 等传输 provider 不是 LLM 供应商，成员级模型/推理强度不单独应用') : null,
          actualConfirmed ? h('p', { className: 'as-muted', 'data-route-kind': 'actual' }, '实际：' + actualText(actual)) : h('p', { className: 'as-muted', 'data-route-kind': 'actual-unverified' }, '实际：未核实（等待宿主真实执行证据）'),
          risk ? h('p', { className: 'as-muted' }, '风险：' + (risk === 'low' ? '低风险' : risk === 'high' ? '高风险' : risk)) : null,
          task.dependsOn?.length ? h('p', { className: 'as-muted' }, '依赖：' + task.dependsOn.join('、')) : null,
          task.acceptance?.length ? h('div', null, h('strong', null, '验收要求'), h('ul', null, task.acceptance.map((item, i) => h('li', { key: i }, item)))) : null,
          task.summary ? h('p', null, task.summary) : null,
          task.evidence?.length ? h('div', null, h('strong', null, '执行证据'), h('ul', null, task.evidence.map((item, i) => h('li', { key: i }, item)))) : null,
          task.review ? h('p', null, '验收：' + (task.review.result === 'pass' ? '通过' : '未通过') + ' / ' + task.review.reviewer) : null));
    }
    function Workbench({ sessionId, close, setDirty }) {
      const [project, setProject] = useState(null);
      const [root, setRoot] = useState('');
      const [name, setName] = useState('');
      const [error, setError] = useState('');
      const [notice, setNotice] = useState('');
      const [busy, setBusy] = useState(false);
      const [tab, setTab] = useState('tasks');
      const [filter, setFilter] = useState('all');
      const [feedback, setFeedback] = useState('');
      const [brief, setBrief] = useState('');
      const [revision, setRevision] = useState('');
      const [draftText, setDraftText] = useState('');
      const [config, setConfig] = useState(() => normalizeConfig(null));
      const [configDirty, setConfigDirty] = useState(false);
      const active = useRef(true);
      const requestVersion = useRef(0);
      const briefState = useRef({ value: '', saved: '', edits: 0 });
      const configState = useRef({ value: normalizeConfig(null), saved: JSON.stringify(normalizeConfig(null)), edits: 0 });
      const briefDirty = project && brief !== briefState.current.saved;
      const cliReady = project?.initialized && project.cliCompatibility === 'current';
      useEffect(() => { setDirty(Boolean(briefDirty || feedback.trim() || configDirty)); return () => setDirty(false); }, [briefDirty, feedback, configDirty, setDirty]);
      function accept(next, updateBrief = false, updateRoot = false, updateConfig = false) {
        if (project && next.root !== project.root) setDraftText('');
        const projectChanged = !project || (Boolean(next.root) && next.root !== project.root);
        setProject(next); if (updateRoot) setRoot(next.root); setName(next.name);
        if (updateBrief) {
          briefState.current.value = briefState.current.saved = next.brief || '';
          setBrief(briefState.current.value); setRevision(next.revision || '');
        }
        if (updateConfig || projectChanged) {
          const norm = normalizeConfig(next.config || (next.roles ? next : null));
          configState.current.value = norm;
          configState.current.saved = JSON.stringify(norm);
          configState.current.edits = 0;
          setConfig(norm);
          setConfigDirty(false);
        }
      }
      async function run(action, payload = {}, message = '', updateBrief = false, updateRoot = false, updateConfig = false) {
        const version = ++requestVersion.current;
        setBusy(true); setError(''); setNotice('');
        try {
          const next = await api(action, { sessionId, root: project?.root, ...payload });
          if (!active.current || version !== requestVersion.current) return null;
          accept(next, updateBrief, updateRoot, updateConfig); setNotice(message); return next;
        } catch (e) { if (active.current && version === requestVersion.current) setError(e.message); return null; }
        finally { if (active.current && version === requestVersion.current) setBusy(false); }
      }
      useEffect(() => {
        active.current = true;
        void run('load', {}, '', true, true, true);
        return () => { active.current = false; requestVersion.current++; };
      }, [sessionId]);
      useEffect(() => {
        if (!project?.initialized) return;
        let pending = false;
        const refresh = async () => {
          const isBriefDirty = briefState.current.value !== briefState.current.saved;
          const isConfigDirty = configDirty || JSON.stringify(configState.current.value) !== configState.current.saved;
          if (pending || document.hidden || busy || isBriefDirty) return;
          pending = true;
          const version = ++requestVersion.current;
          const edits = briefState.current.edits;
          const configEdits = configState.current.edits;
          try {
            const next = await api('load', { sessionId, root: project.root });
            if (active.current && version === requestVersion.current) {
              const canUpdateBrief = edits === briefState.current.edits && !isBriefDirty;
              const canUpdateConfig = configEdits === configState.current.edits && !isConfigDirty;
              accept(next, canUpdateBrief, false, canUpdateConfig);
            }
          } catch (e) { if (active.current && version === requestVersion.current) setError(e.message); }
          finally { pending = false; }
        };
        const timer = setInterval(refresh, 5000);
        window.addEventListener('focus', refresh);
        return () => { clearInterval(timer); window.removeEventListener('focus', refresh); };
      }, [sessionId, project?.root, project?.initialized, busy, briefDirty, configDirty]);
      async function openProject(path) {
        if (!path || !active.current) return;
        if (briefState.current.value !== briefState.current.saved || feedback.trim() || configDirty) {
          const confirmFn = typeof window.confirm === 'function' ? window.confirm : globalThis.confirm;
          if (typeof confirmFn !== 'function' || !confirmFn('当前项目还有未保存修改，放弃草稿并打开目录？')) return;
        }
        if (await run('load', { root: path }, '', true, true, true)) setFeedback('');
      }
      async function handleOpen() {
        if (!busy) await openProject(root.trim());
      }
      async function browse() {
        if (busy) return;
        setError(''); setBusy(true);
        try {
          const path = await (globalThis.__DSH_DIRECTORY_PICKER__?.pick ? globalThis.__DSH_DIRECTORY_PICKER__.pick() : ctx.uiWorkspace.pickDirectory());
          await openProject(path);
        } catch (e) { if (active.current) setError(e.message); }
        finally { if (active.current) setBusy(false); }
      }
      function prepare(kind) {
        if (!cliReady) return;
        const text = directive(project, kind, { configDirty });
        setDraftText(text);
        try { prepareDraft(sessionId, text); close(); }
        catch (e) { setError(e.message); }
      }
      async function copy() {
        if (!cliReady) return;
        try { await navigator.clipboard.writeText(draftText || directive(project, 'continue', { configDirty })); setNotice('指令已复制，粘贴到当前会话即可'); }
        catch (e) { setError('复制失败：' + e.message); }
      }
      function updateConfigField(path, value) {
        setConfigDirty(true);
        setConfig(prev => {
          const next = JSON.parse(JSON.stringify(prev));
          let cur = next;
          for (let i = 0; i < path.length - 1; i++) {
            if (!cur[path[i]]) cur[path[i]] = {};
            cur = cur[path[i]];
          }
          cur[path[path.length - 1]] = value;
          configState.current.value = next;
          configState.current.edits++;
          return next;
        });
      }
      const tasks = (project?.tasks || []).filter(task => filter === 'all' || task.status === filter);
      const completed = project?.counts?.done || 0;
      const total = project?.tasks?.length || 0;
      return h(React.Fragment, null,
        h('header', { className: 'as-header' }, h(Icon), h('h2', { id: 'agent-studio-title' }, '项目工作台'), h('span', { className: 'as-muted' }, 'Agent Studio'), h(Button, { onClick: close, 'aria-label': '关闭项目工作台' }, '关闭')),
        h('div', { className: 'as-scroll' },
          h('section', { className: 'as-location' },
            h('label', { htmlFor: 'as-root' }, '项目文件夹'),
            h('div', { className: 'as-row' },
              h('input', { id: 'as-root', value: root, placeholder: '项目文件夹的完整路径', disabled: busy, onChange: e => setRoot(e.target.value) }),
              h(Button, { disabled: busy, onClick: browse }, '选择'),
              h(Button, { disabled: busy || !root.trim(), onClick: handleOpen }, '打开')),
            h('p', { className: 'as-muted' }, '跟随当前会话；也可以打开其他项目。进度保存在项目内，不需要额外启动程序。')),
          error ? h('p', { className: 'as-error', role: 'alert' }, error) : null,
          notice ? h('p', { className: 'as-notice', role: 'status' }, notice) : null,
          busy ? h('p', { className: 'as-muted', role: 'status' }, '正在读取或保存…') : null,
          project && !project.initialized ? h('section', { className: 'as-empty' },
            h('h3', null, '让这个项目可以随时接着做'),
            h('p', null, '启用后，主 Agent 会记录目标、任务和交接。你仍然只在 DSH 里聊需求与验收。'),
            h('label', { htmlFor: 'as-name' }, '项目名'),
            h('input', { id: 'as-name', value: name, onChange: e => setName(e.target.value), disabled: busy }),
            h(Button, { primary: true, disabled: busy || !name.trim(), onClick: () => run('init', { root: project.root, name }, '已启用。点击「开始 / 继续项目」准备指令，再发送给主 Agent。', true, true, true) }, '在此项目启用'),
            h('small', { className: 'as-muted' }, '将创建 .studio、项目协作技能，并向项目规则追加入口；不覆盖原有规则，不修改全局 Agent 设置。')) : null,
          project?.initialized ? h(React.Fragment, null,
            h('section', { className: 'as-project' },
              h('div', { className: 'as-row' }, h('h3', null, project.name), h('span', { className: 'as-status', 'data-status': project.paused ? 'todo' : 'in_progress' }, project.paused ? '已暂停派工' : '协作已启用')),
              !cliReady ? h('p', { className: 'as-error', role: 'alert' }, '项目命令尚未升级或无法验证，现无法安全继续。请使用安装版 upgrade；如有定制或异常，请联系主 Agent 处理，勿覆盖已有文件。') : null,
              h('div', { className: 'as-progress-label' }, h('span', null, completed + ' / ' + total + ' 项已验收'), h('span', { className: 'as-muted' }, '进行中 ' + (project.counts?.in_progress || 0) + ' · 待验收 ' + (project.counts?.review || 0))),
              h('progress', { value: completed, max: Math.max(total, 1), 'aria-label': '已验收任务进度' }),
              h('div', { className: 'as-row' },
                h(Button, { primary: true, disabled: busy || !cliReady, onClick: () => prepare('continue') }, '开始 / 继续项目'),
                h(Button, { disabled: busy || briefDirty, onClick: () => run('load', {}, '进度已刷新', true) }, '刷新进度'),
                h(Button, { disabled: busy || !cliReady, onClick: () => prepare('pause') }, '交接并暂停'))),
            h('nav', { className: 'as-tabs', 'aria-label': '项目内容' }, [['tasks', '任务'], ['brief', '项目简报'], ['feedback', '反馈与交接'], ['roles', '角色与路由']].map(([id, label]) => h('button', { type: 'button', key: id, 'aria-pressed': tab === id, onClick: () => setTab(id) }, label))),
            tab === 'tasks' ? h('section', { className: 'as-tasks', 'aria-label': '项目任务' },
              h('div', { className: 'as-filters' }, ['all', ...Object.keys(views)].map(id => h('button', { type: 'button', key: id, 'aria-pressed': filter === id, onClick: () => setFilter(id) }, id === 'all' ? '全部' : views[id] + ' ' + (project.counts?.[id] || 0)))),
              tasks.length ? tasks.map(task => h(Task, { key: task.id, task })) : h('p', { className: 'as-muted as-padding' }, total ? '这个状态下没有任务。' : '还没有任务。点击「开始 / 继续项目」，先和主 Agent 确定目标，再由它规划和分派。')) : null,
            tab === 'brief' ? h('section', { className: 'as-form' },
              h('label', { htmlFor: 'as-brief' }, '项目目标、版本范围与决策'),
              h('textarea', { id: 'as-brief', value: brief, rows: 13, onChange: e => { briefState.current.value = e.target.value; briefState.current.edits++; setBrief(e.target.value); }, disabled: busy }),
              h('div', { className: 'as-row' },
                h(Button, { primary: true, disabled: busy || !cliReady || !briefDirty || !brief.trim(), onClick: () => run('brief', { brief, revision }, '项目简报已保存', true) }, '保存简报'),
                h('small', { className: 'as-muted' }, briefDirty ? '有未保存的修改；后台刷新不会覆盖。' : '与主 Agent 共用同一份项目简报。'))) : null,
            tab === 'feedback' ? h('section', { className: 'as-form' },
              h('label', { htmlFor: 'as-feedback' }, '新增修改意见'),
              h('textarea', { id: 'as-feedback', value: feedback, rows: 3, placeholder: '哪里要改，哪些已有功能必须保留…', onChange: e => setFeedback(e.target.value), disabled: busy }),
              h(Button, { disabled: busy || !feedback.trim(), onClick: async () => { const next = await run('feedback', { text: feedback }, '反馈已记入账本。开始 / 继续项目后由主 Agent 处理。'); if (next) setFeedback(''); } }, '记录反馈'),
              h('h4', null, '待处理反馈'),
              project.feedback?.some(item => !item.resolved) ? h('ul', { className: 'as-feedback-list' }, project.feedback.filter(item => !item.resolved).map(item => h('li', { key: item.id }, item.text))) : h('p', { className: 'as-muted' }, '没有待处理反馈。'),
              h('h4', null, '最近交接'), h('p', { className: 'as-handoff' }, project.handoff?.note || '还没有交接记录。'),
              h('small', { className: 'as-muted' }, '「交接并暂停」会准备给主 Agent 的指令，由它先处理实际 worker，再保存交接；这里不会假装停止后台进程。')) : null,
            tab === 'roles' ? h('section', { className: 'as-form', 'aria-label': '角色与路由配置' },
              h('div', { className: 'as-card' },
                h('h4', null, '全局调度参数'),
                h('div', { className: 'as-row', style: { gap: '16px', marginTop: '6px' } },
                  h('div', { className: 'as-field' },
                    h('label', { htmlFor: 'as-concurrency' }, '并发任务数 (concurrency)'),
                    h('input', { id: 'as-concurrency', type: 'number', min: 1, max: 16, value: config.concurrency ?? 2, disabled: busy, onChange: e => updateConfigField(['concurrency'], e.target.value === '' ? '' : Number(e.target.value) || 1) })),
                  h('label', { className: 'as-row', style: { cursor: 'pointer', userSelect: 'none', marginTop: '16px' } },
                    h('input', { id: 'as-fast-track', type: 'checkbox', checked: Boolean(config.fastTrackLowRisk), disabled: busy, onChange: e => updateConfigField(['fastTrackLowRisk'], e.target.checked) }),
                    h('span', null, '低风险任务快速通道（免独立验收）')))),
              h('div', { className: 'as-card' },
                h('div', { className: 'as-row' }, h('h4', null, '主控指挥官 (director)'), h('span', { className: 'as-tag' }, 'main 模式')),
                h('p', { className: 'as-muted' }, '主控零开发，负责全局决策、账本记录与任务委派。'),
                h('div', { className: 'as-grid' },
                  h('div', { className: 'as-field' }, h('label', { htmlFor: 'as-director-provider' }, 'Provider'), h('input', { id: 'as-director-provider', value: config.roles?.director?.provider || 'main', readOnly: true, disabled: true })),
                  h('div', { className: 'as-field' }, h('label', { htmlFor: 'as-director-model' }, 'Model'), h('input', { id: 'as-director-model', value: config.roles?.director?.model || 'current', readOnly: true, disabled: true })),
                  h('div', { className: 'as-field' }, h('label', { htmlFor: 'as-director-effort' }, 'Reasoning Effort'), h('input', { id: 'as-director-effort', value: config.roles?.director?.reasoningEffort || 'default', readOnly: true, disabled: true })))),
              h('div', { className: 'as-card' },
                h('div', { className: 'as-row' }, h('h4', null, '执行工程师 (engineer)'), h('span', { className: 'as-tag' }, 'subagent 模式')),
                h('p', { className: 'as-muted' }, '负责具体功能实现与排障，按路由分配对应的模型与技能。'),
                h('div', { className: 'as-route-block' },
                  h('h5', null, 'Coding 路由（日常开发）'),
                  h('div', { className: 'as-grid' },
                    h('div', { className: 'as-field' }, h('label', { htmlFor: 'as-route-coding-provider' }, 'Provider'), h('input', { id: 'as-route-coding-provider', value: config.roles?.engineer?.routes?.coding?.provider || '', disabled: busy, onChange: e => updateConfigField(['roles', 'engineer', 'routes', 'coding', 'provider'], e.target.value) })),
                    h('div', { className: 'as-field' }, h('label', { htmlFor: 'as-route-coding-model' }, 'Model'), h('input', { id: 'as-route-coding-model', value: config.roles?.engineer?.routes?.coding?.model || '', disabled: busy, onChange: e => updateConfigField(['roles', 'engineer', 'routes', 'coding', 'model'], e.target.value) })),
                    h('div', { className: 'as-field' }, h('label', { htmlFor: 'as-route-coding-effort' }, 'Reasoning Effort'), h('input', { id: 'as-route-coding-effort', value: config.roles?.engineer?.routes?.coding?.reasoningEffort || '', disabled: busy, onChange: e => updateConfigField(['roles', 'engineer', 'routes', 'coding', 'reasoningEffort'], e.target.value) })),
                    h('div', { className: 'as-field' }, h('label', { htmlFor: 'as-route-coding-skills' }, 'Skills (逗号分隔)'), h('input', { id: 'as-route-coding-skills', value: Array.isArray(config.roles?.engineer?.routes?.coding?.skills) ? config.roles.engineer.routes.coding.skills.join(', ') : (config.roles?.engineer?.routes?.coding?.skills ?? ''), disabled: busy, onChange: e => updateConfigField(['roles', 'engineer', 'routes', 'coding', 'skills'], e.target.value) })))),
                h('div', { className: 'as-route-block' },
                  h('h5', null, 'Debug 路由（复杂排障）'),
                  h('div', { className: 'as-grid' },
                    h('div', { className: 'as-field' }, h('label', { htmlFor: 'as-route-debug-provider' }, 'Provider'), h('input', { id: 'as-route-debug-provider', value: config.roles?.engineer?.routes?.debug?.provider || '', disabled: busy, onChange: e => updateConfigField(['roles', 'engineer', 'routes', 'debug', 'provider'], e.target.value) })),
                    h('div', { className: 'as-field' }, h('label', { htmlFor: 'as-route-debug-model' }, 'Model'), h('input', { id: 'as-route-debug-model', value: config.roles?.engineer?.routes?.debug?.model || '', disabled: busy, onChange: e => updateConfigField(['roles', 'engineer', 'routes', 'debug', 'model'], e.target.value) })),
                    h('div', { className: 'as-field' }, h('label', { htmlFor: 'as-route-debug-effort' }, 'Reasoning Effort'), h('input', { id: 'as-route-debug-effort', value: config.roles?.engineer?.routes?.debug?.reasoningEffort || '', disabled: busy, onChange: e => updateConfigField(['roles', 'engineer', 'routes', 'debug', 'reasoningEffort'], e.target.value) })),
                    h('div', { className: 'as-field' }, h('label', { htmlFor: 'as-route-debug-skills' }, 'Skills (逗号分隔)'), h('input', { id: 'as-route-debug-skills', value: Array.isArray(config.roles?.engineer?.routes?.debug?.skills) ? config.roles.engineer.routes.debug.skills.join(', ') : (config.roles?.engineer?.routes?.debug?.skills ?? ''), disabled: busy, onChange: e => updateConfigField(['roles', 'engineer', 'routes', 'debug', 'skills'], e.target.value) })))),
                h('div', { className: 'as-route-block' },
                  h('h5', null, 'Visual 路由（界面视觉）'),
                  h('div', { className: 'as-grid' },
                    h('div', { className: 'as-field' }, h('label', { htmlFor: 'as-route-visual-provider' }, 'Provider'), h('input', { id: 'as-route-visual-provider', value: config.roles?.engineer?.routes?.visual?.provider || '', disabled: busy, onChange: e => updateConfigField(['roles', 'engineer', 'routes', 'visual', 'provider'], e.target.value) })),
                    h('div', { className: 'as-field' }, h('label', { htmlFor: 'as-route-visual-model' }, 'Model'), h('input', { id: 'as-route-visual-model', value: config.roles?.engineer?.routes?.visual?.model || '', disabled: busy, onChange: e => updateConfigField(['roles', 'engineer', 'routes', 'visual', 'model'], e.target.value) })),
                    h('div', { className: 'as-field' }, h('label', { htmlFor: 'as-route-visual-effort' }, 'Reasoning Effort'), h('input', { id: 'as-route-visual-effort', value: config.roles?.engineer?.routes?.visual?.reasoningEffort || '', disabled: busy, onChange: e => updateConfigField(['roles', 'engineer', 'routes', 'visual', 'reasoningEffort'], e.target.value) })),
                    h('div', { className: 'as-field' }, h('label', { htmlFor: 'as-route-visual-skills' }, 'Skills (逗号分隔)'), h('input', { id: 'as-route-visual-skills', value: Array.isArray(config.roles?.engineer?.routes?.visual?.skills) ? config.roles.engineer.routes.visual.skills.join(', ') : (config.roles?.engineer?.routes?.visual?.skills ?? ''), disabled: busy, onChange: e => updateConfigField(['roles', 'engineer', 'routes', 'visual', 'skills'], e.target.value) }))))),
              h('div', { className: 'as-card' },
                h('div', { className: 'as-row' }, h('h4', null, '独立验收者 (reviewer)'), h('span', { className: 'as-tag' }, 'subagent 模式')),
                h('p', { className: 'as-muted' }, '独立运行验收命令、比对证据，worker 标识必须与实现者互斥。'),
                h('div', { className: 'as-grid' },
                  h('div', { className: 'as-field' }, h('label', { htmlFor: 'as-route-reviewer-provider' }, 'Provider'), h('input', { id: 'as-route-reviewer-provider', value: config.roles?.reviewer?.provider || '', disabled: busy, onChange: e => updateConfigField(['roles', 'reviewer', 'provider'], e.target.value) })),
                  h('div', { className: 'as-field' }, h('label', { htmlFor: 'as-route-reviewer-model' }, 'Model'), h('input', { id: 'as-route-reviewer-model', value: config.roles?.reviewer?.model || '', disabled: busy, onChange: e => updateConfigField(['roles', 'reviewer', 'model'], e.target.value) })),
                  h('div', { className: 'as-field' }, h('label', { htmlFor: 'as-route-reviewer-effort' }, 'Reasoning Effort'), h('input', { id: 'as-route-reviewer-effort', value: config.roles?.reviewer?.reasoningEffort || '', disabled: busy, onChange: e => updateConfigField(['roles', 'reviewer', 'reasoningEffort'], e.target.value) })),
                  h('div', { className: 'as-field' }, h('label', { htmlFor: 'as-route-reviewer-skills' }, 'Skills (逗号分隔)'), h('input', { id: 'as-route-reviewer-skills', value: Array.isArray(config.roles?.reviewer?.skills) ? config.roles.reviewer.skills.join(', ') : (config.roles?.reviewer?.skills ?? ''), disabled: busy, onChange: e => updateConfigField(['roles', 'reviewer', 'skills'], e.target.value) })))),
              h('div', { className: 'as-card' },
                h('div', { className: 'as-row' }, h('h4', null, '宿主技能状态'), h('span', { className: 'as-tag' }, '真实来源')),
                h('p', { className: 'as-muted' }, '展示宿主实际能识别的技能；项目扫描或配置引用只算未确认，不冒充宿主可用。未知技能名仍可自由填写，不会被硬拦。'),
                renderSkillCatalog(project.skillCatalog)),
              h('div', { className: 'as-row', style: { marginTop: '14px', gap: '8px' } },
                h(Button, { primary: true, disabled: busy || !cliReady, onClick: () => run('config', { config: toPayloadConfig(config) }, '配置已保存', false, false, true) }, '保存配置'),
                h(Button, { disabled: busy || !cliReady, onClick: () => run('reset-config', {}, '配置已恢复默认', false, false, true) }, '恢复默认'),
                h('small', { className: 'as-muted' }, configDirty ? '配置有未保存修改；后台刷新不会覆盖。' : '派工与模型路由配置保存在项目内。'))) : null,
            draftText ? h('section', { className: 'as-form' }, h('label', { htmlFor: 'as-directive' }, '给主 Agent 的指令'), h('textarea', { id: 'as-directive', rows: 6, readOnly: true, value: cliReady ? draftText : '项目命令尚未升级或无法验证，请先处理后再准备指令。' }), h(Button, { disabled: !cliReady, onClick: copy }, '复制指令')) : null) : null),
        h('footer', { className: 'as-footer' }, h('small', { className: 'as-muted' }, '任务由 DSH 原生 Agent 执行。关闭工作台不停止任务。'), project?.initialized ? h(Button, { disabled: !cliReady, onClick: copy }, '复制继续指令') : null));
    }
    function Overlay() {
      const open = useSyncExternalStore(panel.subscribe, panel.snapshot, panel.snapshot);
      const sessionId = useSessionId();
      const ref = useRef(null);
      const opener = useRef(null);
      const [dirty, setDirty] = useState(false);
      function close() { if (!dirty || (typeof window.confirm === 'function' ? window.confirm('简报、反馈或配置尚未保存，放弃修改并关闭？') : false)) panel.set(false); }
      useEffect(() => {
        const dialog = ref.current;
        if (!dialog || !open) return;
        opener.current = document.activeElement;
        dialog.showModal();
        return () => { dialog.close(); opener.current?.focus?.(); };
      }, [open]);
      return h('dialog', { className: 'as-dialog', ref, 'aria-labelledby': 'agent-studio-title', onCancel: event => { event.preventDefault(); close(); }, onClose: () => { if (opened) close(); } },
        open ? sessionId ? h(Workbench, { key: sessionId, sessionId, close, setDirty }) : h('section', { className: 'as-empty' }, h('h2', { id: 'agent-studio-title' }, '项目工作台'), h('p', null, '先打开一个 DSH 会话，再启用该项目的协作。'), h(Button, { onClick: close }, '关闭')) : null);
    }
    const css = `
.as-entry{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:28px;padding:4px 7px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary,#666);font:inherit;font-size:12px;cursor:pointer;white-space:nowrap}.as-entry.as-wide{justify-content:flex-start;width:100%}.as-entry:hover{background:var(--dsw-alias-interactive-bg-hover,#eee)}
.as-dialog{--as-bg:rgb(from var(--dsw-alias-bg-layer-1,#fff) r g b / 1);--as-text:var(--dsw-alias-label-primary,#222);--as-muted:var(--dsw-alias-label-tertiary,#777);--as-line:var(--dsw-alias-border-l2,#ddd);--as-accent:var(--dsw-alias-state-business-primary,#4d6bfe);box-sizing:border-box;width:780px;max-width:calc(100vw - 32px);height:720px;max-height:calc(100dvh - 40px);padding:0;border:1px solid var(--as-line);border-radius:12px;background:var(--as-bg);color:var(--as-text);font-family:inherit;font-size:13px;line-height:1.65;box-shadow:0 16px 60px #0003;overflow:hidden}.as-dialog[open]{display:flex;flex-direction:column}.as-dialog::backdrop{background:#0004}.as-dialog *{box-sizing:border-box}.as-dialog h2,.as-dialog h3,.as-dialog h4,.as-dialog p{margin:0}.as-dialog h2{font-size:16px;font-weight:650}.as-dialog h3{font-size:20px;font-weight:650;letter-spacing:-.3px}.as-dialog h4{font-size:13px;font-weight:600;margin-top:10px}.as-header{display:flex;align-items:center;gap:9px;flex:none;padding:16px 22px;border-bottom:1px solid var(--as-line)}.as-header>.as-button{margin-left:auto}.as-muted{color:var(--as-muted,var(--dsw-alias-label-tertiary,#777));font-size:12px}.as-scroll{flex:1;min-height:0;overflow:auto;overscroll-behavior:contain}.as-location{display:flex;flex-direction:column;gap:7px;padding:18px 22px;border-bottom:1px solid var(--as-line)}.as-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.as-row>input{flex:1;min-width:160px}.as-button{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:32px;border:1px solid var(--as-line);border-radius:7px;padding:5px 11px;background:transparent;color:inherit;font:inherit;font-size:12px;cursor:pointer;white-space:nowrap}.as-button:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,#eee)}.as-button.as-primary{background:var(--as-accent);border-color:var(--as-accent);color:#fff}.as-button.as-primary:hover:not(:disabled){filter:brightness(1.08);background:var(--as-accent)}.as-button:disabled{opacity:.45;cursor:not-allowed}.as-error{color:var(--dsw-alias-state-error,#f43f5e);font-size:12px}.as-notice{color:var(--dsw-alias-state-success,#10b981);font-size:12px}.as-empty{display:flex;flex-direction:column;gap:12px;padding:32px 24px;text-align:center;align-items:center}.as-empty>input{max-width:320px;width:100%}.as-project{display:flex;flex-direction:column;gap:10px;padding:18px 22px;border-bottom:1px solid var(--as-line)}.as-progress-label{display:flex;justify-content:space-between;font-size:12px}.as-tabs{display:flex;gap:4px;padding:0 22px;border-bottom:1px solid var(--as-line);background:var(--dsw-alias-bg-layer-2,rgba(0,0,0,.02))}.as-tabs>button{border:0;background:transparent;padding:10px 14px;font:inherit;font-size:13px;cursor:pointer;border-bottom:2px solid transparent;color:var(--as-muted)}.as-tabs>button[aria-pressed=true]{color:var(--as-accent);border-bottom-color:var(--as-accent);font-weight:600}.as-tasks{display:flex;flex-direction:column}.as-filters{display:flex;gap:6px;padding:12px 22px;overflow-x:auto}.as-filters>button{border:1px solid var(--as-line);background:transparent;padding:3px 9px;border-radius:14px;font:inherit;font-size:12px;cursor:pointer;color:var(--as-muted);white-space:nowrap}.as-filters>button[aria-pressed=true]{background:var(--as-accent);border-color:var(--as-accent);color:#fff}.as-task{margin:0 22px;border-bottom:1px solid var(--as-line);padding:10px 0}.as-task summary{display:flex;align-items:center;gap:8px;cursor:pointer;list-style:none}.as-task summary::-webkit-details-marker{display:none}.as-task-title{flex:1;font-weight:550}.as-status{display:inline-block;padding:2px 7px;border-radius:10px;font-size:11px;font-weight:600;background:#8882;color:inherit}.as-status[data-status=in_progress]{background:#3b82f622;color:#3b82f6}.as-status[data-status=review]{background:#f59e0b22;color:#f59e0b}.as-status[data-status=done]{background:#10b98122;color:#10b981}.as-mode-badge{display:inline-block;padding:1px 6px;border-radius:4px;font-size:11px;font-weight:600;background:var(--dsw-alias-fill-quaternary,#eef2ff);color:var(--as-accent,#4d6bfe)}.as-task-body{padding:10px 0 6px 0;display:flex;flex-direction:column;gap:6px;font-size:12px}.as-task-body ul{margin:0;padding-left:18px}.as-form{display:flex;flex-direction:column;gap:10px;padding:18px 22px}.as-form textarea{width:100%;font:inherit;padding:8px 10px;border:1px solid var(--as-line);border-radius:7px;background:transparent;color:inherit;resize:vertical}.as-feedback-list{margin:0;padding-left:18px}.as-handoff{background:var(--dsw-alias-bg-layer-2,rgba(0,0,0,.02));padding:10px;border-radius:7px;border:1px solid var(--as-line);font-size:12px;white-space:pre-wrap}.as-footer{display:flex;align-items:center;gap:12px;padding:12px 22px;border-top:1px solid var(--as-line);margin-top:auto}.as-footer>.as-button{margin-left:auto}.as-padding{padding:24px;text-align:center}input{font:inherit;padding:6px 10px;border:1px solid var(--as-line);border-radius:7px;background:transparent;color:inherit}
.as-card{border:1px solid var(--as-line);border-radius:8px;padding:12px 14px;background:var(--dsw-alias-bg-layer-2,rgba(0,0,0,.02));display:flex;flex-direction:column;gap:8px}
.as-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;margin-top:4px}
.as-field{display:flex;flex-direction:column;gap:3px}
.as-field label{font-size:11px;color:var(--as-muted)}
.as-field input{padding:5px 8px;font-size:12px}
.as-tag{display:inline-block;padding:1px 6px;border-radius:4px;font-size:11px;background:var(--dsw-alias-fill-quaternary,#eef2ff);color:var(--as-accent,#4d6bfe);font-weight:600}
.as-route-block{border-top:1px dashed var(--as-line);padding-top:8px;margin-top:4px}
.as-route-block h5{margin:0 0 4px 0;font-size:12px;font-weight:600}
.as-skill-catalog{display:flex;flex-direction:column;gap:5px;margin-top:2px}
.as-skill-list{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:4px}
.as-skill-list li{display:flex;align-items:center;gap:6px;flex-wrap:wrap;font-size:12px}
.as-skill-tag{display:inline-block;padding:0 5px;border-radius:4px;font-size:10px;line-height:1.7;background:var(--dsw-alias-fill-quaternary,#eef2ff);color:var(--as-muted)}
.as-skill-tag[data-status="available"]{background:#e6f6ec;color:#1a7f45}
.as-skill-tag[data-status="disabled"],.as-skill-tag[data-status="unavailable"],.as-skill-tag[data-status="missing"]{background:#fdeaea;color:#b23b3b}
.as-skill-tag[data-status="unverified"]{background:#fff3e0;color:#a86b12}
@media(max-width:560px){.as-dialog{max-width:calc(100vw - 12px);max-height:calc(100dvh - 12px)}.as-header,.as-location,.as-project,.as-form{padding:14px}.as-header>.as-muted{display:none}.as-tabs{padding:0 14px}.as-task{margin:0 14px}.as-task-body{padding-left:0}.as-task small{display:none}.as-footer{padding:10px 14px;flex-wrap:wrap}.as-filters{padding:12px 14px}.as-progress-label{gap:4px}}
`;
    function apply(context) {
      ctx = context;
      ctx.effect(() => {
        const style = document.createElement('style'); style.dataset.agentStudio = 'true'; style.textContent = css; document.head.append(style);
        return () => { style.remove(); panel.set(false); };
      }, 'agent-studio: styles');
      ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({ name: 'conversation.session.header.actions', id: 'agent-studio-header', order: 40, inject: () => ({ header: true }) }, Entry));
      ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({ name: 'sidebar.footer.action', id: 'agent-studio-footer', order: 28 }, Footer));
    }
    return { name: 'dsh-agent-studio', inject: ['slots', 'sessions', 'uiWorkspace'], apply };
  },
});
