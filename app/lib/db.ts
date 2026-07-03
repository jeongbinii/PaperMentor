"use client";

import { createClient } from "./supabase/client";

// 저장에 필요한 논문 필드(loadedPaper.paper 형태)
export type PaperInput = {
  pmid: string;
  title: string;
  journal: string;
  authors: string[];
  doi: string | null;
  pubdate: string;
};

export type AnalysisRow = {
  paper_key: string;
  title: string;
  journal: string;
  pubdate: string;
  doi: string | null;
  created_at: string;
  summary: { keyMessage?: string } | null;
};

export type BookmarkRow = {
  paper_key: string;
  title: string;
  journal: string;
  pubdate: string;
  doi: string | null;
  created_at: string;
};

// Supabase 브라우저 클라이언트(미설정이면 null). 어떤 함수도 예외를 밖으로 던지지 않는다.
function client() {
  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  ) {
    return null;
  }
  try {
    return createClient();
  } catch {
    return null;
  }
}

async function uid(supabase: ReturnType<typeof createClient>) {
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

// 분석 결과를 히스토리에 저장(같은 논문이면 갱신). 비로그인/미설정이면 조용히 무시.
export async function saveAnalysis(
  paper: PaperInput,
  summary: unknown,
): Promise<void> {
  const supabase = client();
  if (!supabase) return;
  const user_id = await uid(supabase);
  if (!user_id) return;
  // created_at은 payload에 넣지 않는다 — INSERT 시 default now(), 재분석(UPDATE) 시엔 최초 생성 시각 보존.
  const { error } = await supabase.from("analyses").upsert(
    {
      user_id,
      paper_key: paper.pmid,
      title: paper.title ?? "",
      journal: paper.journal ?? "",
      authors: paper.authors ?? [],
      doi: paper.doi ?? null,
      pubdate: paper.pubdate ?? "",
      // 메타데이터만 저장(전체 본문·그림은 용량이 커 히스토리에 담지 않음)
      paper: {
        pmid: paper.pmid,
        title: paper.title ?? "",
        journal: paper.journal ?? "",
        authors: paper.authors ?? [],
        doi: paper.doi ?? null,
        pubdate: paper.pubdate ?? "",
      },
      summary,
    },
    { onConflict: "user_id,paper_key" },
  );
  if (error) console.error("saveAnalysis 실패:", error.message);
}

export async function listAnalyses(): Promise<AnalysisRow[]> {
  const supabase = client();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("analyses")
    .select("paper_key,title,journal,pubdate,doi,created_at,summary")
    .order("created_at", { ascending: false });
  if (error || !data) return [];
  return data as AnalysisRow[];
}

export async function listBookmarks(): Promise<BookmarkRow[]> {
  const supabase = client();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("bookmarks")
    .select("paper_key,title,journal,pubdate,doi,created_at")
    .order("created_at", { ascending: false });
  if (error || !data) return [];
  return data as BookmarkRow[];
}

// 북마크 추가(이미 있으면 그대로 둠). 성공 여부 반환.
export async function addBookmark(paper: PaperInput): Promise<boolean> {
  const supabase = client();
  if (!supabase) return false;
  const user_id = await uid(supabase);
  if (!user_id) return false;
  const { error } = await supabase.from("bookmarks").upsert(
    {
      user_id,
      paper_key: paper.pmid,
      title: paper.title ?? "",
      journal: paper.journal ?? "",
      authors: paper.authors ?? [],
      doi: paper.doi ?? null,
      pubdate: paper.pubdate ?? "",
    },
    { onConflict: "user_id,paper_key", ignoreDuplicates: true },
  );
  if (error) console.error("addBookmark 실패:", error.message);
  return !error;
}

export async function removeBookmark(paperKey: string): Promise<boolean> {
  const supabase = client();
  if (!supabase) return false;
  const user_id = await uid(supabase);
  if (!user_id) return false;
  const { error } = await supabase
    .from("bookmarks")
    .delete()
    .eq("user_id", user_id)
    .eq("paper_key", paperKey);
  if (error) console.error("removeBookmark 실패:", error.message);
  return !error;
}

export async function isBookmarked(paperKey: string): Promise<boolean> {
  const supabase = client();
  if (!supabase) return false;
  const user_id = await uid(supabase);
  if (!user_id) return false;
  const { data } = await supabase
    .from("bookmarks")
    .select("id")
    .eq("user_id", user_id)
    .eq("paper_key", paperKey)
    .limit(1);
  return !!(data && data.length);
}
