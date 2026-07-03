"use client";

import { useState } from "react";
import { createClient } from "@/app/lib/supabase/client";

export default function LoginPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signInWithGoogle() {
    setLoading(true);
    setError(null);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: `${window.location.origin}/auth/callback` },
      });
      // 성공하면 구글로 리다이렉트됨 → 아래 코드는 실패 시에만 도달
      if (error) {
        setError(error.message);
        setLoading(false);
      }
    } catch {
      // Supabase 미설정 등으로 클라이언트 생성이 실패한 경우 — 버튼이 멈추지 않도록 복구
      setError("로그인을 시작할 수 없어요. 잠시 후 다시 시도해주세요.");
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4">
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        {/* 브랜드 */}
        <div className="mb-6 flex flex-col items-center text-center">
          <svg viewBox="0 0 44 44" className="h-12 w-12" aria-hidden>
            <defs>
              <linearGradient id="pmGradLogin" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#2dd4bf" />
                <stop offset="48%" stopColor="#3b82f6" />
                <stop offset="100%" stopColor="#1e3a8a" />
              </linearGradient>
            </defs>
            <path d="M22 12.5c-4-2.6-10-2.6-15-1v22c5-1.6 11-1.6 15 1z" fill="url(#pmGradLogin)" />
            <path d="M22 12.5c4-2.6 10-2.6 15-1v22c-5-1.6-11-1.6-15 1z" fill="url(#pmGradLogin)" opacity="0.88" />
            <line x1="22" y1="12.8" x2="22" y2="34.2" stroke="#fff" strokeWidth="1" opacity="0.45" />
            <text x="14.2" y="27.5" textAnchor="middle" fontSize="11.5" fontWeight="800" fill="#fff">P</text>
            <text x="29.8" y="27.5" textAnchor="middle" fontSize="11.5" fontWeight="800" fill="#fff">M</text>
          </svg>
          <div className="mt-3 text-lg font-extrabold tracking-tight text-[#1e3a8a]">
            PAPERMENTOR
          </div>
          <p className="mt-1 text-[13px] text-slate-500">
            로그인하면 분석 기록과 저장한 논문을 이어볼 수 있어요.
          </p>
        </div>

        {/* 구글 로그인 */}
        <button
          onClick={signInWithGoogle}
          disabled={loading}
          className="flex w-full items-center justify-center gap-2.5 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50"
        >
          <svg className="h-[18px] w-[18px]" viewBox="0 0 24 24" aria-hidden>
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.76h3.56c2.08-1.92 3.28-4.74 3.28-8.09z" />
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.56-2.76c-.98.66-2.23 1.06-3.72 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z" />
            <path fill="#FBBC05" d="M5.84 14.09a6.6 6.6 0 0 1 0-4.18V7.07H2.18a11 11 0 0 0 0 9.86l3.66-2.84z" />
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.07l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z" />
          </svg>
          {loading ? "이동 중…" : "Google 계정으로 로그인"}
        </button>

        {error && (
          <p className="mt-3 text-center text-[12px] text-red-500">
            로그인에 실패했어요. 다시 시도해주세요.
          </p>
        )}

        <a
          href="/"
          className="mt-5 block text-center text-[12px] text-slate-400 hover:text-slate-600"
        >
          ← 로그인 없이 둘러보기
        </a>
      </div>
    </div>
  );
}
