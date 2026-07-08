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

// ── 이용후기·피드백 (공개 커뮤니티 리뷰 벽) ─────────────────────────
export type ReviewRow = {
  id: string;
  user_id: string;
  display_name: string;
  masked_email: string | null;
  rating: number | null;
  category: string;
  content: string;
  created_at: string;
};

// 이메일을 신뢰도용으로 마스킹(원본은 저장하지 않음). 예: mingi12@gmail.com → mi•••@gmail.com
export function maskEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const at = email.lastIndexOf("@");
  if (at <= 0) return null;
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (!domain) return null;
  const head = local.slice(0, local.length >= 2 ? 2 : 1);
  return `${head}•••@${domain}`;
}

// 공개 리뷰 벽: 누구나 읽기. 최신순 최대 200개.
export async function listReviews(): Promise<ReviewRow[]> {
  const supabase = client();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("reviews")
    .select("id,user_id,display_name,masked_email,rating,category,content,created_at")
    .order("created_at", { ascending: false })
    .limit(200);
  if (error || !data) return [];
  return data as ReviewRow[];
}

// 리뷰 작성(로그인 필요). 성공 여부·오류 메시지 반환.
export async function addReview(input: {
  display_name: string;
  rating: number | null;
  category: string;
  content: string;
}): Promise<{ ok: boolean; error?: string }> {
  const supabase = client();
  if (!supabase) return { ok: false, error: "저장소가 설정되지 않았습니다." };
  const { data: udata } = await supabase.auth.getUser();
  const user = udata.user;
  if (!user) return { ok: false, error: "로그인이 필요합니다." };
  const content = input.content.trim();
  if (!content) return { ok: false, error: "내용을 입력해 주세요." };
  const { error } = await supabase.from("reviews").insert({
    user_id: user.id,
    display_name: (input.display_name || "익명").trim().slice(0, 40) || "익명",
    // 원본 이메일은 저장하지 않고 마스킹된 값만 공개 테이블에 넣는다.
    masked_email: maskEmail(user.email),
    rating: input.rating ?? null,
    category: input.category || "후기",
    content: content.slice(0, 2000),
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

// 본인 글만 삭제(RLS로도 강제됨).
export async function deleteReview(id: string): Promise<boolean> {
  const supabase = client();
  if (!supabase) return false;
  const user_id = await uid(supabase);
  if (!user_id) return false;
  const { error } = await supabase
    .from("reviews")
    .delete()
    .eq("id", id)
    .eq("user_id", user_id);
  if (error) console.error("deleteReview 실패:", error.message);
  return !error;
}

// 현재 로그인 사용자 id + 표시이름 기본값(구글 이름 → 없으면 이메일 앞부분) + 이메일. 비로그인이면 null.
export async function currentUserInfo(): Promise<{
  id: string;
  name: string;
  email: string | null;
} | null> {
  const supabase = client();
  if (!supabase) return null;
  const { data } = await supabase.auth.getUser();
  const u = data.user;
  if (!u) return null;
  // 제공자마다 이름 필드가 달라 넓게 대응(구글: full_name/name, 카카오: nickname/name 등)
  const meta = (u.user_metadata ?? {}) as {
    full_name?: string;
    name?: string;
    nickname?: string;
    user_name?: string;
    preferred_username?: string;
  };
  const name =
    meta.full_name ||
    meta.name ||
    meta.nickname ||
    meta.user_name ||
    meta.preferred_username ||
    (u.email ? u.email.split("@")[0] : "사용자");
  return { id: u.id, name, email: u.email ?? null };
}
