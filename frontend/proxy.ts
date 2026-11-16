import {NextRequest, NextResponse} from 'next/server';
import {createHmac, timingSafeEqual} from 'node:crypto';

/**
 * 中枢账号门禁（工作台侧）。
 * AS 应用入口会先校验 asContext 并写入 HttpOnly 会话；4173 不信任客户端自报身份，
 * 只接受 AS 入口签发的带 HMAC 会话，确认后才允许页面和 /api 进入，并给上游 4191 加内部头。
 */
const internal = process.env.AS_GATE_INTERNAL || '';

function validSession(cookieHeader: string) {
  const part = cookieHeader.split(';').map((item) => item.trim()).find((item) => item.startsWith('jg_as_gate='));
  if (!part) return false;
  const value = decodeURIComponent(part.slice('jg_as_gate='.length));
  const dot = value.lastIndexOf('.');
  if (dot <= 0) return false;
  const token = value.slice(0, dot);
  const supplied = value.slice(dot + 1);
  const expected = createHmac('sha256', internal).update(token).digest('hex');
  return supplied.length === expected.length && timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
}

function deny(message: string) {
  return new NextResponse(
    `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>需要中枢账号</title><body style="font-family:system-ui,sans-serif;background:#f7f8fa;color:#1f2328;padding:48px"><h2>需要中枢账号</h2><p>${message}</p></body></html>`,
    {status: 401, headers: {'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store'}},
  );
}

export default function proxy(request: NextRequest) {
  if (!internal) return NextResponse.next();
  const pathname = request.nextUrl.pathname;
  if (pathname.startsWith('/_next/') || pathname === '/favicon.ico') return NextResponse.next();
  if (!validSession(request.headers.get('cookie') || '')) {
    return deny('请从智能中枢的应用入口打开本应用；直接访问工作台端口没有中枢账号上下文。');
  }
  const headers = new Headers(request.headers);
  headers.set('x-as-gate', internal);
  return NextResponse.next({request: {headers}});
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
