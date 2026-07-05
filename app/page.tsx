"use client";

import { useState, useEffect, useRef, type ReactNode } from "react";
import dynamic from "next/dynamic";
import ReadingGuide from "./components/ReadingGuide";
import FeatureTip from "./components/FeatureTip";
import Onboarding from "./components/Onboarding";
import AuthStatus from "./components/AuthStatus";
import { useUser } from "./lib/useUser";
import {
  saveAnalysis,
  isBookmarked,
  addBookmark,
  removeBookmark,
} from "./lib/db";

// react-pdf는 브라우저 전용(pdf.js) → SSR 비활성화로 클라이언트에서만 로드
const PdfViewer = dynamic(() => import("./components/PdfViewer"), {
  ssr: false,
  loading: () => (
    <div className="flex-1 p-6 text-xs text-zinc-400">PDF 준비 중…</div>
  ),
});

const SOURCE_TIP_KEY = "pm_source_tip_seen";
// 온보딩 개편(단계별 안내) — 키를 올려 기존 이용자에게도 한 번 다시 노출
const WELCOME_KEY = "pm_onboarding_v2";
const FONT_SCALE_KEY = "pm_font_scale";
// 글자 크기(루트 폰트) 단계 — rem 기반 텍스트가 함께 커짐
const FONT_MIN = 14;
const FONT_MAX = 21;
const FONT_DEFAULT = 16;

// 우측 기능 패널 전체 마스터 스위치. 개별 탭은 위 탭 배열에서 가감한다.
// (시각화 탭은 중앙으로 이동, 신뢰도 탭은 일시 비활성화 — 렌더 블록은 보존)
const SHOW_RIGHT_PANEL = true;

type ChatMessage = {
  role: "user" | "assistant";
  text: string;
};

type RightTab = "guide" | "background" | "translate" | "stats" | "qa" | "reliability" | "quiz" | "visualize" | "slides";

type Figure = { label: string; caption: string; srcs: string[] };

type PubMedPaper = {
  pmid: string;
  title: string;
  abstract: string;
  authors: string[];
  journal: string;
  pubdate: string;
  doi: string | null;
  fullText?: string;
  bodyText?: string;
  figures?: Figure[];
};

type KeyFinding = {
  claim: string;
  evidence: string;
  source?: string;
};

type StructuredSummary = {
  keyFindings: KeyFinding[];
  background: string;
  methods: string;
  results: string;
  conclusion: string;
  keyMessage: string;
};

type MedicalTerm = {
  english: string;
  korean: string;
  explanation: string;
  difficulty: "상" | "중";
};

type TranslationResult = {
  translation: string;
  terms: MedicalTerm[];
};

type StatItem = {
  metric: string;
  value: string;
  plain: string;
  interpretation: string;
  clinicalMeaning: string;
  importance: "핵심" | "보조";
  caution: string;
};

type StatisticsResult = {
  items: StatItem[];
  summary: string;
};

type BackgroundCard = {
  concept: string;
  summary: string;
  importance: string;
};

type BackgroundResult = {
  cards: BackgroundCard[];
};

type ReliabilityCard = {
  category: string;
  value: string;
  interpretation: string;
  level: "높음" | "보통" | "낮음" | "정보없음";
};

type ReliabilityResult = {
  cards: ReliabilityCard[];
  overall: string;
};

type QuizQuestion = {
  question: string;
  options: string[];
  answer: number;
  explanation: string;
};

type QuizResult = {
  questions: QuizQuestion[];
};

type GuideStep = {
  order: number;
  section: string;
  goal: string;
  lookFor: string[];
  watchOut: string;
  helperTab: "background" | "translate" | "stats" | "reliability" | "quiz" | "";
  anchor?: string; // 단계가 가리키는 원문 대표 문장 (구버전 캐시 대비 optional)
};

type Positioning = {
  intervention: string;
  lineOfTherapy: string;
  status: string;
  comparator: string;
  clinicalContext: string;
};

type ReadingGuideResult = {
  firstReadFocus: string;
  steps: GuideStep[];
  positioning: Positioning | null;
};

type LoadedPaper = {
  paper: PubMedPaper;
  summary: StructuredSummary;
  translation?: TranslationResult;
  statistics?: StatisticsResult;
  background?: BackgroundResult;
  reliability?: ReliabilityResult;
  quiz?: QuizResult;
  guide?: ReadingGuideResult;
  geminiImage?: string;
  pdfUrl?: string; // 업로드한 PDF의 object URL (좌측 원본 임베드용)
};

// 공백/줄바꿈 차이를 무시하고 원문에서 발췌문 위치를 찾는다.
// 모델이 준 source가 원문과 띄어쓰기·개행만 다른 경우에도 매칭되도록 정규화 후 인덱스를 역매핑한다.
function normalizeWithMap(s: string): { norm: string; map: number[] } {
  let norm = "";
  const map: number[] = [];
  let prevSpace = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (/\s/.test(ch)) {
      if (!prevSpace) {
        norm += " ";
        map.push(i);
        prevSpace = true;
      }
    } else {
      norm += ch;
      map.push(i);
      prevSpace = false;
    }
  }
  return { norm, map };
}

function findInText(
  haystack: string,
  needle: string,
): { start: number; end: number } | null {
  if (!haystack || !needle) return null;
  const exact = haystack.indexOf(needle);
  if (exact !== -1) return { start: exact, end: exact + needle.length };

  const H = normalizeWithMap(haystack);
  const hNorm = H.norm.toLowerCase();
  const nNorm = needle.replace(/\s+/g, " ").trim().toLowerCase();
  if (!nNorm) return null;

  let idx = hNorm.indexOf(nNorm);
  let matchLen = nNorm.length;
  if (idx === -1) {
    // 끝부분이 조금 달라도 잡히도록 앞부분(최대 50자)으로 재시도
    const prefix = nNorm.slice(0, 50);
    if (prefix.length >= 12) idx = hNorm.indexOf(prefix);
    if (idx === -1) return null;
    matchLen = prefix.length;
  }
  const start = H.map[idx];
  const endIdx = Math.min(idx + matchLen - 1, H.map.length - 1);
  const end = H.map[endIdx] + 1;
  return { start, end };
}

// ── 의학용어 인라인 호버 ────────────────────────────────────────────
type TermHit = { start: number; end: number; term: MedicalTerm };
type TipHandler = (term: MedicalTerm | null, el: HTMLElement | null) => void;

// 텍스트에서 용어(영어·한글 표기)의 모든 등장 위치를 찾아 겹치지 않게 반환
function termHits(text: string, terms: MedicalTerm[]): TermHit[] {
  const hits: TermHit[] = [];
  const lower = text.toLowerCase();
  for (const term of terms) {
    for (const variant of [term.english, term.korean]) {
      if (!variant || variant.length < 2) continue;
      const v = variant.toLowerCase();
      let from = 0;
      let idx = lower.indexOf(v, from);
      while (idx !== -1) {
        hits.push({ start: idx, end: idx + variant.length, term });
        from = idx + variant.length;
        idx = lower.indexOf(v, from);
      }
    }
  }
  hits.sort(
    (a, b) => a.start - b.start || b.end - b.start - (a.end - a.start),
  );
  const out: TermHit[] = [];
  let lastEnd = -1;
  for (const h of hits) {
    if (h.start >= lastEnd) {
      out.push(h);
      lastEnd = h.end;
    }
  }
  return out;
}

function TermSpan({
  term,
  highlighted,
  onTip,
  children,
}: {
  term: MedicalTerm;
  highlighted: boolean;
  onTip: TipHandler;
  children: ReactNode;
}) {
  return (
    <span
      className={`cursor-help underline decoration-dotted decoration-1 decoration-sky-400 underline-offset-2 ${
        highlighted ? "rounded bg-yellow-200 text-zinc-900" : ""
      }`}
      onMouseEnter={(e) => onTip(term, e.currentTarget)}
      onMouseLeave={() => onTip(null, null)}
    >
      {children}
    </span>
  );
}

// 원문/요약 텍스트를 렌더하며 (1) 용어 호버 (2) 형광펜 강조를 한 번에 처리
function renderRich(
  text: string,
  opts: {
    terms?: MedicalTerm[];
    highlight?: string | null;
    onTip?: TipHandler;
    markRef?: { current: HTMLSpanElement | null };
  },
): ReactNode {
  const { terms = [], highlight = null, onTip, markRef } = opts;
  const hits = terms.length && onTip ? termHits(text, terms) : [];
  const hl = highlight ? findInText(text, highlight) : null;
  if (!hits.length && !hl) return text;

  const cuts = new Set<number>([0, text.length]);
  if (hl) {
    cuts.add(hl.start);
    cuts.add(hl.end);
  }
  for (const h of hits) {
    cuts.add(h.start);
    cuts.add(h.end);
  }
  const sorted = Array.from(cuts).sort((a, b) => a - b);

  const nodes: ReactNode[] = [];
  let anchored = false;
  for (let i = 0; i < sorted.length - 1; i++) {
    const s = sorted[i];
    const e = sorted[i + 1];
    if (e <= s) continue;
    const slice = text.slice(s, e);
    const inHl = !!hl && s >= hl.start && e <= hl.end;
    const hit = hits.find((h) => s >= h.start && e <= h.end);

    if (inHl && !anchored && markRef) {
      nodes.push(<span key={`a${s}`} ref={markRef} />);
      anchored = true;
    }
    if (hit && onTip) {
      nodes.push(
        <TermSpan key={s} term={hit.term} highlighted={inHl} onTip={onTip}>
          {slice}
        </TermSpan>,
      );
    } else if (inHl) {
      nodes.push(
        <mark
          key={s}
          className="rounded bg-yellow-200 px-0.5 text-zinc-900 ring-1 ring-yellow-300"
        >
          {slice}
        </mark>,
      );
    } else {
      nodes.push(<span key={s}>{slice}</span>);
    }
  }
  return <>{nodes}</>;
}

type CaretDoc = {
  caretRangeFromPoint?: (x: number, y: number) => Range | null;
  caretPositionFromPoint?: (
    x: number,
    y: number,
  ) => { offsetNode: Node; offset: number } | null;
};

