import { NextRequest, NextResponse } from "next/server";

// 사이트 전체에 HTTP Basic 인증 게이트를 건다.
// 비밀번호는 환경변수(SITE_AUTH_USER / SITE_AUTH_PASS)로만 설정 — 코드에 노출하지 않는다.
// SITE_AUTH_PASS 가 비어 있으면 게이트는 비활성(누구나 접근). 공개 전환은 환경변수만 지우면 됨.
export const config = {
  // 정적 자산(_next)·favicon 은 제외하고 페이지·API 전체를 보호
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

export function middleware(req: NextRequest) {
  const USER = process.env.SITE_AUTH_USER || "papermentor";
  const PASS = process.env.SITE_AUTH_PASS;

  // 비밀번호 미설정 시 게이트 끔 (잠금 사고 방지 + 공개 전환 스위치)
  if (!PASS) return NextResponse.next();

  const header = req.headers.get("authorization");
  if (header?.startsWith("Basic ")) {
    const decoded = atob(header.slice(6));
    const idx = decoded.indexOf(":");
    const user = decoded.slice(0, idx);
    const pwd = decoded.slice(idx + 1);
    if (user === USER && pwd === PASS) {
      return NextResponse.next();
    }
  }

  return new NextResponse("Authentication required.", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="PaperMentor", charset="UTF-8"' },
  });
}
