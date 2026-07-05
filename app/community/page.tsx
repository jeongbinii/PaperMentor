"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import AuthStatus from "@/app/components/AuthStatus";
import {
  listReviews,
  addReview,
  deleteReview,
  currentUserInfo,
  type ReviewRow,
} from "@/app/lib/db";

const CATEGORIES = ["후기", "버그", "제안"] as const;

const CAT_STYLE: Record<string, string> = {
  후기: "bg-teal-50 text-teal-700 border-teal-200",
  버그: "bg-red-50 text-red-600 border-red-200",
  제안: "bg-blue-50 text-blue-600 border-blue-200",
};

function Stars({ value }: { value: number | null }) {
  if (!value) return null;
  return (
    <span className="text-[13px] tracking-tight text-amber-500" aria-label={`별점 ${value}점`}>
      {"★".repeat(value)}
      <span className="text-slate-300">{"★".repeat(5 - value)}</span>
    </span>
  );
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString("ko-KR", { year: "numeric", month: "short", day: "numeric" });
}

export default function CommunityPage() {
  const [reviews, setReviews] = useState<ReviewRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [me, setMe] = useState<{ id: string; name: string } | null>(null);
  const [ready, setReady] = useState(false);

  // 작성 폼
  const [name, setName] = useState("");
  const [rating, setRating] = useState<number | null>(null);
  const [category, setCategory] = useState<string>("후기");
  const [content, setContent] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setReviews(await listReviews());
  }

  useEffect(() => {
    let alive = true;
    (async () => {
      const [info, list] = await Promise.all([currentUserInfo(), listReviews()]);
      if (!alive) return;
      setMe(info);
      if (info) setName(info.name);
      setReviews(list);
      setLoading(false);
      setReady(true);
    })();
    return () => {
      alive = false;
    };
  }, []);

  async function submit() {
    if (submitting) return;
    setError(null);
    if (!content.trim()) {
      setError("내용을 입력해 주세요.");
      return;
    }
    setSubmitting(true);
    const res = await addReview({ display_name: name, rating, category, content });
    setSubmitting(false);
    if (!res.ok) {
      setError(res.error ?? "작성에 실패했습니다.");
      return;
    }
    setContent("");
    setRating(null);
    setCategory("후기");
    await refresh();
  }

  async function onDelete(id: string) {
    if (!window.confirm("이 글을 삭제할까요?")) return;
    const ok = await deleteReview(id);
    if (ok) setReviews((r) => r.filter((x) => x.id !== id));
  }

  return (
    <div className="min-h-screen bg-slate-50">
      {/* 헤더 */}
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-slate-200 bg-white px-5 py-3">
        <Link
          href="/"
          className="flex items-center gap-1.5 text-[13px] font-medium text-slate-500 transition-colors hover:text-blue-600"
        >
          <span aria-hidden>←</span> 논문 분석으로
        </Link>
        <div className="ml-1 text-sm font-semibold text-slate-800">이용후기 · 커뮤니티</div>
        <div className="ml-auto">
          <AuthStatus />
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-4 py-6">
        <p className="mb-4 text-[13px] leading-relaxed text-slate-500">
          PaperMentor를 써 보고 느낀 점, 불편한 점, 바라는 기능을 남겨 주세요. 남긴 글은 모두에게
          공개되며, 작성은 로그인한 분만 가능합니다.
        </p>

        {/* 작성 폼 */}
        {!ready ? (
          <div className="mb-6 h-24 animate-pulse rounded-xl border border-slate-200 bg-white" />
        ) : me ? (
          <div className="mb-6 rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-1.5 text-[12px] text-slate-500">
                이름
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value.slice(0, 40))}
                  className="w-32 rounded-md border border-slate-200 px-2 py-1 text-[13px] text-slate-700 focus:border-blue-300 focus:outline-none"
                />
              </label>

              {/* 별점 (선택) */}
              <div className="flex items-center gap-1">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setRating((r) => (r === n ? null : n))}
                    aria-label={`별점 ${n}`}
                    className={`text-[18px] leading-none transition-colors ${
                      rating && n <= rating ? "text-amber-500" : "text-slate-300 hover:text-amber-300"
                    }`}
                  >
                    ★
                  </button>
                ))}
                {rating && (
                  <button
                    type="button"
                    onClick={() => setRating(null)}
                    className="ml-1 text-[11px] text-slate-400 hover:text-slate-600"
                  >
                    지우기
                  </button>
                )}
              </div>

              {/* 카테고리 */}
              <div className="flex items-center gap-1">
                {CATEGORIES.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setCategory(c)}
                    className={`rounded-full border px-2.5 py-1 text-[12px] font-medium transition-colors ${
                      category === c
                        ? "border-blue-500 bg-blue-500 text-white"
                        : "border-slate-200 text-slate-500 hover:border-blue-300"
                    }`}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </div>

            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value.slice(0, 2000))}
              rows={4}
              placeholder="자유롭게 남겨 주세요. (최대 2000자)"
              className="mt-3 w-full resize-none rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2 text-[14px] text-slate-700 placeholder:text-slate-400 focus:border-blue-300 focus:outline-none focus:ring-1 focus:ring-blue-200"
            />

            <div className="mt-2 flex items-center justify-between">
              <span className="text-[11px] tabular-nums text-slate-400">{content.length}/2000</span>
              <div className="flex items-center gap-3">
                {error && <span className="text-[12px] text-red-500">{error}</span>}
                <button
                  onClick={submit}
                  disabled={submitting || !content.trim()}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-[13px] font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
                >
                  {submitting ? "등록 중…" : "등록"}
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="mb-6 flex flex-col items-start gap-2 rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-[13px] text-slate-500">후기를 남기려면 로그인이 필요합니다.</p>
            <a
              href="/login"
              className="rounded-lg bg-blue-600 px-4 py-2 text-[13px] font-medium text-white transition-colors hover:bg-blue-700"
            >
              로그인하고 후기 남기기
            </a>
          </div>
        )}

        {/* 리뷰 목록 */}
        {loading ? (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-20 animate-pulse rounded-xl border border-slate-200 bg-white" />
            ))}
          </div>
        ) : reviews.length === 0 ? (
          <p className="py-12 text-center text-[13px] text-slate-400">
            아직 남겨진 후기가 없습니다. 첫 후기를 남겨 주세요.
          </p>
        ) : (
          <ul className="space-y-3">
            {reviews.map((r) => (
              <li key={r.id} className="rounded-xl border border-slate-200 bg-white p-4">
                <div className="mb-1.5 flex flex-wrap items-center gap-2">
                  <span
                    className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${
                      CAT_STYLE[r.category] ?? "border-slate-200 text-slate-500"
                    }`}
                  >
                    {r.category}
                  </span>
                  <Stars value={r.rating} />
                  <span className="text-[13px] font-medium text-slate-700">{r.display_name}</span>
                  <span className="text-[11px] text-slate-400">{fmtDate(r.created_at)}</span>
                  {me && me.id === r.user_id && (
                    <button
                      onClick={() => onDelete(r.id)}
                      className="ml-auto text-[11px] text-slate-400 hover:text-red-500"
                    >
                      삭제
                    </button>
                  )}
                </div>
                <p className="whitespace-pre-wrap text-[14px] leading-relaxed text-slate-700">
                  {r.content}
                </p>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
