import { NextRequest, NextResponse } from "next/server";
import { updateSession } from "@/app/lib/supabase/middleware";

// 정적 자산(_next)·favicon 은 제외하고 페이지·API 전체를 처리
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

export async function middleware(req: NextRequest) {
  // 0) 인증 콜백/로그아웃은 베타 게이트를 건너뛴다.
  //    구글에서 돌아오는 /auth/callback 리다이렉트엔 Basic 인증 헤더가 실리지 않아
  //    게이트가 막으면 로그인이 완성되지 못한다(401). 이 경로들은 세션 갱신만 태운다.
  if (req.nextUrl.pathname.startsWith("/auth/")) {
    return await updateSession(req);
  }

  // 1) 베타 접근 게이트 (HTTP Basic) — SITE_AUTH_PASS 설정 시에만 동작.
  //    비밀번호 미설정 시 게이트 끔(공개 전환 스위치). 공개 후 실제 로그인만 쓰려면 이 env를 지우면 됨.
  const USER = process.env.SITE_AUTH_USER || "papermentor";
  const PASS = process.env.SITE_AUTH_PASS;
  if (PASS) {
    const header = req.headers.get("authorization");
    let ok = false;
    if (header?.startsWith("Basic ")) {
      const decoded = atob(header.slice(6));
      const idx = decoded.indexOf(":");
      const user = decoded.slice(0, idx);
      const pwd = decoded.slice(idx + 1);
      if (user === USER && pwd === PASS) ok = true;
    }
    if (!ok) {
      return new NextResponse("Authentication required.", {
        status: 401,
        headers: {
          "WWW-Authenticate": 'Basic realm="PaperMentor", charset="UTF-8"',
        },
      });
    }
  }

  // 2) 베타 게이트 통과 후 Supabase 로그인 세션 갱신
  return await updateSession(req);
}
