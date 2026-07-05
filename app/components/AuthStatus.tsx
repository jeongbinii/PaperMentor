"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/app/lib/supabase/client";

// 헤더 로그인 상태: 로그인 전 → "로그인" 버튼 / 로그인 후 → 이메일 + 로그아웃.
export default function AuthStatus() {
  const [email, setEmail] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [configured, setConfigured] = useState(true);

  useEffect(() => {
    // Supabase env 미설정(예: 아직 Vercel에 미등록)이면 클라이언트 생성 자체가 예외를 던진다.
    // 그 경우 인증 UI를 숨기고 조용히 통과 — 홈이 흰 화면이 되지 않도록.
    if (
      !process.env.NEXT_PUBLIC_SUPABASE_URL ||
      !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    ) {
      setConfigured(false);
      setReady(true);
      return;
    }
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => {
      setEmail(data.user?.email ?? null);
      setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setEmail(session?.user?.email ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // 초기 로딩 중엔 자리만 유지(깜빡임 방지)
  if (!ready) return <div className="h-7 w-16" aria-hidden />;

  // Supabase 미설정 환경에선 인증 UI 자체를 감춤
  if (!configured) return null;

  if (!email) {
    return (
      <a
        href="/login"
        className="rounded-lg bg-blue-600 px-3.5 py-1.5 text-[12px] font-semibold text-white shadow-sm transition-colors hover:bg-blue-700"
      >
        로그인
      </a>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <a
        href="/library"
        className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-[12px] font-semibold text-slate-700 shadow-sm transition-colors hover:border-blue-400 hover:bg-blue-50 hover:text-blue-700"
      >
        내 서재
      </a>
      <span
        className="hidden max-w-[160px] truncate text-[12px] text-slate-500 md:inline"
        title={email}
      >
        {email}
      </span>
      <form action="/auth/signout" method="post">
        <button
          type="submit"
          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-[12px] font-medium text-slate-600 shadow-sm transition-colors hover:border-slate-400 hover:text-slate-800"
        >
          로그아웃
        </button>
      </form>
    </div>
  );
}
