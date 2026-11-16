import { createStudioApi, fail } from './core.js';

export const name = 'dsh-agent-studio';
export const inject = ['webServer', 'sessions'];
const maxBody = 128 * 1024;
const loopback = value => typeof value === 'string' && /^(?:127(?:\.\d{1,3}){3}|::1|::ffff:127(?:\.\d{1,3}){3})$/i.test(value);

function sameOrigin(req) {
  if (!loopback(req.socket?.remoteAddress)) return false;
  if (['cross-site', 'same-site'].includes(req.headers['sec-fetch-site'])) return false;
  if (!/^(?:localhost|127(?:\.\d{1,3}){3}|\[::1\])(?::\d+)?$/i.test(req.headers.host ?? '')) return false;
  try {
    const expected = new URL(`${req.socket.encrypted ? 'https' : 'http'}://${req.headers.host}`).origin;
    return !req.headers.origin || new URL(req.headers.origin).origin === expected;
  } catch { return false; }
}

function send(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

async function readBody(req) {
  if (Number(req.headers['content-length']) > maxBody) {
    req.resume();
    throw fail('请求超过 128 KiB', 413, 'BODY_TOO_LARGE');
  }
  const chunks = [];
  let size = 0;
  for await (const value of req.iterator({ destroyOnReturn: false })) {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
    size += chunk.length;
    if (size > maxBody) {
      req.resume();
      throw fail('请求超过 128 KiB', 413, 'BODY_TOO_LARGE');
    }
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw fail('请求不是有效 JSON', 400, 'INVALID_JSON'); }
}

export function apply(ctx) {
  let hostContext;
  // This Cordis version has required-only inject maps; keep host discovery optional via a child fiber.
  ctx.inject(['skills', 'agents', 'tools', 'workingDirectory'], host => {
    hostContext = host;
    return () => { hostContext = undefined; };
  });
  const api = createStudioApi(ctx, { host: () => hostContext });
  return ctx.effect(() => {
    const disposers = [];
    for (const [route, method] of [
      ['/agent-studio/api/project', 'GET'],
      ['/agent-studio/api/action', 'POST'],
    ]) {
      disposers.push(ctx.webServer.register({ kind: 'exact', path: route, handler: async (req, res) => {
        try {
          if (!sameOrigin(req)) throw fail('只允许本机当前 DSH 页面调用', 403, 'FORBIDDEN_ORIGIN');
          if (req.method !== method) throw fail('请求方法不支持', 405, 'METHOD_NOT_ALLOWED');
          let project;
          if (method === 'GET') {
            const query = new URL(req.url, 'http://localhost').searchParams;
            if (query.getAll('sessionId').length !== 1 || query.has('root')) throw fail('GET 只接受一个 sessionId，显式 root 请使用 POST load');
            project = await api.project(query.get('sessionId'));
          } else {
            if (!/^application\/json(?:\s*;|$)/i.test((req.headers['content-type'] ?? '').trim())) throw fail('需要 application/json 请求', 415, 'UNSUPPORTED_MEDIA_TYPE');
            project = await api.action(await readBody(req));
          }
          send(res, 200, { ok: true, project });
        } catch (error) {
          send(res, error.status ?? 500, {
            ok: false, error: error.message || '项目操作失败', code: error.code || 'INTERNAL_ERROR',
            ...(error.revision ? { revision: error.revision } : {}),
          });
        }
      } }));
    }
    return () => { for (const dispose of disposers) if (typeof dispose === 'function') dispose(); };
  }, 'agent-studio:routes');
}
