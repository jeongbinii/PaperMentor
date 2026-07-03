import { createBrowserClient } from "@supabase/ssr";

// 브라우저(클라이언트 컴포넌트)용 Supabase 클라이언트.
// anon 키는 공개돼도 안전한 값 — 실제 데이터 보호는 행 수준 보안(RLS)이 담당한다.
// 그래서 NEXT_PUBLIC_ 접두사로 브라우저에 노출해도 된다.
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
