-- PaperMentor 저장 시스템 스키마
-- Supabase 대시보드 → SQL Editor 에 붙여넣고 Run.
-- 재실행해도 안전(idempotent)하도록 작성.

-- ── 분석 히스토리 (분석한 논문 + 결과) ──────────────────────────────
create table if not exists public.analyses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  paper_key text not null,            -- PMID · DOI · PDF 합성 id (loadedPaper.paper.pmid)
  title text not null default '',
  journal text default '',
  authors text[] default '{}',
  doi text,
  pubdate text default '',
  paper jsonb,                        -- 원본 논문 메타(PubMedPaper)
  summary jsonb,                      -- 구조화 요약(StructuredSummary)
  created_at timestamptz not null default now(),
  unique (user_id, paper_key)         -- 같은 논문 재분석 시 갱신(upsert)
);

-- ── 논문 라이브러리 (북마크) ────────────────────────────────────────
create table if not exists public.bookmarks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  paper_key text not null,
  title text not null default '',
  journal text default '',
  authors text[] default '{}',
  doi text,
  pubdate text default '',
  created_at timestamptz not null default now(),
  unique (user_id, paper_key)
);

create index if not exists analyses_user_created_idx
  on public.analyses (user_id, created_at desc);
create index if not exists bookmarks_user_created_idx
  on public.bookmarks (user_id, created_at desc);

-- ── 행 수준 보안(RLS): 본인 데이터만 접근 ───────────────────────────
alter table public.analyses enable row level security;
alter table public.bookmarks enable row level security;

drop policy if exists analyses_select_own on public.analyses;
drop policy if exists analyses_insert_own on public.analyses;
drop policy if exists analyses_update_own on public.analyses;
drop policy if exists analyses_delete_own on public.analyses;
create policy analyses_select_own on public.analyses
  for select using (auth.uid() = user_id);
create policy analyses_insert_own on public.analyses
  for insert with check (auth.uid() = user_id);
create policy analyses_update_own on public.analyses
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy analyses_delete_own on public.analyses
  for delete using (auth.uid() = user_id);

drop policy if exists bookmarks_select_own on public.bookmarks;
drop policy if exists bookmarks_insert_own on public.bookmarks;
drop policy if exists bookmarks_delete_own on public.bookmarks;
create policy bookmarks_select_own on public.bookmarks
  for select using (auth.uid() = user_id);
create policy bookmarks_insert_own on public.bookmarks
  for insert with check (auth.uid() = user_id);
create policy bookmarks_delete_own on public.bookmarks
  for delete using (auth.uid() = user_id);

-- ── 테이블 접근 권한(GRANT) ────────────────────────────────────────
-- RLS는 "어떤 행"을 통제하고, GRANT는 "테이블 자체 접근 가능 여부"를 통제한다(둘 다 필요).
-- 로그인 사용자 역할(authenticated)에만 부여 — 비로그인(anon)은 접근 불가.
grant select, insert, update, delete on public.analyses to authenticated;
grant select, insert, delete on public.bookmarks to authenticated;

-- ── 이용후기·피드백 (공개 커뮤니티 리뷰 벽) ─────────────────────────
-- 읽기는 누구나(비로그인 포함), 작성·삭제는 로그인 본인만.
create table if not exists public.reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  display_name text not null default '익명',
  masked_email text,                            -- 신뢰도용 마스킹 이메일(예: mi•••@gmail.com). 원본은 저장 안 함.
  rating int check (rating between 1 and 5),   -- 선택(별점 없이도 작성 가능)
  category text not null default '후기',         -- 후기 | 버그 | 제안
  content text not null check (char_length(content) between 1 and 2000),
  created_at timestamptz not null default now()
);

-- 기존 테이블에도 컬럼 추가(재실행 안전)
alter table public.reviews add column if not exists masked_email text;

create index if not exists reviews_created_idx on public.reviews (created_at desc);

alter table public.reviews enable row level security;

drop policy if exists reviews_select_all on public.reviews;
drop policy if exists reviews_insert_own on public.reviews;
drop policy if exists reviews_delete_own on public.reviews;
create policy reviews_select_all on public.reviews
  for select using (true);                       -- 공개 벽: 누구나 읽기
create policy reviews_insert_own on public.reviews
  for insert with check (auth.uid() = user_id);  -- 본인 명의로만 작성
create policy reviews_delete_own on public.reviews
  for delete using (auth.uid() = user_id);       -- 본인 글만 삭제

-- 공개 읽기라 anon 에게도 select 부여, 작성/삭제는 로그인 사용자만.
grant select on public.reviews to anon, authenticated;
grant insert, delete on public.reviews to authenticated;
