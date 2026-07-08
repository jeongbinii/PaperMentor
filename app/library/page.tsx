"use client";

import { useEffect, useState } from "react";
import { useUser } from "../lib/useUser";
import {
  listAnalyses,
  listBookmarks,
  removeBookmark,
  type AnalysisRow,
  type BookmarkRow,
} from "../lib/db";

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("ko-KR", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return "";
  }
}

// 제목 표시. PMID/DOI 논문은 클릭 시 재분석 링크, PDF 업로드본은 원본이 없어 링크 대신 안내.
function PaperTitle({ paperKey, title }: { paperKey: string; title: string }) {
  if (paperKey.startsWith("pdf:")) {
    return (
      <div>
        <span className="line-clamp-2 text-sm font-medium text-slate-800">
          {title || paperKey.replace(/^pdf:/, "")}
        </span>
        <span className="mt-1 inline-block rounded bg-amber-50 px-1.5 py-0.5 text-[11px] text-amber-600">
          PDF 업로드본 · 다시 보려면 파일을 재업로드하세요
        </span>
      </div>
    );
  }
  return (
    <a
      href={`/?q=${encodeURIComponent(paperKey)}`}
      className="line-clamp-2 text-sm font-medium text-slate-800 hover:text-blue-600"
    >
      {title || paperKey}
    </a>
  );
}

export default function LibraryPage() {
  const { user, ready } = useUser();
  const [analyses, setAnalyses] = useState<AnalysisRow[]>([]);
  const [bookmarks, setBookmarks] = useState<BookmarkRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!ready) return;
    if (!user) {
      setLoading(false);
      return;
    }
    Promise.all([listAnalyses(), listBookmarks()]).then(([a, b]) => {
      setAnalyses(a);
      setBookmarks(b);
      setLoading(false);
    });
  }, [ready, user]);

  async function handleRemoveBookmark(key: string) {
    const ok = await removeBookmark(key);
    if (ok) setBookmarks((prev) => prev.filter((b) => b.paper_key !== key));
  }

  return (
    <div className="min-h-screen bg-slate-100 text-slate-800">
      <header className="border-b border-slate-200 bg-white px-5 py-3">
        <div className="mx-auto flex max-w-3xl items-center gap-3">
          <a
            href="/"
            className="text-[13px] text-slate-500 hover:text-blue-600"
          >
            ← PaperMentor
          </a>
          <span className="text-slate-300">|</span>
          <h1 className="text-[15px] font-bold tracking-tight text-[#1e3a8a]">
            내 서재
          </h1>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-5 py-8">
        {!ready || loading ? (
          <p className="mt-10 text-center text-sm text-slate-400">불러오는 중…</p>
        ) : !user ? (
          <div className="mt-16 text-center">
            <p className="text-sm text-slate-500">
              로그인하면 분석 기록과 저장한 논문을 볼 수 있어요.
            </p>
            <a
              href="/login"
              className="mt-4 inline-block rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              로그인
            </a>
          </div>
        ) : (
          <div className="space-y-10">
            {/* 저장한 논문(북마크) */}
            <section>
              <h2 className="mb-3 text-sm font-semibold text-slate-700">
                저장한 논문{" "}
                <span className="text-slate-400">({bookmarks.length})</span>
              </h2>
              {bookmarks.length === 0 ? (
                <p className="rounded-xl border border-slate-200 bg-white px-4 py-6 text-center text-[13px] text-slate-400">
                  아직 저장한 논문이 없어요. 분석 화면에서 제목 옆 “저장”을 눌러
                  담아두세요.
                </p>
              ) : (
                <ul className="space-y-2">
                  {bookmarks.map((b) => (
                    <li
                      key={b.paper_key}
                      className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <PaperTitle paperKey={b.paper_key} title={b.title} />
                          <p className="mt-1 truncate text-[12px] text-slate-400">
                            {[b.journal, b.pubdate].filter(Boolean).join(" · ")}
                          </p>
                        </div>
                        <button
                          onClick={() => handleRemoveBookmark(b.paper_key)}
                          className="shrink-0 rounded-md border border-slate-200 px-2 py-1 text-[12px] text-slate-400 hover:border-red-200 hover:text-red-500"
                        >
                          삭제
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* 최근 분석(히스토리) */}
            <section>
              <h2 className="mb-3 text-sm font-semibold text-slate-700">
                최근 분석{" "}
                <span className="text-slate-400">({analyses.length})</span>
              </h2>
              {analyses.length === 0 ? (
                <p className="rounded-xl border border-slate-200 bg-white px-4 py-6 text-center text-[13px] text-slate-400">
                  아직 분석 기록이 없어요. 논문을 분석하면 여기에 쌓입니다.
                </p>
              ) : (
                <ul className="space-y-2">
                  {analyses.map((a) => (
                    <li
                      key={a.paper_key}
                      className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
                    >
                      <PaperTitle paperKey={a.paper_key} title={a.title} />
                      <p className="mt-1 truncate text-[12px] text-slate-400">
                        {[a.journal, a.pubdate, fmtDate(a.created_at)]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                      {a.summary?.keyMessage && (
                        <p className="mt-2 line-clamp-2 text-[13px] leading-relaxed text-slate-600">
                          {a.summary.keyMessage}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}
      </main>
    </div>
  );
}
