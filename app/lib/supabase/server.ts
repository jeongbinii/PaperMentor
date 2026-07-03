import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

// 서버(서버 컴포넌트·라우트 핸들러·서버 액션)용 Supabase 클라이언트.
// Next.js 쿠키 저장소와 연결해 로그인 세션을 읽고 갱신한다.
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // 서버 컴포넌트에서 호출되면 set이 막힐 수 있음 —
            // 세션 갱신은 미들웨어가 담당하므로 여기서는 무시해도 안전.
          }
        },
      },
    },
  );
}
