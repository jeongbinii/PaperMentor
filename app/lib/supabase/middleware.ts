import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// 매 요청마다 Supabase 로그인 세션(인증 쿠키)을 갱신한다. @supabase/ssr 표준 패턴.
// 미들웨어에서 이걸 호출하지 않으면 서버 측에서 세션이 만료된 것처럼 보일 수 있다.
export async function updateSession(
  request: NextRequest,
): Promise<NextResponse> {
  // Supabase 환경변수가 없으면(예: 아직 Vercel에 미등록) 아무것도 하지 않고 통과 — 사이트가 죽지 않도록.
  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  ) {
    return NextResponse.next({ request });
  }

  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // getUser()를 호출해야 만료 임박 토큰이 실제로 갱신된다(getSession()이 아니라 getUser()).
  await supabase.auth.getUser();

  return supabaseResponse;
}