// 화면 좌표(x,y)에 있는 '단어'(공백·구두점 사이 토큰)를 찾아 해설 대상으로 반환.
// 모바일 탭용 — 드래그 선택 대신 손가락으로 짚은 단어를 잡는다. data-explain 밖이면 null.
function wordAtPoint(
  x: number,
  y: number,
): { term: string; rect: DOMRect; block: Element | null } | null {
  const doc = document as unknown as CaretDoc;
  let node: Node | null = null;
  let offset = 0;
  if (doc.caretRangeFromPoint) {
    const r = doc.caretRangeFromPoint(x, y);
    if (r) {
      node = r.startContainer;
      offset = r.startOffset;
    }
  } else if (doc.caretPositionFromPoint) {
    const p = doc.caretPositionFromPoint(x, y);
    if (p) {
      node = p.offsetNode;
      offset = p.offset;
    }
  }
  if (!node || node.nodeType !== Node.TEXT_NODE) return null;
  const el = node.parentElement;
  if (!el || !el.closest("[data-explain]")) return null;
  const text = node.textContent ?? "";
  if (!text) return null;
  const isWord = (ch: string | undefined) =>
    !!ch && !/[\s.,;:!?()[\]{}"“”'·…]/.test(ch);
  let s = Math.min(Math.max(offset, 0), text.length);
  let e = s;
  // caret가 단어 끝 경계에 걸리면 왼쪽 단어를 잡는다
  if (!isWord(text[s]) && isWord(text[s - 1])) {
    s -= 1;
    e = s;
  }
  while (s > 0 && isWord(text[s - 1])) s -= 1;
  while (e < text.length && isWord(text[e])) e += 1;
  const term = text.slice(s, e).trim();
  if (!term) return null;
  const range = document.createRange();
  range.setStart(node, s);
  range.setEnd(node, e);
  const rect = range.getBoundingClientRect();
  const block = el.closest(
    "[data-explain] p, [data-explain] li, [data-explain] article",
  );
  return { term, rect, block };
}

export default function Home() {
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState<RightTab>("guide");
  // 좌측 검색/최근 패널 펼침 여부 (논문 로드되면 접혀서 원문에 공간 양보)
  const [searchOpen, setSearchOpen] = useState(true);
  // 좌측 원본 보기 모드: PDF 업로드면 실제 PDF, 아니면 추출 텍스트
  const [originalView, setOriginalView] = useState<"pdf" | "text">("text");
  // 요약 → 원문 근거 형광펜: 현재 강조 중인 원문 발췌문
  const [highlight, setHighlight] = useState<string | null>(null);
  const markRef = useRef<HTMLSpanElement | null>(null);
  // 의학용어 인라인 호버 툴팁 (화면 잘림 방지 위해 fixed 위치)
  const [termTip, setTermTip] = useState<{
    term: MedicalTerm;
    x: number;
    y: number;
  } | null>(null);
  // 용어 해설 모드: 켜면 요약·원문에서 텍스트를 드래그할 때 그 부분 해설을 즉석 생성
  const [explainMode, setExplainMode] = useState(false);
  const [explainPopup, setExplainPopup] = useState<{
    x: number;
    y: number;
    term: string;
    loading: boolean;
    text: string;
    error: string;
  } | null>(null);
  // 형광펜 기능 첫 사용 안내 팝업
  const [showSourceTip, setShowSourceTip] = useState(false);
  // 사이트 첫 방문 사용 안내 팝업 (우상단 '사용 안내' 버튼으로 재호출 가능)
  const [showWelcome, setShowWelcome] = useState(false);
  // 글자 크기(루트 폰트 px). 읽기 편의를 위해 헤더에서 조절, localStorage 유지
  const [fontScale, setFontScale] = useState(FONT_DEFAULT);

  const [paperLoading, setPaperLoading] = useState(false);
  const [paperError, setPaperError] = useState<string | null>(null);

  // 로그인 사용자 + 북마크 상태(로그인 시에만 저장/북마크 UI 노출)
  const { user } = useUser();
  const [bookmarked, setBookmarked] = useState(false);
  const [bookmarkBusy, setBookmarkBusy] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  // 3분할 패널 너비 (px) — 가운데(main)는 flex-1로 나머지 차지
  const [leftW, setLeftW] = useState(360);
  const [rightW, setRightW] = useState(440);

  // 모바일(lg 미만): 한 번에 한 패널만 표시 — 하단 탭으로 전환
  const [mobileView, setMobileView] = useState<
    "original" | "summary" | "tools"
  >("original");
  const resizingRef = useRef<null | "left" | "right">(null);
  const leftWRef = useRef(leftW);
  const rightWRef = useRef(rightW);
  useEffect(() => {
    leftWRef.current = leftW;
    rightWRef.current = rightW;
  });

  // 창 크기에 맞춰 패널 너비 보정 (작은 창에서 가운데가 붕괴/가로스크롤 방지)
  useEffect(() => {
    function clampToViewport() {
      const total = window.innerWidth;
      const MIN_CENTER = 320;
      const MIN_LEFT = 200;
      const MIN_RIGHT = 300;
      let r = rightWRef.current;
      let l = leftWRef.current;
      r = Math.max(MIN_RIGHT, Math.min(r, total - MIN_LEFT - MIN_CENTER));
      l = Math.max(MIN_LEFT, Math.min(l, total - r - MIN_CENTER));
      setLeftW(l);
      setRightW(r);
    }
    clampToViewport();
    window.addEventListener("resize", clampToViewport);
    return () => window.removeEventListener("resize", clampToViewport);
  }, []);

  useEffect(() => {
    const MIN_LEFT = 200;
    const MIN_RIGHT = 320;
    const MIN_CENTER = 360;
    function onMove(e: MouseEvent) {
      const side = resizingRef.current;
      if (!side) return;
      const total = window.innerWidth;
      if (side === "left") {
        const max = total - rightW - MIN_CENTER;
        setLeftW(Math.max(MIN_LEFT, Math.min(e.clientX, max)));
      } else {
        const max = total - leftW - MIN_CENTER;
        setRightW(Math.max(MIN_RIGHT, Math.min(total - e.clientX, max)));
      }
    }
    function onUp() {
      if (!resizingRef.current) return;
      resizingRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [leftW, rightW]);

  function startResize(side: "left" | "right") {
    resizingRef.current = side;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }
  const [loadedPaper, setLoadedPaper] = useState<LoadedPaper | null>(null);
  const [recentPapers, setRecentPapers] = useState<LoadedPaper[]>([]);

  // 논문이 바뀌면 형광펜 강조 해제 + 직전 논문의 이미지 오류 상태 초기화
  useEffect(() => {
    setHighlight(null);
    setGeminiError(null);
  }, [loadedPaper?.paper.pmid]);

  // 강조가 바뀌면 좌측 원문의 해당 부분으로 스크롤
  useEffect(() => {
    if (highlight && markRef.current) {
      markRef.current.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }, [highlight]);

  // 첫 방문이면 사용 안내 팝업 자동 표시
  useEffect(() => {
    try {
      if (!localStorage.getItem(WELCOME_KEY)) setShowWelcome(true);
    } catch {
      // localStorage 불가 환경 무시
    }
  }, []);

  // 글자 크기: 저장값 로드
  useEffect(() => {
    try {
      const saved = Number(localStorage.getItem(FONT_SCALE_KEY));
      if (saved >= FONT_MIN && saved <= FONT_MAX) setFontScale(saved);
    } catch {
      // 무시
    }
  }, []);

  // 글자 크기: 루트 폰트에 적용 + 저장 (rem 기반 텍스트가 함께 커짐)
  useEffect(() => {
    document.documentElement.style.fontSize = `${fontScale}px`;
    try {
      localStorage.setItem(FONT_SCALE_KEY, String(fontScale));
    } catch {
      // 무시
    }
  }, [fontScale]);

  // 내 서재 등에서 ?q=PMID/DOI 로 진입하면 자동으로 그 논문을 분석
  const autoRanRef = useRef(false);
  useEffect(() => {
    if (autoRanRef.current) return;
    autoRanRef.current = true;
    const q = new URLSearchParams(window.location.search).get("q");
    // PDF 업로드본(pdf:파일명)은 서버에 원본이 없어 재분석 불가 → 자동실행하지 않음
    if (q && !q.startsWith("pdf:")) {
      setSearchQuery(q);
      void handleAnalyzePaper(q);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 현재 논문 북마크 토글(로그인 시에만 버튼 노출)
  async function toggleBookmark() {
    if (!loadedPaper || bookmarkBusy) return;
    setBookmarkBusy(true);
    const p = loadedPaper.paper;
    try {
      if (bookmarked) {
        const ok = await removeBookmark(p.pmid);
        if (ok) setBookmarked(false);
      } else {
        const ok = await addBookmark({
          pmid: p.pmid,
          title: p.title,
          journal: p.journal,
          authors: p.authors,
          doi: p.doi,
          pubdate: p.pubdate,
        });
        if (ok) setBookmarked(true);
      }
    } finally {
      setBookmarkBusy(false);
    }
  }

  // 로그인 상태·현재 논문에 맞춰 북마크 여부 동기화
  // (분석 직후뿐 아니라 로그인/로그아웃 전환·서재 진입 레이스에도 대응)
  useEffect(() => {
    if (!user || !loadedPaper) {
      setBookmarked(false);
      return;
    }
    let alive = true;
    isBookmarked(loadedPaper.paper.pmid).then((v) => {
      if (alive) setBookmarked(v);
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, loadedPaper?.paper.pmid]);

  // 용어 해설 모드: 데스크톱은 드래그 선택, 모바일은 탭(또는 롱프레스 선택)으로 해설 생성
  useEffect(() => {
    if (!explainMode) return;

    async function trigger(term: string, context: string, cx: number, cy: number) {
      const x = Math.min(Math.max(cx, 160), window.innerWidth - 160);
      setExplainPopup({ x, y: cy, term, loading: true, text: "", error: "" });
      try {
        const res = await fetch("/api/explain-term", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ term, context, title: loadedPaper?.paper.title }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "해설 생성에 실패했습니다.");
        setExplainPopup((p) =>
          p && p.term === term
            ? { ...p, loading: false, text: data.explanation as string }
            : p,
        );
      } catch (e) {
        const msg = e instanceof Error ? e.message : "알 수 없는 오류";
        setExplainPopup((p) =>
          p && p.term === term ? { ...p, loading: false, error: msg } : p,
        );
      }
    }

    // 현재 선택(드래그/롱프레스)이 유효하면 해설 대상으로 삼는다. 처리했으면 true.
    function fromSelection(): boolean {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) return false;
      const term = sel.toString().trim();
      if (term.length < 2 || term.length > 120) return false;
      const node = sel.anchorNode;
      const el = (node instanceof Element ? node : node?.parentElement) ?? null;
      const region = el?.closest("[data-explain]");
      if (!region) return false;
      const rect = sel.getRangeAt(0).getBoundingClientRect();
      const block = el?.closest(
        "[data-explain] p, [data-explain] li, [data-explain] article",
      );
      const context = (block?.textContent || region.textContent || "").slice(0, 600);
      trigger(term, context, rect.left + rect.width / 2, rect.bottom + 8);
      return true;
    }

    let lastTouch = 0;

    function onMouseUp() {
      if (Date.now() - lastTouch < 800) return; // 터치 후 합성되는 마우스 이벤트 무시
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) {
        setExplainPopup(null); // 빈 클릭이면 팝업 닫기
        return;
      }
      fromSelection();
    }

    // 탭 vs 스크롤 구분용 시작 좌표
    let sx = 0;
    let sy = 0;
    let moved = false;
    function onTouchStart(e: TouchEvent) {
      const t = e.touches[0];
      if (!t) return;
      sx = t.clientX;
      sy = t.clientY;
      moved = false;
    }
    function onTouchMove(e: TouchEvent) {
      const t = e.touches[0];
      if (!t) return;
      if (Math.abs(t.clientX - sx) > 10 || Math.abs(t.clientY - sy) > 10) moved = true;
    }
    function onTouchEnd(e: TouchEvent) {
      lastTouch = Date.now();
      if (moved) return; // 스크롤 제스처는 무시
      if (fromSelection()) return; // 롱프레스로 구절을 선택했으면 그걸 사용
      const t = e.changedTouches[0];
      if (!t) return;
      const hit = wordAtPoint(t.clientX, t.clientY); // 손가락으로 짚은 단어
      if (!hit) {
        setExplainPopup(null);
        return;
      }
      if (hit.term.length < 2 || hit.term.length > 120) return;
      const context = (hit.block?.textContent || "").slice(0, 600);
      trigger(hit.term, context, hit.rect.left + hit.rect.width / 2, hit.rect.bottom + 8);
    }

    document.addEventListener("mouseup", onMouseUp);
    document.addEventListener("touchstart", onTouchStart, { passive: true });
    document.addEventListener("touchmove", onTouchMove, { passive: true });
    document.addEventListener("touchend", onTouchEnd);
    return () => {
      document.removeEventListener("mouseup", onMouseUp);
      document.removeEventListener("touchstart", onTouchStart);
      document.removeEventListener("touchmove", onTouchMove);
      document.removeEventListener("touchend", onTouchEnd);
    };
  }, [explainMode, loadedPaper]);

  const [chatInput, setChatInput] = useState("");
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [translateLoading, setTranslateLoading] = useState(false);
  const [translateError, setTranslateError] = useState<string | null>(null);

  const [statsLoading, setStatsLoading] = useState(false);
  const [statsError, setStatsError] = useState<string | null>(null);

  const [backgroundLoading, setBackgroundLoading] = useState(false);
  const [backgroundError, setBackgroundError] = useState<string | null>(null);

  const [reliabilityLoading, setReliabilityLoading] = useState(false);
  const [reliabilityError, setReliabilityError] = useState<string | null>(null);

  const [quizLoading, setQuizLoading] = useState(false);
  const [quizError, setQuizError] = useState<string | null>(null);
  const [quizAnswers, setQuizAnswers] = useState<Record<number, number>>({});

  const [guideLoading, setGuideLoading] = useState(false);
  const [guideError, setGuideError] = useState<string | null>(null);
  const [geminiLoading, setGeminiLoading] = useState(false);
  const [geminiError, setGeminiError] = useState<string | null>(null);
  const [imageProvider, setImageProvider] = useState<
    "gemini" | "openai" | "flux" | "ideogram"
  >("gemini");

  // 발표 슬라이드(.pptx) 다운로드 상태
  const [slidesMode, setSlidesMode] = useState<null | "compose" | "llm">(null);
  const [slidesError, setSlidesError] = useState<string | null>(null);
  const [slidesRequirements, setSlidesRequirements] = useState("");
  const [slidesResult, setSlidesResult] = useState<
    { mode: "compose" | "llm"; slides: number; figures: number } | null
  >(null);

  // 논문(메타+초록)을 받아 요약 생성 후 상태에 적재 — PMID/DOI 경로와 PDF 경로가 공유
  async function summarizeAndLoad(paper: PubMedPaper, pdfUrl?: string) {
    const summaryRes = await fetch("/api/summarize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: paper.title,
        abstract: paper.abstract,
        fullText: paper.fullText,
      }),
    });
    const summaryData = await summaryRes.json();
    if (!summaryRes.ok) {
      throw new Error(summaryData.error ?? "요약 생성에 실패했습니다.");
    }

    const loaded: LoadedPaper = {
      paper,
      summary: summaryData.summary as StructuredSummary,
      pdfUrl,
    };
    setLoadedPaper(loaded);
    setMobileView("summary"); // 모바일: 분석 직후 핵심요약 패널로 전환
    // 로그인 상태면 분석을 히스토리에 저장(실패해도 분석엔 영향 없음).
    // 북마크 여부는 아래 [user, 논문] useEffect가 동기화한다.
    void saveAnalysis(paper, loaded.summary);
    setChatHistory([]);
    setQuizAnswers({});
    setActiveTab("guide");
    setSearchOpen(false);
    setOriginalView(pdfUrl ? "pdf" : "text");
    setRecentPapers((prev) => {
      const without = prev.filter((p) => p.paper.pmid !== paper.pmid);
      return [loaded, ...without].slice(0, 10);
    });

    // 시각화 요약 이미지 자동 생성 (Gemini) — 사용자 요청 없이 분석 직후 생성
    if (!loaded.geminiImage) {
      handleGenerateImage(loaded, "gemini");
    }
    // 의학용어 사전 자동 생성 — 요약·원문 인라인 호버에 사용
    if (!loaded.translation) {
      handleTranslate(loaded);
    }
    // 우측 읽기 도구 미리 생성(프리페치) — 탭 클릭 후 대기 제거.
    // 각 핸들러는 (target.X || loading) 가드가 있어 중복 호출/이후 탭 클릭과 충돌하지 않음.
    // 공용 계정 버스트 완화: 기본 탭(가이드)만 즉시, 나머지는 짧은 시차로 순차 실행(수 초 내 모두 준비).
    handleGuide(loaded);
    const prefetchRest = [
      () => handleStatistics(loaded),
      () => handleBackground(loaded),
      () => handleReliability(loaded),
      () => handleQuiz(loaded),
    ];
    prefetchRest.forEach((fn, i) => {
      setTimeout(fn, 300 + i * 350 + Math.floor(Math.random() * 150));
    });

    // 형광펜(원문 근거) 기능 첫 사용 안내 — source가 있는 결과가 있고, 아직 안 봤을 때 1회
    const hasSource = loaded.summary.keyFindings?.some((f) => f.source);
    if (
      hasSource &&
      typeof window !== "undefined" &&
      !localStorage.getItem(SOURCE_TIP_KEY)
    ) {
      setShowSourceTip(true);
    }
  }

  function closeSourceTip() {
    setShowSourceTip(false);
  }

  function neverShowSourceTip() {
    try {
      localStorage.setItem(SOURCE_TIP_KEY, "1");
    } catch {
      // localStorage 불가 환경 무시
    }
    setShowSourceTip(false);
  }

  function closeWelcome() {
    setShowWelcome(false);
  }

  function neverShowWelcome() {
    try {
      localStorage.setItem(WELCOME_KEY, "1");
    } catch {
      // localStorage 불가 환경 무시
    }
    setShowWelcome(false);
  }

  async function handleAnalyzePaper(queryOverride?: string) {
    const raw = (queryOverride ?? searchQuery).trim();
    if (!raw || paperLoading) return;

    setPaperLoading(true);
    setPaperError(null);

    try {
      const pubmedRes = await fetch("/api/pubmed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: raw }),
      });
      const pubmedData = await pubmedRes.json();
      if (!pubmedRes.ok) {
        throw new Error(pubmedData.error ?? "논문을 불러오지 못했습니다.");
      }
      await summarizeAndLoad(pubmedData as PubMedPaper);
    } catch (e) {
      setPaperError(e instanceof Error ? e.message : "알 수 없는 오류");
    } finally {
      setPaperLoading(false);
    }
  }

  async function handlePdfUpload(file: File) {
    if (paperLoading) return;

    setPaperLoading(true);
    setPaperError(null);

    try {
      const form = new FormData();
      form.append("file", file);

      const pdfRes = await fetch("/api/pdf", { method: "POST", body: form });
      const pdfData = await pdfRes.json();
      if (!pdfRes.ok) {
        throw new Error(pdfData.error ?? "PDF를 분석하지 못했습니다.");
      }
      // 업로드한 PDF를 좌측 원본에 그대로 띄우기 위해 object URL 생성
      const pdfUrl = URL.createObjectURL(file);
      await summarizeAndLoad(pdfData.paper as PubMedPaper, pdfUrl);
    } catch (e) {
      setPaperError(e instanceof Error ? e.message : "알 수 없는 오류");
    } finally {
      setPaperLoading(false);
    }
  }

  function acceptPdfFile(file: File | undefined | null) {
    if (!file) return;
    const isPdf =
      file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
    if (!isPdf) {
      setPaperError("PDF 파일만 업로드할 수 있습니다.");
      return;
    }
    handlePdfUpload(file);
  }

  async function handleTranslate(target: LoadedPaper) {
    if (target.translation || translateLoading) return;

    setTranslateLoading(true);
    setTranslateError(null);

    try {
      const res = await fetch("/api/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: target.paper.title,
          abstract: target.paper.abstract,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error ?? "번역 생성에 실패했습니다.");
      }

      const translation = data.translation as TranslationResult;
      setLoadedPaper((prev) =>
        prev && prev.paper.pmid === target.paper.pmid
          ? { ...prev, translation }
          : prev,
      );
      setRecentPapers((prev) =>
        prev.map((p) =>
          p.paper.pmid === target.paper.pmid ? { ...p, translation } : p,
        ),
      );
    } catch (e) {
      setTranslateError(e instanceof Error ? e.message : "알 수 없는 오류");
    } finally {
      setTranslateLoading(false);
    }
  }

  async function handleStatistics(target: LoadedPaper) {
    if (target.statistics || statsLoading) return;

    setStatsLoading(true);
    setStatsError(null);

    try {
      const summaryContext = target.summary
        ? `연구설계·방법: ${target.summary.methods}\n주요 결과: ${target.summary.results}\n핵심: ${target.summary.keyMessage}`
        : undefined;
      const res = await fetch("/api/stats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: target.paper.title,
          abstract: target.paper.abstract,
          fullText: target.paper.fullText,
          summaryContext,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error ?? "통계 해석 생성에 실패했습니다.");
      }

      const statistics = data.statistics as StatisticsResult;
      setLoadedPaper((prev) =>
        prev && prev.paper.pmid === target.paper.pmid
          ? { ...prev, statistics }
          : prev,
      );
      setRecentPapers((prev) =>
        prev.map((p) =>
          p.paper.pmid === target.paper.pmid ? { ...p, statistics } : p,
        ),
      );
    } catch (e) {
      setStatsError(e instanceof Error ? e.message : "알 수 없는 오류");
    } finally {
      setStatsLoading(false);
    }
  }

  async function handleBackground(target: LoadedPaper) {
    if (target.background || backgroundLoading) return;

    setBackgroundLoading(true);
    setBackgroundError(null);

    try {
      const res = await fetch("/api/background", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: target.paper.title,
          abstract: target.paper.abstract,
          fullText: target.paper.fullText,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error ?? "배경지식 생성에 실패했습니다.");
      }

      const background = data.background as BackgroundResult;
      setLoadedPaper((prev) =>
        prev && prev.paper.pmid === target.paper.pmid
          ? { ...prev, background }
          : prev,
      );
      setRecentPapers((prev) =>
        prev.map((p) =>
          p.paper.pmid === target.paper.pmid ? { ...p, background } : p,
        ),
      );
    } catch (e) {
      setBackgroundError(e instanceof Error ? e.message : "알 수 없는 오류");
    } finally {
      setBackgroundLoading(false);
    }
  }

  async function handleReliability(target: LoadedPaper) {
    if (target.reliability || reliabilityLoading) return;
    setReliabilityLoading(true);
    setReliabilityError(null);
    try {
      const res = await fetch("/api/reliability", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: target.paper.title,
          abstract: target.paper.abstract,
          journal: target.paper.journal,
          authors: target.paper.authors,
          pubdate: target.paper.pubdate,
          doi: target.paper.doi,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "신뢰도 분석에 실패했습니다.");
      const reliability = data.reliability as ReliabilityResult;
      setLoadedPaper((prev) =>
        prev && prev.paper.pmid === target.paper.pmid
          ? { ...prev, reliability }
          : prev,
      );
      setRecentPapers((prev) =>
        prev.map((p) =>
          p.paper.pmid === target.paper.pmid ? { ...p, reliability } : p,
        ),
      );
    } catch (e) {
      setReliabilityError(e instanceof Error ? e.message : "알 수 없는 오류");
    } finally {
      setReliabilityLoading(false);
    }
  }

  async function handleQuiz(target: LoadedPaper) {
    if (target.quiz || quizLoading) return;
    setQuizLoading(true);
    setQuizError(null);
    try {
      const res = await fetch("/api/quiz", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: target.paper.title,
          abstract: target.paper.abstract,
          fullText: target.paper.fullText,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "퀴즈 생성에 실패했습니다.");
      const quiz = data.quiz as QuizResult;
      setLoadedPaper((prev) =>
        prev && prev.paper.pmid === target.paper.pmid ? { ...prev, quiz } : prev,
      );
      setRecentPapers((prev) =>
        prev.map((p) =>
          p.paper.pmid === target.paper.pmid ? { ...p, quiz } : p,
        ),
      );
    } catch (e) {
      setQuizError(e instanceof Error ? e.message : "알 수 없는 오류");
    } finally {
      setQuizLoading(false);
    }
  }

  async function handleGuide(target: LoadedPaper) {
    if (target.guide || guideLoading) return;
    setGuideLoading(true);
    setGuideError(null);
    try {
      const res = await fetch("/api/reading-guide", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: target.paper.title,
          abstract: target.paper.abstract,
          fullText: target.paper.fullText,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "읽기 가이드 생성에 실패했습니다.");
      const guide = data.guide as ReadingGuideResult;
      setLoadedPaper((prev) =>
        prev && prev.paper.pmid === target.paper.pmid
          ? { ...prev, guide }
          : prev,
      );
      setRecentPapers((prev) =>
        prev.map((p) =>
          p.paper.pmid === target.paper.pmid ? { ...p, guide } : p,
        ),
      );
    } catch (e) {
      setGuideError(e instanceof Error ? e.message : "알 수 없는 오류");
    } finally {
      setGuideLoading(false);
    }
  }

  async function handleGenerateImage(
    target: LoadedPaper,
    providerOverride?: "gemini" | "openai" | "flux" | "ideogram",
  ) {
    if (geminiLoading) return;
    setGeminiLoading(true);
    setGeminiError(null);
    try {
      const res = await fetch("/api/visualize-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: providerOverride ?? imageProvider,
          title: target.paper.title,
          keyFindings: target.summary.keyFindings,
          methods: target.summary.methods,
          results: target.summary.results,
          conclusion: target.summary.conclusion,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "이미지 생성에 실패했습니다.");
      const geminiImage = data.image as string;
      setLoadedPaper((prev) =>
        prev && prev.paper.pmid === target.paper.pmid
          ? { ...prev, geminiImage }
          : prev,
      );
      setRecentPapers((prev) =>
        prev.map((p) =>
          p.paper.pmid === target.paper.pmid ? { ...p, geminiImage } : p,
        ),
      );
    } catch (e) {
      setGeminiError(e instanceof Error ? e.message : "알 수 없는 오류");
    } finally {
      setGeminiLoading(false);
    }
  }

  // 발표 슬라이드(.pptx) 생성·다운로드. compose=요약 그대로 조립, llm=AI 재구성.
  async function downloadSlides(mode: "compose" | "llm") {
    if (!loadedPaper || slidesMode) return;
    setSlidesMode(mode);
    setSlidesError(null);
    setSlidesResult(null);
    try {
      const res = await fetch("/api/slides", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode,
          paper: loadedPaper.paper,
          summary: loadedPaper.summary,
          statistics: loadedPaper.statistics ?? null,
          background: loadedPaper.background ?? null,
          // 추가 요구사항은 AI 재구성(llm) 모드에만 반영
          requirements: mode === "llm" ? slidesRequirements.trim() : undefined,
        }),
      });
      if (!res.ok) {
        let msg = "슬라이드 생성에 실패했습니다.";
        try {
          msg = (await res.json()).error ?? msg;
        } catch {
          // 본문 파싱 실패 무시
        }
        throw new Error(msg);
      }
      const slideCount = Number(res.headers.get("X-Slide-Count")) || 0;
      const figCount = Number(res.headers.get("X-Figure-Count")) || 0;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const cd = res.headers.get("Content-Disposition") ?? "";
      const m = /filename\*=UTF-8''([^;]+)/.exec(cd);
      a.download = m
        ? decodeURIComponent(m[1])
        : `발표슬라이드_${mode === "llm" ? "AI재구성" : "요약조립"}.pptx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setSlidesResult({ mode, slides: slideCount, figures: figCount });
    } catch (e) {
      setSlidesError(e instanceof Error ? e.message : "알 수 없는 오류");
    } finally {
      setSlidesMode(null);
    }
  }

  function handleTabChange(tab: RightTab) {
    setActiveTab(tab);
    if (tab === "translate" && loadedPaper && !loadedPaper.translation) {
      handleTranslate(loadedPaper);
    }
    if (tab === "stats" && loadedPaper && !loadedPaper.statistics) {
      handleStatistics(loadedPaper);
    }
    if (tab === "background" && loadedPaper && !loadedPaper.background) {
      handleBackground(loadedPaper);
    }
    if (tab === "reliability" && loadedPaper && !loadedPaper.reliability) {
      handleReliability(loadedPaper);
    }
    if (tab === "quiz" && loadedPaper && !loadedPaper.quiz) {
      handleQuiz(loadedPaper);
    }
    if (tab === "guide" && loadedPaper && !loadedPaper.guide) {
      handleGuide(loadedPaper);
    }
  }

  async function handleSendMessage() {
    const trimmed = chatInput.trim();
    if (!trimmed || isLoading) return;

    const userMessage: ChatMessage = { role: "user", text: trimmed };
    setChatHistory((prev) => [...prev, userMessage]);
    setChatInput("");
    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: trimmed,
          paper: loadedPaper?.paper ?? null,
          history: chatHistory,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error ?? "API 호출 실패");
      }

      setChatHistory((prev) => [
        ...prev,
        { role: "assistant", text: data.text },
      ]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "알 수 없는 오류");
    } finally {
      setIsLoading(false);
    }
  }

  // 용어 호버 툴팁 표시 (좌표는 호버한 요소 기준, 화면 밖으로 안 나가게 보정)
  function showTermTip(term: MedicalTerm | null, el: HTMLElement | null) {
    if (!term || !el) {
      setTermTip(null);
      return;
    }
    const r = el.getBoundingClientRect();
    const x = Math.min(Math.max(r.left + r.width / 2, 140), window.innerWidth - 140);
    setTermTip({ term, x, y: r.bottom + 6 });
  }

  const activeTerms = loadedPaper?.translation?.terms ?? [];

  // 좌측 원문: 형광펜 강조 + 용어 호버를 함께 렌더
  function renderOriginal(text: string) {
    if (!text) return text;
    return renderRich(text, {
      terms: activeTerms,
      highlight,
      onTip: showTermTip,
      markRef,
    });
  }

  // 전체 본문 렌더: @@FIG:n@@ 마커 위치에 논문 그림(이미지+캡션)을 끼워 넣는다.
  function renderBodyWithFigures(text: string, figures: Figure[]) {
    const parts = text.split(/@@FIG:(\d+)@@/);
    const nodes: ReactNode[] = [];
    for (let i = 0; i < parts.length; i++) {
      if (i % 2 === 0) {
        const seg = parts[i];
        if (seg.trim()) {
          nodes.push(
            <p
              key={`t${i}`}
              className="whitespace-pre-wrap text-sm leading-relaxed text-zinc-700"
            >
              {renderOriginal(seg)}
            </p>,
          );
        }
      } else {
        const fig = figures[Number(parts[i])];
        if (fig && (fig.srcs.length > 0 || fig.caption)) {
          nodes.push(
            <figure key={`f${i}`} className="my-3 space-y-2">
              {fig.srcs.map((src, k) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={k}
                  src={src}
                  alt={fig.label || "figure"}
                  loading="lazy"
                  className="w-full rounded-md border border-zinc-200"
                />
              ))}
              {(fig.label || fig.caption) && (
                <figcaption className="mt-1 text-[11px] leading-relaxed text-zinc-500">
                  {fig.label && (
                    <span className="font-semibold text-zinc-600">
                      {fig.label}.{" "}
                    </span>
                  )}
                  {fig.caption}
                </figcaption>
              )}
            </figure>,
          );
        }
      }
    }
    return nodes;
  }

  // 중앙 요약: 용어 호버만 렌더
  function renderSummaryText(text: string) {
    if (!text) return text;
    return renderRich(text, { terms: activeTerms, onTip: showTermTip });
  }

  function toggleHighlight(source: string | undefined) {
    if (!source) return;
    setHighlight((prev) => (prev === source ? null : source));
    setSearchOpen(false);
    // 형광펜은 PDF·텍스트 양쪽 모드에서 동작하므로 현재 보기를 강제 전환하지 않는다
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-slate-100 text-slate-800">
      {termTip && (
        <div
          className="pointer-events-none fixed z-50 w-64 -translate-x-1/2 rounded-lg border border-zinc-200 bg-white p-3 text-left shadow-xl"
          style={{ left: termTip.x, top: termTip.y }}
        >
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="text-sm font-semibold text-zinc-900">
              {termTip.term.korean}
            </span>
            <span className="text-xs italic text-zinc-500">
              {termTip.term.english}
            </span>
            <span
              className={`rounded px-1 py-0.5 text-[10px] font-semibold ${
                termTip.term.difficulty === "상"
                  ? "bg-amber-100 text-amber-700"
                  : "bg-zinc-100 text-zinc-500"
              }`}
            >
              {termTip.term.difficulty}
            </span>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-zinc-700">
            {termTip.term.explanation}
          </p>
        </div>
      )}
      {explainPopup && (
        <div
          className="fixed z-50 w-72 -translate-x-1/2 rounded-lg border border-zinc-200 bg-white p-3 shadow-xl"
          style={{ left: explainPopup.x, top: explainPopup.y }}
        >
          <div className="mb-1 flex items-start justify-between gap-2">
            <span className="break-words text-sm font-semibold text-zinc-900">
              “{explainPopup.term}”
            </span>
            <button
              onClick={() => setExplainPopup(null)}
              className="shrink-0 text-xs text-zinc-400 hover:text-zinc-600"
              aria-label="닫기"
            >
              ✕
            </button>
          </div>
          {explainPopup.loading ? (
            <div className="animate-pulse py-1 text-xs text-zinc-400">
              해설 생성 중...
            </div>
          ) : explainPopup.error ? (
            <div className="text-xs text-red-600">{explainPopup.error}</div>
          ) : (
            <p className="whitespace-pre-wrap text-xs leading-relaxed text-zinc-700">
              {explainPopup.text}
            </p>
          )}
        </div>
      )}
      {showWelcome && (
        <Onboarding onClose={closeWelcome} onNeverShow={neverShowWelcome} />
      )}
      {showSourceTip && (
        <FeatureTip
          title="🖍 원문 근거 보기"
          badge="새 기능"
          onClose={closeSourceTip}
          onNeverShow={neverShowSourceTip}
        >
          <p>
            가운데 <span className="font-semibold text-zinc-800">핵심 결과</span>{" "}
            항목을 누르면, 그 내용이 왼쪽 <span className="font-semibold text-zinc-800">논문 원본</span>의
            어느 문장에서 나왔는지 <span className="rounded bg-yellow-200 px-1 text-zinc-900">형광펜</span>으로
            표시되고 그 위치로 이동합니다.
          </p>
          <p className="text-[13px] text-zinc-500">
            요약이 본문 어디에 근거하는지 바로 확인하면서 읽어 보세요.
          </p>
        </FeatureTip>
      )}

      {/* ── 상단 브랜딩 헤더 ───────────────────────────────────── */}
      <header className="shrink-0 z-20 flex items-center gap-3 border-b-2 border-blue-900/15 bg-white px-5 py-2.5">
        <div className="flex items-center gap-3">
          {/* PM 책 로고 */}
          <svg
            viewBox="0 0 44 44"
            className="h-10 w-10 shrink-0"
            aria-hidden
          >
            <defs>
              <linearGradient id="pmGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#2dd4bf" />
                <stop offset="48%" stopColor="#3b82f6" />
                <stop offset="100%" stopColor="#1e3a8a" />
              </linearGradient>
            </defs>
            {/* 펼친 책 — 좌/우 페이지 */}
            <path
              d="M22 12.5c-4-2.6-10-2.6-15-1v22c5-1.6 11-1.6 15 1z"
              fill="url(#pmGrad)"
            />
            <path
              d="M22 12.5c4-2.6 10-2.6 15-1v22c-5-1.6-11-1.6-15 1z"
              fill="url(#pmGrad)"
              opacity="0.88"
            />
            <line x1="22" y1="12.8" x2="22" y2="34.2" stroke="#fff" strokeWidth="1" opacity="0.45" />
            {/* PM 모노그램 */}
            <text x="14.2" y="27.5" textAnchor="middle" fontSize="11.5" fontWeight="800" fill="#fff">P</text>
            <text x="29.8" y="27.5" textAnchor="middle" fontSize="11.5" fontWeight="800" fill="#fff">M</text>
          </svg>
          <div className="leading-tight">
            <div className="flex items-baseline gap-1.5">
              <span className="text-[17px] font-extrabold tracking-tight text-[#1e3a8a]">
                PAPERMENTOR
              </span>
              <span className="rounded bg-blue-50 px-1.5 py-px text-[10px] font-semibold text-blue-600">
                beta
              </span>
            </div>
            <div className="hidden text-[11px] tracking-tight text-slate-400 sm:block">
              의학 논문 학습 지원 플랫폼
            </div>
          </div>
        </div>

        {/* 우측: 글자 크기 조절 + 로그인 상태 */}
        <div className="ml-auto flex items-center gap-3">
          <div className="flex items-center gap-2">
          <span className="hidden text-[11px] text-slate-400 sm:inline">
            글자 크기
          </span>
          <div className="flex items-center rounded-lg border border-slate-200 bg-white p-0.5">
            <button
              onClick={() => setFontScale((s) => Math.max(FONT_MIN, s - 1))}
              disabled={fontScale <= FONT_MIN}
              aria-label="글자 작게"
              className="flex h-7 w-7 items-center justify-center rounded-md text-[15px] text-slate-500 transition-colors hover:bg-slate-100 disabled:opacity-30"
            >
              −
            </button>
            <button
              onClick={() => setFontScale(FONT_DEFAULT)}
              title="기본 크기로 되돌리기"
              className="min-w-[44px] px-1 text-center text-[12px] font-medium tabular-nums text-slate-600 hover:text-blue-600"
            >
              {Math.round((fontScale / FONT_DEFAULT) * 100)}%
            </button>
            <button
              onClick={() => setFontScale((s) => Math.min(FONT_MAX, s + 1))}
              disabled={fontScale >= FONT_MAX}
              aria-label="글자 크게"
              className="flex h-7 w-7 items-center justify-center rounded-md text-[18px] text-slate-500 transition-colors hover:bg-slate-100 disabled:opacity-30"
            >
              +
            </button>
          </div>
          </div>
          <a
            href="/community"
            className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-[12px] font-semibold text-blue-700 shadow-sm transition-colors hover:border-blue-300 hover:bg-blue-100"
          >
            이용후기
          </a>
          <AuthStatus />
        </div>
      </header>

      {/* ── 본문 3분할 ─────────────────────────────────────────── */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
      <aside
        style={{ width: leftW }}
        className={`shrink-0 border-r border-slate-200 bg-slate-50 flex flex-col overflow-hidden min-h-0 max-lg:!w-full max-lg:border-r-0 ${
          mobileView === "original" ? "" : "max-lg:hidden"
        }`}
      >
        {/* 접이식: 논문 검색 · 최근 분석 (논문 로드 시 접힘) */}
        <div className="shrink-0 border-b border-zinc-200">
          <button
            onClick={() => setSearchOpen((o) => !o)}
            className="flex w-full items-center justify-between px-4 py-3 transition-colors hover:bg-zinc-50"
          >
            <span className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-zinc-500">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.7}
                stroke="currentColor"
                className="h-4 w-4"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"
                />
              </svg>
              논문 검색 · 새 논문
              {recentPapers.length > 0 && (
                <span className="rounded-full bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium normal-case text-zinc-500">
                  최근 {recentPapers.length}
                </span>
              )}
            </span>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2}
              stroke="currentColor"
              className={`h-4 w-4 text-zinc-400 transition-transform ${
                searchOpen ? "rotate-180" : ""
              }`}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
            </svg>
          </button>

          {searchOpen && (
            <div className="px-4 pb-4">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleAnalyzePaper();
                  }
                }}
                placeholder="PubMed ID · DOI · PMCID"
                disabled={paperLoading}
                className="w-full px-3 py-2 text-sm border border-zinc-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-zinc-100"
              />
              <button
                onClick={() => handleAnalyzePaper()}
                disabled={paperLoading || !searchQuery.trim()}
                className="mt-2 w-full px-3 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 disabled:bg-zinc-300 disabled:cursor-not-allowed transition-colors"
              >
                {paperLoading ? "분석 중..." : "분석"}
              </button>

              <div className="mt-3 flex items-center gap-2">
                <div className="flex-1 h-px bg-zinc-200" />
                <span className="text-xs text-zinc-400">또는</span>
                <div className="flex-1 h-px bg-zinc-200" />
              </div>

              <label
                onDragOver={(e) => {
                  e.preventDefault();
                  if (!paperLoading) setIsDragging(true);
                }}
                onDragLeave={(e) => {
                  e.preventDefault();
                  setIsDragging(false);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  setIsDragging(false);
                  if (paperLoading) return;
                  acceptPdfFile(e.dataTransfer.files?.[0]);
                }}
                className={`mt-3 flex flex-col items-center justify-center gap-1 w-full px-3 py-4 border border-dashed rounded-md text-sm transition-colors ${
                  paperLoading
                    ? "cursor-not-allowed opacity-60 border-zinc-300 text-zinc-600"
                    : isDragging
                      ? "cursor-copy border-blue-500 bg-blue-50 text-blue-700"
                      : "cursor-pointer border-zinc-300 text-zinc-600 hover:bg-zinc-50 hover:border-blue-400"
                }`}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={1.5}
                  stroke="currentColor"
                  className="w-5 h-5"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5"
                  />
                </svg>
                <span className="font-medium">
                  {isDragging ? "여기에 놓으세요" : "PDF 업로드"}
                </span>
                <span className="text-xs text-zinc-400">
                  클릭하거나 파일을 끌어다 놓기
                </span>
                <input
                  type="file"
                  accept="application/pdf"
                  disabled={paperLoading}
                  className="hidden"
                  onChange={(e) => {
                    acceptPdfFile(e.target.files?.[0]);
                    e.target.value = "";
                  }}
                />
              </label>

              {paperError && (
                <div className="mt-2 bg-red-50 border border-red-200 text-red-700 rounded-md p-2 text-xs">
                  {paperError}
                </div>
              )}

              {recentPapers.length > 0 && (
                <div className="mt-4">
                  <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-2">
                    최근 분석 논문
                  </h3>
                  <ul className="space-y-2">
                    {recentPapers.map((item) => (
                      <li key={item.paper.pmid}>
                        <button
                          onClick={() => {
                            setLoadedPaper(item);
                            setChatHistory([]);
                            setQuizAnswers({});
                            setActiveTab("guide");
                            setSearchOpen(false);
                            setOriginalView(item.pdfUrl ? "pdf" : "text");
                            if (!item.geminiImage) {
                              handleGenerateImage(item, "gemini");
                            }
                            if (!item.translation) {
                              handleTranslate(item);
                            }
                          }}
                          className={`w-full text-left p-2 text-sm rounded-md transition-colors ${
                            loadedPaper?.paper.pmid === item.paper.pmid
                              ? "bg-blue-50 text-blue-900 border border-blue-200"
                              : "hover:bg-zinc-100 text-zinc-700"
                          }`}
                        >
                          <div className="font-medium line-clamp-2">
                            {item.paper.title}
                          </div>
                          <div className="text-xs text-zinc-500 mt-1">
                            PMID: {item.paper.pmid}
                          </div>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>

        {/* 논문 원본 */}
        <div className="flex-1 min-h-0 flex flex-col">
          {loadedPaper ? (
            <>
              <div className="shrink-0 flex items-center justify-between gap-2 px-4 pt-4 pb-2">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
                  논문 원본
                </span>
                {loadedPaper.pdfUrl && (
                  <div className="flex rounded-md border border-zinc-200 p-0.5 text-[11px] font-medium">
                    {(
                      [
                        ["pdf", "📄 PDF"],
                        ["text", "📝 텍스트"],
                      ] as const
                    ).map(([key, label]) => (
                      <button
                        key={key}
                        onClick={() => setOriginalView(key)}
                        className={`rounded px-2 py-0.5 transition-colors ${
                          originalView === key
                            ? "bg-blue-600 text-white"
                            : "text-zinc-500 hover:text-zinc-700"
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {loadedPaper.pdfUrl && originalView === "pdf" ? (
                <PdfViewer url={loadedPaper.pdfUrl} highlight={highlight} />
              ) : (
                <div
                  className="flex-1 min-h-0 overflow-y-auto px-4 pb-4"
                  data-explain
                >
                  <article>
                    <h1 className="text-base font-semibold leading-snug text-zinc-900">
                      {loadedPaper.paper.title}
                    </h1>
                    <div className="mt-1.5 space-y-0.5 text-xs text-zinc-500">
                      {loadedPaper.paper.journal && (
                        <div>
                          {loadedPaper.paper.journal}
                          {loadedPaper.paper.pubdate
                            ? ` · ${loadedPaper.paper.pubdate}`
                            : ""}
                        </div>
                      )}
                      {loadedPaper.paper.authors?.length > 0 && (
                        <div className="line-clamp-2">
                          {loadedPaper.paper.authors.slice(0, 8).join(", ")}
                          {loadedPaper.paper.authors.length > 8
                            ? ` 외 ${loadedPaper.paper.authors.length - 8}명`
                            : ""}
                        </div>
                      )}
                      <div className="flex flex-wrap gap-x-3 pt-0.5">
                        {loadedPaper.paper.pmid && (
                          <span>PMID: {loadedPaper.paper.pmid}</span>
                        )}
                        {loadedPaper.paper.doi && (
                          <a
                            href={`https://doi.org/${loadedPaper.paper.doi}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-600 underline hover:text-blue-700"
                          >
                            DOI 원문 ↗
                          </a>
                        )}
                      </div>
                    </div>

                    {loadedPaper.pdfUrl && (
                      <p className="mt-2 rounded-md bg-amber-50 px-2 py-1 text-[11px] text-amber-700">
                        텍스트 모드는 AI가 추출한 발췌본입니다. 정확한 원문·그림은 📄 PDF 모드로 보세요.
                      </p>
                    )}

                    <div className="mt-4">
                      <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
                        초록 (Abstract)
                      </div>
                      <p className="whitespace-pre-wrap text-sm leading-relaxed text-zinc-700">
                        {loadedPaper.paper.abstract
                          ? renderOriginal(loadedPaper.paper.abstract)
                          : "초록이 제공되지 않았습니다."}
                      </p>
                    </div>

                    {loadedPaper.paper.bodyText ? (
                      <div className="mt-4 border-t border-zinc-100 pt-4">
                        <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
                          본문 (Full text)
                        </div>
                        <div className="space-y-1">
                          {renderBodyWithFigures(
                            loadedPaper.paper.bodyText,
                            loadedPaper.paper.figures ?? [],
                          )}
                        </div>
                      </div>
                    ) : loadedPaper.paper.fullText ? (
                      <div className="mt-4 border-t border-zinc-100 pt-4">
                        <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
                          본문 핵심 발췌
                        </div>
                        <p className="whitespace-pre-wrap text-sm leading-relaxed text-zinc-700">
                          {renderOriginal(loadedPaper.paper.fullText)}
                        </p>
                      </div>
                    ) : (
                      <p className="mt-4 border-t border-zinc-100 pt-4 text-xs text-zinc-400">
                        본문 전문은 제공되지 않았습니다. (초록 기준으로 분석합니다)
                      </p>
                    )}
                  </article>
                </div>
              )}
            </>
          ) : (
            <div className="mt-8 px-6 text-center text-sm text-zinc-400">
              <p>논문 원본</p>
              <p className="mt-2 text-xs leading-relaxed">
                위에서 PubMed ID·DOI·PMCID로 검색하거나 PDF를 올리면
                <br />
                원문이 여기에 표시됩니다.
              </p>
            </div>
          )}
        </div>
      </aside>

      <div
        onMouseDown={() => startResize("left")}
        className="w-1.5 shrink-0 cursor-col-resize bg-zinc-200 hover:bg-blue-400 active:bg-blue-500 transition-colors max-lg:hidden"
        title="드래그하여 너비 조절"
      />

      <main
        className={`flex-1 min-w-0 flex flex-col bg-white overflow-hidden ${
          mobileView === "summary" ? "" : "max-lg:hidden"
        }`}
      >
        <div className="p-6 border-b border-zinc-200">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-zinc-500 uppercase tracking-wide">
              논문 요약
            </h2>
            <div className="flex shrink-0 items-center gap-1.5">
              <button
                onClick={() => {
                  setExplainMode((m) => !m);
                  setExplainPopup(null);
                }}
                className={`flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                  explainMode
                    ? "border-blue-600 bg-blue-600 text-white"
                    : "border-zinc-200 text-zinc-500 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-600"
                }`}
                title="켜면 모르는 단어를 탭(데스크톱은 드래그)할 때 해설이 나옵니다"
              >
                용어 해설 {explainMode ? "ON" : "OFF"}
              </button>
              <button
                onClick={() => setShowWelcome(true)}
                className="flex items-center gap-1 rounded-full border border-zinc-200 px-2.5 py-1 text-[11px] font-medium text-zinc-500 transition-colors hover:border-blue-300 hover:bg-blue-50 hover:text-blue-600"
                title="사용 안내 다시 보기"
              >
                <span className="text-sm leading-none">?</span> 사용 안내
              </button>
            </div>
          </div>
          {loadedPaper && (
            <div className="mt-2">
              <div className="flex items-start justify-between gap-3">
                <h1 className="text-lg font-semibold text-zinc-900 leading-snug">
                  {loadedPaper.paper.title}
                </h1>
                {user && (
                  <button
                    onClick={toggleBookmark}
                    disabled={bookmarkBusy}
                    title={bookmarked ? "내 서재에서 빼기" : "내 서재에 저장"}
                    className={`shrink-0 inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12px] font-medium transition-colors disabled:opacity-50 ${
                      bookmarked
                        ? "border-blue-200 bg-blue-50 text-blue-600"
                        : "border-slate-200 bg-white text-slate-500 hover:border-blue-300 hover:text-blue-600"
                    }`}
                  >
                    <svg
                      viewBox="0 0 24 24"
                      className="h-3.5 w-3.5"
                      fill={bookmarked ? "currentColor" : "none"}
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <path
                        d="M6 4h12a1 1 0 0 1 1 1v15l-7-4-7 4V5a1 1 0 0 1 1-1z"
                        strokeLinejoin="round"
                      />
                    </svg>
                    {bookmarked ? "저장됨" : "저장"}
                  </button>
                )}
              </div>
              <p className="text-xs text-zinc-500 mt-1">
                {loadedPaper.paper.journal}
                {loadedPaper.paper.pubdate &&
                  ` · ${loadedPaper.paper.pubdate}`}
                {` · PMID ${loadedPaper.paper.pmid}`}
                {loadedPaper.paper.doi && ` · DOI ${loadedPaper.paper.doi}`}
              </p>
              {loadedPaper.paper.authors.length > 0 && (
                <p className="text-xs text-zinc-500 mt-1 line-clamp-1">
                  {loadedPaper.paper.authors.slice(0, 6).join(", ")}
                  {loadedPaper.paper.authors.length > 6 && " 외"}
                </p>
              )}
            </div>
          )}
        </div>
        <div className="flex-1 overflow-y-auto bg-slate-50/60 p-6" data-explain>
          {explainMode && loadedPaper && (
            <div className="mb-4 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-700">
              용어 해설 모드 — 요약이나 왼쪽 원문에서 <b>모르는 단어를 탭</b>하면 (데스크톱은 구절을 드래그해도) 해설이 떠요.
            </div>
          )}
          {paperLoading ? (
            <div className="flex flex-col items-center justify-center h-full text-zinc-400 gap-2">
              <div className="animate-pulse text-sm">
                논문을 불러오고 Claude로 요약 중입니다...
              </div>
            </div>
          ) : loadedPaper ? (
            <div className="space-y-6">
              {/* 시각화 요약 (Graphical Abstract) — 분석 직후 Gemini로 자동 생성 */}
              <section>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <h3 className="text-base font-semibold">
                    시각화 요약 (Graphical Abstract)
                  </h3>
                  {(loadedPaper.geminiImage || geminiError) && !geminiLoading && (
                    <button
                      onClick={() => handleGenerateImage(loadedPaper, "gemini")}
                      className="rounded-md border border-zinc-200 px-2.5 py-1 text-[11px] font-medium text-zinc-500 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-600"
                    >
                      다시 생성
                    </button>
                  )}
                </div>
                {geminiLoading ? (
                  <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-zinc-200 bg-zinc-50 py-10 text-sm text-zinc-400">
                    <div className="animate-pulse">
                      핵심 내용을 한 장의 그림으로 만드는 중입니다...
                    </div>
                    <div className="text-xs">(수십 초 소요)</div>
                  </div>
                ) : geminiError ? (
                  <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                    <div className="mb-1 font-medium">
                      시각화 이미지 생성에 실패했습니다.
                    </div>
                    <div className="mb-2 text-xs">{geminiError}</div>
                    <button
                      onClick={() => handleGenerateImage(loadedPaper, "gemini")}
                      className="text-xs underline hover:text-red-800"
                    >
                      다시 시도
                    </button>
                  </div>
                ) : loadedPaper.geminiImage ? (
                  <div className="space-y-2">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={loadedPaper.geminiImage}
                      alt="시각화 요약 (graphical abstract)"
                      className="w-full rounded-xl border border-zinc-200"
                    />
                    <div className="flex items-center justify-between">
                      <a
                        href={loadedPaper.geminiImage}
                        download="graphical-abstract.png"
                        className="text-[11px] text-blue-600 underline hover:text-blue-700"
                      >
                        이미지 저장
                      </a>
                      <span className="text-[10px] text-amber-600">
                        ⚠ 차트·수치·이미지는 AI 생성물 — 원문과 대조 검증 필요
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-2 rounded-xl border border-dashed border-zinc-200 bg-zinc-50 p-3">
                    <span className="text-xs text-zinc-400">
                      핵심 내용을 한눈에 보는 시각화 요약을 만들 수 있어요.
                    </span>
                    <button
                      onClick={() => handleGenerateImage(loadedPaper, "gemini")}
                      className="shrink-0 rounded-md bg-zinc-900 px-3 py-1.5 text-[11px] font-medium text-white hover:bg-zinc-700"
                    >
                      이미지 생성
                    </button>
                  </div>
                )}
              </section>

              {loadedPaper.summary.keyFindings?.length > 0 && (
                <section className="rounded-xl border border-blue-200/70 bg-blue-50/50 p-4">
                  <div className="mb-3 flex items-center gap-2">
                    <span className="h-4 w-1 rounded-full bg-blue-500" />
                    <h3 className="text-[15px] font-semibold text-slate-900">
                      핵심 결과
                    </h3>
                    <span className="text-[11px] text-slate-400">
                      클릭하면 원문에 형광펜
                    </span>
                  </div>
                  <ul className="space-y-2">
                    {loadedPaper.summary.keyFindings.map((f, idx) => {
                      const active = !!f.source && highlight === f.source;
                      return (
                        <li
                          key={idx}
                          onClick={() => {
                            // 텍스트를 드래그(선택)한 경우엔 강조 토글하지 않음
                            if (!window.getSelection()?.isCollapsed) return;
                            toggleHighlight(f.source);
                          }}
                          className={`rounded-lg border border-l-4 p-3 transition-colors ${
                            f.source ? "cursor-pointer" : ""
                          } ${
                            active
                              ? "border-yellow-400 border-l-yellow-400 bg-yellow-50 ring-1 ring-yellow-300"
                              : "border-slate-200 border-l-blue-500 bg-white hover:bg-blue-50/40"
                          }`}
                        >
                          <p className="text-sm font-semibold text-zinc-900 mb-1">
                            {renderSummaryText(f.claim)}
                          </p>
                          <p className="text-xs text-zinc-700 leading-relaxed">
                            <span className="font-semibold text-zinc-600">
                              근거:{" "}
                            </span>
                            {renderSummaryText(f.evidence)}
                          </p>
                          {f.source && (
                            <div
                              className={`mt-1.5 inline-flex items-center gap-1 text-[11px] font-medium ${
                                active ? "text-yellow-700" : "text-blue-600"
                              }`}
                            >
                              🖍 {active ? "원문에서 강조 중 (눌러서 해제)" : "원문에서 보기"}
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </section>
              )}
              <SummarySection
                title="연구 배경"
                body={loadedPaper.summary.background}
                tone="sky"
                render={renderSummaryText}
              />
              <SummarySection
                title="연구 방법"
                body={loadedPaper.summary.methods}
                tone="teal"
                render={renderSummaryText}
              />
              <SummarySection
                title="주요 결과"
                body={loadedPaper.summary.results}
                tone="indigo"
                render={renderSummaryText}
              />
              <SummarySection
                title="결론"
                body={loadedPaper.summary.conclusion}
                tone="emerald"
                render={renderSummaryText}
              />
              <SummarySection
                title="핵심 메시지"
                body={loadedPaper.summary.keyMessage}
                tone="amber"
                render={renderSummaryText}
              />
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-zinc-400">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.5}
                stroke="currentColor"
                className="w-16 h-16 mb-4"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z"
                />
              </svg>
              <p className="text-sm">좌측에 PubMed ID · DOI · PMCID를 입력하세요</p>
              <p className="text-xs mt-1 text-zinc-400">
                예) PMID: 37291234 / DOI: 10.1056/NEJMoa2034577 / PMCID: PMC10250308
              </p>
            </div>
          )}
        </div>
      </main>

      {SHOW_RIGHT_PANEL && (
        <>
          <div
            onMouseDown={() => startResize("right")}
            className="w-1.5 shrink-0 cursor-col-resize bg-zinc-200 hover:bg-blue-400 active:bg-blue-500 transition-colors max-lg:hidden"
            title="드래그하여 너비 조절"
          />

          <aside
            style={{ width: rightW }}
            className={`shrink-0 border-l border-slate-200 bg-slate-50 flex flex-col overflow-hidden max-lg:!w-full max-lg:border-l-0 ${
              mobileView === "tools" ? "" : "max-lg:hidden"
            }`}
          >
        <div className="border-b border-slate-200 bg-slate-50/60">
          <div className="flex overflow-x-auto scrollbar-none px-1 pt-1.5">
            {(
              [
                { key: "guide", label: "읽기 가이드" },
                { key: "background", label: "배경지식" },
                { key: "stats", label: "통계 해석" },
                { key: "quiz", label: "퀴즈" },
                { key: "qa", label: "Q&A" },
                { key: "slides", label: "발표 슬라이드" },
                // 시각화 → 중앙으로 이동, 신뢰도·의학용어 해석 → 일시 비활성화 (코드/탭 렌더는 아래 보존)
              ] as { key: RightTab; label: string }[]
            ).map(({ key, label }) => (
              <button
                key={key}
                onClick={() => handleTabChange(key)}
                disabled={!loadedPaper}
                className={`shrink-0 whitespace-nowrap rounded-t-lg px-2 py-2 text-[12px] font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                  activeTab === key
                    ? "bg-white text-blue-600 shadow-[0_-2px_0_inset_rgba(37,99,235,1)]"
                    : "text-slate-600 hover:bg-white/60 hover:text-slate-800"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {activeTab === "qa" && (
          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {chatHistory.length === 0 && !error && (
                <div className="text-center text-sm text-slate-400 mt-14 px-6">
                  {loadedPaper ? (
                    <>
                      <p className="mb-2 font-medium text-zinc-500">논문 QA</p>
                      <p className="text-xs">
                        논문 내용에 대해 질문하세요.
                        <br />
                        논문에 없는 내용은 &quot;이 논문에 없습니다&quot;로 답변합니다.
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="mb-2">논문을 먼저 불러오세요</p>
                      <p className="text-xs">
                        논문 로드 후 해당 논문에 대해 질문할 수 있습니다.
                      </p>
                    </>
                  )}
                </div>
              )}
              {chatHistory.map((msg, idx) => (
                <div
                  key={idx}
                  className={`flex ${
                    msg.role === "user" ? "justify-end" : "justify-start"
                  }`}
                >
                  <div
                    className={`max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap ${
                      msg.role === "user"
                        ? "bg-blue-600 text-white"
                        : "bg-zinc-100 text-zinc-900"
                    }`}
                  >
                    {msg.text}
                  </div>
                </div>
              ))}
              {isLoading && (
                <div className="flex justify-start">
                  <div className="bg-zinc-100 text-zinc-500 rounded-lg px-3 py-2 text-sm">
                    응답 생성 중...
                  </div>
                </div>
              )}
              {error && (
                <div className="bg-red-50 border border-red-200 text-red-700 rounded-md p-3 text-sm">
                  <div className="font-medium mb-1">오류</div>
                  <div className="text-xs">{error}</div>
                </div>
              )}
            </div>
            <div className="border-t border-zinc-200 p-3">
              <div className="flex gap-2">
                <textarea
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleSendMessage();
                    }
                  }}
                  placeholder={loadedPaper ? "논문에 대해 질문하기 (Enter 전송)" : "논문을 먼저 불러오세요"}
                  rows={2}
                  className="flex-1 px-3 py-2 text-sm border border-zinc-300 rounded-md resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  disabled={isLoading}
                />
                <button
                  onClick={handleSendMessage}
                  disabled={isLoading || !chatInput.trim()}
                  className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 disabled:bg-zinc-300 disabled:cursor-not-allowed transition-colors"
                >
                  전송
                </button>
              </div>
            </div>
          </div>
        )}

        {activeTab === "stats" && (
          <div className="flex-1 overflow-y-auto p-4">
            {!loadedPaper ? (
              <div className="text-center text-sm text-slate-400 mt-14 px-6">
                <p>통계 해석 탭</p>
                <p className="text-xs mt-2">
                  좌측에서 논문을 먼저 분석하세요
                </p>
              </div>
            ) : statsLoading ? (
              <div className="text-center text-sm text-slate-400 mt-14 px-6 animate-pulse">
                통계 수치 해석 중입니다...
              </div>
            ) : statsError ? (
              <div className="bg-red-50 border border-red-200 text-red-700 rounded-md p-3 text-sm">
                <div className="font-medium mb-1">오류</div>
                <div className="text-xs mb-2">{statsError}</div>
                <button
                  onClick={() => handleStatistics(loadedPaper)}
                  className="text-xs underline text-red-600 hover:text-red-700"
                >
                  다시 시도
                </button>
              </div>
            ) : loadedPaper.statistics ? (
              <div className="space-y-6">
                {loadedPaper.statistics.items.length > 0 ? (
                  <section>
                    <h3 className="text-sm font-semibold text-zinc-500 uppercase tracking-wide mb-3">
                      통계 수치
                    </h3>
                    <ul className="space-y-3">
                      {loadedPaper.statistics.items.map((item, idx) => (
                        <li
                          key={`${item.metric}-${idx}`}
                          className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
                        >
                          <div className="flex items-baseline gap-2 flex-wrap mb-2">
                            <span
                              className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                                item.importance === "핵심"
                                  ? "bg-blue-100 text-blue-700"
                                  : "bg-zinc-100 text-zinc-500"
                              }`}
                            >
                              {item.importance}
                            </span>
                            <span className="text-xs font-semibold text-blue-700 uppercase tracking-wide">
                              {item.metric}
                            </span>
                            <span className="font-mono text-sm text-zinc-900">
                              {item.value}
                            </span>
                          </div>
                          {item.plain && (
                            <p className="text-xs text-zinc-700 leading-relaxed mb-2">
                              <span className="font-semibold text-zinc-600">
                                쉬운 설명:{" "}
                              </span>
                              {item.plain}
                            </p>
                          )}
                          <p className="text-xs text-zinc-700 leading-relaxed mb-2">
                            <span className="font-semibold text-zinc-600">
                              이 수치는:{" "}
                            </span>
                            {item.interpretation}
                          </p>
                          <p className="text-xs text-zinc-700 leading-relaxed">
                            <span className="font-semibold text-zinc-600">
                              임상적 함의:{" "}
                            </span>
                            {item.clinicalMeaning}
                          </p>
                          {item.caution && (
                            <p className="mt-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1 leading-relaxed">
                              ⚠ {item.caution}
                            </p>
                          )}
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}

                {loadedPaper.statistics.summary && (
                  <section className="border-l-4 border-blue-500 bg-blue-50/40 rounded-r-md p-4">
                    <h3 className="text-sm font-semibold mb-2">종합</h3>
                    <p className="text-sm text-zinc-700 leading-relaxed">
                      {loadedPaper.statistics.summary}
                    </p>
                  </section>
                )}
              </div>
            ) : (
              <div className="text-center text-sm text-slate-400 mt-14 px-6">
                통계 해석을 불러오는 중...
              </div>
            )}
          </div>
        )}

        {activeTab === "translate" && (
          <div className="flex-1 overflow-y-auto p-4">
            {!loadedPaper ? (
              <div className="text-center text-sm text-slate-400 mt-14 px-6">
                <p>의학용어 해석 탭</p>
                <p className="text-xs mt-2">
                  좌측에서 논문을 먼저 분석하세요
                </p>
              </div>
            ) : translateLoading ? (
              <div className="text-center text-sm text-slate-400 mt-14 px-6 animate-pulse">
                의학용어 해석을 준비 중입니다...
              </div>
            ) : translateError ? (
              <div className="bg-red-50 border border-red-200 text-red-700 rounded-md p-3 text-sm">
                <div className="font-medium mb-1">오류</div>
                <div className="text-xs mb-2">{translateError}</div>
                <button
                  onClick={() => handleTranslate(loadedPaper)}
                  className="text-xs underline text-red-600 hover:text-red-700"
                >
                  다시 시도
                </button>
              </div>
            ) : loadedPaper.translation ? (
              <div className="space-y-6">
                <section>
                  <h3 className="text-sm font-semibold text-zinc-500 uppercase tracking-wide mb-3">
                    한국어 번역
                  </h3>
                  <p className="text-sm text-zinc-800 leading-relaxed whitespace-pre-wrap">
                    {loadedPaper.translation.translation}
                  </p>
                </section>

                {loadedPaper.translation.terms.length > 0 && (
                  <section>
                    <h3 className="text-sm font-semibold text-zinc-500 uppercase tracking-wide mb-3">
                      핵심 의학용어
                    </h3>
                    <ul className="space-y-3">
                      {loadedPaper.translation.terms.map((term, idx) => (
                        <li
                          key={`${term.english}-${idx}`}
                          className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
                        >
                          <div className="flex items-baseline gap-2 flex-wrap mb-1">
                            <span className="font-semibold text-sm text-zinc-900">
                              {term.korean}
                            </span>
                            <span className="text-xs text-zinc-500 italic">
                              {term.english}
                            </span>
                            <span
                              className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                                term.difficulty === "상"
                                  ? "bg-amber-100 text-amber-700"
                                  : "bg-zinc-100 text-zinc-500"
                              }`}
                            >
                              {term.difficulty}
                            </span>
                          </div>
                          <p className="text-xs text-zinc-700 leading-relaxed">
                            {term.explanation}
                          </p>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
              </div>
            ) : (
              <div className="text-center text-sm text-slate-400 mt-14 px-6">
                의학용어 해석을 불러오는 중...
              </div>
            )}
          </div>
        )}

        {activeTab === "background" && (
          <div className="flex-1 overflow-y-auto p-4">
            {!loadedPaper ? (
              <div className="text-center text-sm text-slate-400 mt-14 px-6">
                <p>배경지식 탭</p>
                <p className="text-xs mt-2">
                  좌측에서 논문을 먼저 분석하세요
                </p>
              </div>
            ) : backgroundLoading ? (
              <div className="text-center text-sm text-slate-400 mt-14 px-6 animate-pulse">
                논문을 읽기 위한 배경지식을 정리하는 중입니다...
              </div>
            ) : backgroundError ? (
              <div className="bg-red-50 border border-red-200 text-red-700 rounded-md p-3 text-sm">
                <div className="font-medium mb-1">오류</div>
                <div className="text-xs mb-2">{backgroundError}</div>
                <button
                  onClick={() => handleBackground(loadedPaper)}
                  className="text-xs underline text-red-600 hover:text-red-700"
                >
                  다시 시도
                </button>
              </div>
            ) : loadedPaper.background ? (
              loadedPaper.background.cards.length > 0 ? (
                <div className="space-y-3">
                  <p className="text-xs text-zinc-500 mb-1">
                    이 논문을 읽기 전에 알아두면 좋은 개념입니다.
                  </p>
                  {loadedPaper.background.cards.map((card, idx) => (
                    <section
                      key={`${card.concept}-${idx}`}
                      className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
                    >
                      <h3 className="font-semibold text-sm text-zinc-900 mb-1">
                        {card.concept}
                      </h3>
                      <p className="text-xs text-zinc-700 leading-relaxed mb-2">
                        {card.summary}
                      </p>
                      <p className="text-xs text-blue-700 leading-relaxed">
                        <span className="font-semibold">왜 필요한가: </span>
                        {card.importance}
                      </p>
                    </section>
                  ))}
                </div>
              ) : (
                <div className="text-center text-sm text-slate-400 mt-14 px-6">
                  생성된 배경지식 카드가 없습니다.
                </div>
              )
            ) : (
              <div className="text-center text-sm text-slate-400 mt-14 px-6">
                배경지식을 불러오는 중...
              </div>
            )}
          </div>
        )}

        {activeTab === "reliability" && (
          <div className="flex-1 overflow-y-auto p-4">
            {!loadedPaper ? (
              <div className="text-center text-sm text-slate-400 mt-14 px-6">
                <p>신뢰도 탭</p>
                <p className="text-xs mt-2">좌측에서 논문을 먼저 분석하세요</p>
              </div>
            ) : reliabilityLoading ? (
              <div className="text-center text-sm text-slate-400 mt-14 px-6 animate-pulse">
                논문 신뢰도를 분석하는 중입니다...
              </div>
            ) : reliabilityError ? (
              <div className="bg-red-50 border border-red-200 text-red-700 rounded-md p-3 text-sm">
                <div className="font-medium mb-1">오류</div>
                <div className="text-xs mb-2">{reliabilityError}</div>
                <button
                  onClick={() => handleReliability(loadedPaper)}
                  className="text-xs underline text-red-600 hover:text-red-700"
                >
                  다시 시도
                </button>
              </div>
            ) : loadedPaper.reliability ? (
              <div className="space-y-4">
                <ul className="space-y-3">
                  {loadedPaper.reliability.cards.map((card, idx) => (
                    <li
                      key={idx}
                      className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
                    >
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">
                          {card.category}
                        </span>
                        <span
                          className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                            card.level === "높음"
                              ? "bg-green-100 text-green-700"
                              : card.level === "보통"
                                ? "bg-yellow-100 text-yellow-700"
                                : card.level === "낮음"
                                  ? "bg-red-100 text-red-700"
                                  : "bg-zinc-100 text-zinc-500"
                          }`}
                        >
                          {card.level}
                        </span>
                      </div>
                      <p className="text-sm font-medium text-zinc-900 mb-1">
                        {card.value}
                      </p>
                      <p className="text-xs text-zinc-600 leading-relaxed">
                        {card.interpretation}
                      </p>
                    </li>
                  ))}
                </ul>
                {loadedPaper.reliability.overall && (
                  <section className="border-l-4 border-blue-500 bg-blue-50/40 rounded-r-md p-4">
                    <h3 className="text-sm font-semibold mb-2">종합 평가</h3>
                    <p className="text-sm text-zinc-700 leading-relaxed">
                      {loadedPaper.reliability.overall}
                    </p>
                  </section>
                )}
              </div>
            ) : (
              <div className="text-center text-sm text-slate-400 mt-14 px-6">
                신뢰도 분석을 불러오는 중...
              </div>
            )}
          </div>
        )}

        {activeTab === "quiz" && (
          <div className="flex-1 overflow-y-auto p-4">
            {!loadedPaper ? (
              <div className="text-center text-sm text-slate-400 mt-14 px-6">
                <p>퀴즈 탭</p>
                <p className="text-xs mt-2">좌측에서 논문을 먼저 분석하세요</p>
              </div>
            ) : quizLoading ? (
              <div className="text-center text-sm text-slate-400 mt-14 px-6 animate-pulse">
                논문 기반 퀴즈를 생성하는 중입니다...
              </div>
            ) : quizError ? (
              <div className="bg-red-50 border border-red-200 text-red-700 rounded-md p-3 text-sm">
                <div className="font-medium mb-1">오류</div>
                <div className="text-xs mb-2">{quizError}</div>
                <button
                  onClick={() => handleQuiz(loadedPaper)}
                  className="text-xs underline text-red-600 hover:text-red-700"
                >
                  다시 시도
                </button>
              </div>
            ) : loadedPaper.quiz ? (
              <div className="space-y-1">
                <p className="text-xs text-zinc-500 mb-3">
                  선택지를 클릭하면 즉시 채점됩니다. &nbsp;
                  {Object.keys(quizAnswers).length > 0 && (
                    <span className="font-semibold text-zinc-700">
                      {Object.keys(quizAnswers).length}/{loadedPaper.quiz.questions.length}문제 완료 &nbsp;·&nbsp;
                      {Object.entries(quizAnswers).filter(([i, a]) => a === loadedPaper.quiz!.questions[Number(i)].answer).length}개 정답
                    </span>
                  )}
                </p>
                {loadedPaper.quiz.questions.map((q, qi) => {
                  const selected = quizAnswers[qi];
                  const answered = selected !== undefined;
                  const correct = answered && selected === q.answer;
                  return (
                    <section
                      key={qi}
                      className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm mb-3"
                    >
                      <p className="text-sm font-medium text-zinc-900 mb-3">
                        <span className="text-zinc-400 mr-1">Q{qi + 1}.</span>
                        {q.question}
                      </p>
                      <ul className="space-y-1.5">
                        {q.options.map((opt, oi) => {
                          let style =
                            "border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-100";
                          if (answered) {
                            if (oi === q.answer)
                              style =
                                "border border-green-400 bg-green-50 text-green-800 font-medium";
                            else if (oi === selected)
                              style =
                                "border border-red-300 bg-red-50 text-red-700";
                            else style = "border border-zinc-200 bg-white text-zinc-400";
                          }
                          return (
                            <li key={oi}>
                              <button
                                onClick={() => {
                                  if (!answered)
                                    setQuizAnswers((prev) => ({
                                      ...prev,
                                      [qi]: oi,
                                    }));
                                }}
                                disabled={answered}
                                className={`w-full text-left px-3 py-2 text-xs rounded-md transition-colors ${style} disabled:cursor-default`}
                              >
                                <span className="font-semibold mr-1.5">
                                  {["A", "B", "C", "D"][oi]}.
                                </span>
                                {opt}
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                      {answered && (
                        <div
                          className={`mt-2 text-xs rounded px-2 py-1.5 leading-relaxed ${
                            correct
                              ? "bg-green-50 text-green-800 border border-green-200"
                              : "bg-red-50 text-red-800 border border-red-200"
                          }`}
                        >
                          <span className="font-semibold">
                            {correct ? "정답 ✓" : "오답 ✗"}
                          </span>{" "}
                          {q.explanation}
                        </div>
                      )}
                    </section>
                  );
                })}
              </div>
            ) : (
              <div className="text-center text-sm text-slate-400 mt-14 px-6">
                퀴즈를 불러오는 중...
              </div>
            )}
          </div>
        )}
        {activeTab === "guide" && (
          <div className="flex-1 overflow-y-auto p-4">
            {!loadedPaper ? (
              <div className="text-center text-sm text-slate-400 mt-14 px-6">
                <p>읽기 가이드 탭</p>
                <p className="text-xs mt-2">좌측에서 논문을 먼저 분석하세요</p>
              </div>
            ) : guideLoading ? (
              <div className="text-center text-sm text-slate-400 mt-14 px-6 animate-pulse">
                읽기 가이드를 생성하는 중입니다...
              </div>
            ) : guideError ? (
              <div className="bg-red-50 border border-red-200 text-red-700 rounded-md p-3 text-sm">
                <div className="font-medium mb-1">오류</div>
                <div className="text-xs mb-2">{guideError}</div>
                <button
                  onClick={() => handleGuide(loadedPaper)}
                  className="text-xs underline text-red-600 hover:text-red-700"
                >
                  다시 시도
                </button>
              </div>
            ) : loadedPaper.guide ? (
              <ReadingGuide
                data={loadedPaper.guide}
                onOpenTab={(tab) => handleTabChange(tab as RightTab)}
                onJump={(anchor) => toggleHighlight(anchor)}
              />
            ) : (
              <div className="text-center mt-8 space-y-3">
                <p className="text-sm text-zinc-500 leading-relaxed">
                  논문을 어디서부터 어떻게 읽어야 할지
                  <br />
                  단계별 길잡이를 만들어 드립니다.
                </p>
                <button
                  onClick={() => handleGuide(loadedPaper)}
                  className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
                >
                  읽기 가이드 생성
                </button>
              </div>
            )}
          </div>
        )}
        {activeTab === "visualize" && (
          <div className="flex-1 overflow-y-auto p-4">
            {!loadedPaper ? (
              <div className="text-center text-sm text-slate-400 mt-14 px-6">
                <p>시각화 탭</p>
                <p className="text-xs mt-2">좌측에서 논문을 먼저 분석하세요</p>
              </div>
            ) : (
              <div className="space-y-4">
                {/* Graphical abstract 이미지 — 제공자 선택형 */}
                <div className="rounded-xl border border-zinc-200 bg-white p-3">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
                      Graphical Abstract (시각화 요약)
                    </span>
                    <button
                      onClick={() => handleGenerateImage(loadedPaper)}
                      disabled={geminiLoading}
                      className="rounded-md bg-zinc-900 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-zinc-700 disabled:bg-zinc-300"
                    >
                      {geminiLoading
                        ? "생성 중..."
                        : loadedPaper.geminiImage
                          ? "다시 생성"
                          : "이미지 생성"}
                    </button>
                  </div>
                  {/* 제공자 선택 */}
                  <div className="mb-1 flex flex-wrap gap-1">
                    {(
                      [
                        ["gemini", "Gemini"],
                        ["openai", "OpenAI"],
                        ["flux", "Flux"],
                        ["ideogram", "Ideogram"],
                      ] as const
                    ).map(([key, label]) => (
                      <button
                        key={key}
                        onClick={() => setImageProvider(key)}
                        disabled={geminiLoading}
                        className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors disabled:opacity-50 ${
                          imageProvider === key
                            ? "bg-blue-600 text-white"
                            : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <p className="mb-2 text-[10px] text-zinc-400">
                    Gemini·OpenAI는 직접 API, Flux·Ideogram은 Replicate 경유. 한글 품질은 Gemini가 가장 좋습니다.
                  </p>
                  {geminiError ? (
                    <div className="bg-red-50 border border-red-200 text-red-700 rounded-md p-2 text-xs">
                      {geminiError}
                    </div>
                  ) : geminiLoading ? (
                    <div className="text-center text-xs text-zinc-400 py-6 animate-pulse">
                      이미지를 생성하는 중입니다... (수십 초 소요)
                    </div>
                  ) : loadedPaper.geminiImage ? (
                    <div className="space-y-2">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={loadedPaper.geminiImage}
                        alt="생성된 graphical abstract"
                        className="w-full rounded-md border border-zinc-200"
                      />
                      <div className="flex items-center justify-between">
                        <a
                          href={loadedPaper.geminiImage}
                          download="graphical-abstract.png"
                          className="text-[11px] text-blue-600 underline hover:text-blue-700"
                        >
                          이미지 저장
                        </a>
                        <span className="text-[10px] text-amber-600">
                          ⚠ 차트·수치·이미지는 AI 생성물 — 원문과 대조 검증 필요
                        </span>
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-zinc-400 py-2">
                      핵심 결과를 바탕으로 graphical abstract(시각화 요약 자료)를 생성합니다. 제공자를 고르고 위 버튼을 누르세요.
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
        {activeTab === "slides" && (
          <div className="flex-1 overflow-y-auto p-4">
            {!loadedPaper ? (
              <div className="text-center text-sm text-slate-400 mt-14 px-6">
                <p>발표 슬라이드 탭</p>
                <p className="text-xs mt-2">좌측에서 논문을 먼저 분석하세요</p>
              </div>
            ) : (
              <div className="space-y-4">
                <p className="text-xs leading-relaxed text-slate-500">
                  분석한 논문을 발표용 슬라이드(.pptx)로 내려받습니다. 원문에 그림이 있으면
                  원본 캡션과 함께 자동으로 포함됩니다.
                </p>

                {/* 요약 그대로 — 조립(무 LLM) */}
                <div className="rounded-xl border border-slate-200 bg-white p-3.5">
                  <div className="text-[13px] font-semibold text-slate-700">요약 그대로</div>
                  <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
                    분석한 요약·통계·그림을 그대로 조립합니다. AI 생성 없이 만들어 원문 분석과 내용이 같습니다.
                  </p>
                  <button
                    onClick={() => downloadSlides("compose")}
                    disabled={slidesMode !== null}
                    className="mt-2.5 w-full rounded-lg bg-slate-800 px-3 py-2 text-[13px] font-medium text-white transition-colors hover:bg-slate-700 disabled:opacity-50"
                  >
                    {slidesMode === "compose" ? "생성 중…" : "요약 그대로 (.pptx)"}
                  </button>
                </div>

                {/* AI 재구성 — 추가 요구사항 반영 */}
                <div className="rounded-xl border border-slate-200 bg-white p-3.5">
                  <div className="text-[13px] font-semibold text-slate-700">AI 재구성</div>
                  <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
                    논문 내용과 요약을 바탕으로 AI가 발표용으로 재구성합니다. 원문에 없는 내용은 넣지 않습니다.
                  </p>
                  <label className="mt-2.5 block text-[11px] font-medium text-slate-500">
                    추가 요구사항 (선택)
                  </label>
                  <textarea
                    value={slidesRequirements}
                    onChange={(e) => setSlidesRequirements(e.target.value.slice(0, 500))}
                    placeholder="예: 저널클럽 발표용, 통계 해석을 자세히 / 8장 이내로 / 방법보다 결과 중심으로"
                    rows={3}
                    className="mt-1 w-full resize-none rounded-lg border border-slate-200 bg-slate-50/60 px-2.5 py-2 text-[12px] text-slate-700 placeholder:text-slate-400 focus:border-teal-300 focus:outline-none focus:ring-1 focus:ring-teal-200"
                  />
                  <div className="mt-1 flex items-start justify-between gap-2">
                    <span className="text-[10px] leading-tight text-slate-400">
                      요구사항은 이 모드에만 반영됩니다. 항상 원문 내용에 근거해 작성됩니다.
                    </span>
                    <span className="shrink-0 text-[10px] tabular-nums text-slate-400">
                      {slidesRequirements.length}/500
                    </span>
                  </div>
                  <button
                    onClick={() => downloadSlides("llm")}
                    disabled={slidesMode !== null}
                    className="mt-2.5 w-full rounded-lg bg-teal-600 px-3 py-2 text-[13px] font-medium text-white transition-colors hover:bg-teal-700 disabled:opacity-50"
                  >
                    {slidesMode === "llm" ? "생성 중…" : "AI 재구성 (.pptx)"}
                  </button>
                </div>

                {slidesError && (
                  <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-600">
                    {slidesError}
                  </div>
                )}
                {slidesResult && !slidesError && (
                  <div className="rounded-lg border border-teal-200 bg-teal-50 px-3 py-2 text-[12px] text-teal-700">
                    {slidesResult.mode === "llm" ? "AI 재구성" : "요약 그대로"} 슬라이드{" "}
                    {slidesResult.slides}장
                    {slidesResult.figures > 0
                      ? ` · 원문 그림 ${slidesResult.figures}장 포함`
                      : " · 포함된 원문 그림 없음"}{" "}
                    — 다운로드됨
                  </div>
                )}
              </div>
            )}
          </div>
        )}
          </aside>
        </>
      )}
      </div>

      {/* 모바일 하단 뷰 전환 (lg 미만에서만) */}
      <nav className="lg:hidden shrink-0 grid grid-cols-3 border-t border-slate-200 bg-white">
        {(
          [
            { key: "original", label: "원문" },
            { key: "summary", label: "핵심요약" },
            { key: "tools", label: "읽기도구" },
          ] as { key: "original" | "summary" | "tools"; label: string }[]
        ).map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setMobileView(key)}
            className={`py-2.5 text-[13px] font-medium transition-colors ${
              mobileView === key
                ? "text-blue-600 shadow-[0_-2px_0_inset_rgba(37,99,235,1)]"
                : "text-slate-400 hover:text-slate-600"
            }`}
          >
            {label}
          </button>
        ))}
      </nav>
    </div>
  );
}

// 섹션별 차분한 색 톤 (단조로움 방지 — 쿨톤 스윕 + 따뜻한 강조)
const SECTION_TONES = {
  blue: { wrap: "border-blue-200/70 bg-blue-50/50", bar: "bg-blue-500" },
  sky: { wrap: "border-sky-200/70 bg-sky-50/50", bar: "bg-sky-500" },
  teal: { wrap: "border-teal-200/70 bg-teal-50/50", bar: "bg-teal-500" },
  indigo: { wrap: "border-indigo-200/70 bg-indigo-50/50", bar: "bg-indigo-500" },
  emerald: { wrap: "border-emerald-200/70 bg-emerald-50/50", bar: "bg-emerald-500" },
  amber: { wrap: "border-amber-200/70 bg-amber-50/60", bar: "bg-amber-500" },
} as const;

type SectionTone = keyof typeof SECTION_TONES;

function SummarySection({
  title,
  body,
  tone = "blue",
  render,
}: {
  title: string;
  body: string;
  tone?: SectionTone;
  render?: (text: string) => ReactNode;
}) {
  const t = SECTION_TONES[tone];
  return (
    <section className={`rounded-xl border p-4 ${t.wrap}`}>
      <div className="mb-2 flex items-center gap-2">
        <span className={`h-4 w-1 rounded-full ${t.bar}`} />
        <h3 className="text-[15px] font-semibold text-slate-900">{title}</h3>
      </div>
      <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
        {body ? (render ? render(body) : body) : "본문에 명시되어 있지 않습니다."}
      </p>
    </section>
  );
}
