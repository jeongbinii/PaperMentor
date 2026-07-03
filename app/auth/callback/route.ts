import { NextResponse } from "next/server";
import { createClient } from "@/app/lib/supabase/server";

// 구글 OAuth 후 리다이렉트되는 콜백.
// 인증 코드(?code=)를 세션으로 교환하고 원래 가려던 곳(next)이나 홈으로 보낸다.
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");

  // 오픈 리다이렉트 방지: next 는 앱 내부 경로("/…")만 허용.
  // "//evil.com"·"/\evil.com" 같은 프로토콜-상대 형태는 외부로 튈 수 있어 차단.
  const nextParam = searchParams.get("next") ?? "/";
  const next =
    nextParam.startsWith("/") &&
    !nextParam.startsWith("//") &&
    !nextParam.startsWith("/\\")
      ? nextParam
      : "/";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  // 코드가 없거나 교환 실패 → 로그인 페이지로 에러 표시
  return NextResponse.redirect(`${origin}/login?error=auth`);
}
