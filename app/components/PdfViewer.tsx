"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";

// pdf.js 워커: public/에 복사한 정적 파일을 직접 참조 (Turbopack/Vercel 모두 안전)
// 버전은 pdfjs-dist와 일치해야 함 — 패키지 업데이트 시 public/pdf.worker.min.mjs 재복사 필요.
pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

// ── PDF 텍스트 레이어용 정규형(canonical) 매칭 ──────────────────────────
// PDF 텍스트는 줄바꿈 하이픈·다단 레이아웃·합자(ﬁ)·단어 쪼개짐·문장부호 차이로
// 발췌본과 글자가 안 맞는다. 그래서 "영숫자만 남긴 소문자열"로 양쪽을 정규화해
// 비교하면 이 차이들을 모두 흡수할 수 있다. map[k]는 canon[k]가 가리키는 원본 인덱스.
function canonicalize(s: string): { canon: string; map: number[] } {
  let canon = "";
  const map: number[] = [];
  for (let i = 0; i < s.length; i++) {
    // 합자 등은 NFKC로 펼치되(예: ﬁ→fi), map은 원본 한 글자를 가리키게 유지
    const dec = s[i].normalize("NFKC").toLowerCase();
    for (let j = 0; j < dec.length; j++) {
      const d = dec[j];
      if ((d >= "a" && d <= "z") || (d >= "0" && d <= "9")) {
        canon += d;
        map.push(i);
      }
    }
  }
  return { canon, map };
}

function canonNeedle(needle: string): string {
  return canonicalize(needle).canon;
}

// [2순위] haystack에서 needle의 "연속된 조각"을 찾아 원본 좌표 {start,end} 반환.
// 전체 문장이 안 맞아도, 문장 중간의 한 구절이 그대로 있으면 거기를 잡는다.
// 긴 조각부터 시도해 가능한 한 넓게 형광펜이 찍히도록 한다. (없으면 null)
function findFragment(
  haystack: string,
  needle: string,
): { start: number; end: number } | null {
  if (!haystack || !needle) return null;
  const H = canonicalize(haystack);
  const n = canonNeedle(needle);
  if (n.length < 16) return null;

  const lengths = Array.from(
    new Set(
      [
        n.length,
        Math.floor(n.length * 0.7),
        Math.floor(n.length * 0.45),
        40,
        28,
      ].map((L) => Math.min(L, n.length)),
    ),
  ).sort((a, b) => b - a); // 긴 조각 우선
  for (const L of lengths) {
    if (L < 16) continue;
    for (let off = 0; off + L <= n.length; off += 12) {
      const probe = n.slice(off, off + L);
      const ci = H.canon.indexOf(probe);
      if (ci !== -1) {
        const start = H.map[ci];
        const end = H.map[ci + probe.length - 1] + 1;
        return { start, end };
      }
    }
  }
  return null;
}

// [3순위] 정확히 못 찾을 때를 위해, needle의 대표 단어들을 뽑는다(4자 이상, 영숫자).
function anchorWords(needle: string): string[] {
  const seen = new Set<string>();
  for (const raw of needle.split(/[^A-Za-z0-9]+/)) {
    const w = canonNeedle(raw);
    if (w.length >= 4) seen.add(w);
  }
  return [...seen];
}

// 한 페이지에 needle 단어가 몇 개나 등장하는지 (페이지 추정용 점수)
function pageOverlapScore(haystack: string, words: string[]): number {
  if (words.length === 0) return 0;
  const c = canonicalize(haystack).canon;
  let hit = 0;
  for (const w of words) if (c.includes(w)) hit++;
  return hit;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

type ItemOffset = { i: number; s: number; e: number };
type PageText = { itemOffsets: ItemOffset[]; concat: string };

// 화면 근처에 올 때만 실제 <Page>를 렌더 (지연 렌더로 초기 렉 완화).
// 강조 대상 페이지는 화면 밖이어도 강제로 렌더해 스크롤·형광펜이 동작하게 한다.
function LazyPage({
  pageNumber,
  width,
  render,
  renderTextLayer,
  forceRender,
  dpr,
  setRef,
}: {
  pageNumber: number;
  width: number;
  render: (item: { str: string; itemIndex: number }) => string;
  renderTextLayer: boolean;
  forceRender: boolean;
  dpr: number;
  setRef: (el: HTMLDivElement | null) => void;
}) {
  const [visible, setVisible] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) setVisible(true);
      },
      { rootMargin: "800px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const show = visible || forceRender;
  const estHeight = width ? Math.round(width * 1.3) : 800;

  return (
    <div
      ref={(el) => {
        ref.current = el;
        setRef(el);
      }}
      className="flex justify-center py-2"
      style={show ? undefined : { minHeight: estHeight }}
    >
      {show ? (
        <Page
          pageNumber={pageNumber}
          width={width ? Math.max(width - 16, 200) : undefined}
          devicePixelRatio={dpr}
          renderAnnotationLayer={false}
          renderTextLayer={renderTextLayer}
          customTextRenderer={render}
          className="shadow-md"
        />
      ) : (
        <div className="text-[11px] text-zinc-400">…</div>
      )}
    </div>
  );
}

type Props = {
  url: string;
  highlight: string | null;
};

export default function PdfViewer({ url, highlight }: Props) {
  const [numPages, setNumPages] = useState(0);
  const [width, setWidth] = useState(0);
  const [hlPage, setHlPage] = useState<number | null>(null);
  // itemIndex → [ [start,end], ... ] (해당 item.str 내부 오프셋)
  const [hlRanges, setHlRanges] = useState<Record<number, [number, number][]>>(
    {},
  );
  const [notFound, setNotFound] = useState(false);
  const [approx, setApprox] = useState(false); // 정확 위치는 못 잡고 페이지로만 이동

  const pdfRef = useRef<pdfjs.PDFDocumentProxy | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const pageRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const textCache = useRef<Record<number, PageText>>({});

  // 캔버스 해상도 상한 (고DPI 화면에서 2~3배 렌더 비용 절감)
  const [dpr, setDpr] = useState(1);
  useEffect(() => {
    setDpr(Math.min(window.devicePixelRatio || 1, 1.5));
  }, []);

  // 컨테이너 폭 측정 → 페이지를 가로폭에 맞춤
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setWidth(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const onLoad = useCallback((pdf: pdfjs.PDFDocumentProxy) => {
    pdfRef.current = pdf;
    textCache.current = {};
    setNumPages(pdf.numPages);
  }, []);

  const getPageText = useCallback(async (n: number): Promise<PageText> => {
    const cached = textCache.current[n];
    if (cached) return cached;
    const page = await pdfRef.current!.getPage(n);
    const tc = await page.getTextContent();
    let concat = "";
    const itemOffsets: ItemOffset[] = [];
    tc.items.forEach((it, i) => {
      const str = "str" in it ? it.str : "";
      const s = concat.length;
      concat += str;
      const e = concat.length;
      itemOffsets.push({ i, s, e });
      concat += " "; // item 사이 구분 (normalize에서 흡수됨)
    });
    const rec: PageText = { itemOffsets, concat };
    textCache.current[n] = rec;
    return rec;
  }, []);

  // highlight(원문 문장)가 바뀌면 단계적으로 위치를 찾는다.
  //  1·2순위: 문장(또는 조각)을 페이지에서 찾아 형광펜 + 스크롤
  //  3순위: 못 찾으면 단어 겹침이 가장 많은 페이지로 스크롤만 (대략 위치)
  useEffect(() => {
    let cancelled = false;
    setHlPage(null);
    setHlRanges({});
    setNotFound(false);
    setApprox(false);
    if (!highlight || !pdfRef.current || !numPages) return;

    (async () => {
      // 1·2순위 — 문장/조각 형광펜
      for (let n = 1; n <= numPages; n++) {
        const { itemOffsets, concat } = await getPageText(n);
        if (cancelled) return;
        const m = findFragment(concat, highlight);
        if (m) {
          const ranges: Record<number, [number, number][]> = {};
          for (const { i, s, e } of itemOffsets) {
            const lo = Math.max(m.start, s);
            const hi = Math.min(m.end, e);
            if (hi > lo) (ranges[i] ||= []).push([lo - s, hi - s]);
          }
          if (!cancelled) {
            setHlPage(n);
            setHlRanges(ranges);
            setApprox(false);
          }
          return;
        }
      }

      // 3순위 — 단어 겹침이 가장 많은 페이지로 이동만
      const words = anchorWords(highlight);
      let bestPage = -1;
      let bestScore = 0;
      for (let n = 1; n <= numPages; n++) {
        const { concat } = await getPageText(n);
        if (cancelled) return;
        const score = pageOverlapScore(concat, words);
        if (score > bestScore) {
          bestScore = score;
          bestPage = n;
        }
      }
      const threshold = Math.max(3, Math.ceil(words.length * 0.3));
      if (!cancelled) {
        if (bestPage !== -1 && bestScore >= threshold) {
          setHlPage(bestPage);
          setHlRanges({});
          setApprox(true);
        } else {
          setNotFound(true);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [highlight, numPages, getPageText]);

  // 강조 페이지로 스크롤
  useEffect(() => {
    if (hlPage && pageRefs.current[hlPage]) {
      pageRefs.current[hlPage]!.scrollIntoView({
        block: "start",
        behavior: "smooth",
      });
    }
  }, [hlPage]);

  const makeRenderer = (pageNumber: number) =>
    function textRenderer(textItem: { str: string; itemIndex: number }) {
      const str = textItem.str;
      if (pageNumber !== hlPage) return escapeHtml(str);
      const ranges = hlRanges[textItem.itemIndex];
      if (!ranges || ranges.length === 0) return escapeHtml(str);
      const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
      let out = "";
      let pos = 0;
      for (const [s, e] of sorted) {
        if (s > pos) out += escapeHtml(str.slice(pos, s));
        out += `<mark class="pm-pdf-hl">${escapeHtml(str.slice(s, e))}</mark>`;
        pos = e;
      }
      out += escapeHtml(str.slice(pos));
      return out;
    };

  return (
    <div
      ref={containerRef}
      className="relative flex-1 min-h-0 overflow-y-auto bg-zinc-200/60"
    >
      <style>{`.pm-pdf-hl{background:rgba(250,204,21,.55);color:transparent;border-radius:2px;box-shadow:0 0 0 1px rgba(202,138,4,.35);}`}</style>

      {notFound && (
        <div className="sticky top-0 z-10 bg-amber-50/95 px-3 py-1.5 text-[11px] text-amber-700 shadow-sm">
          이 문장을 PDF 원문에서 찾지 못했어요. 📝 텍스트 모드에서 확인해 보세요.
        </div>
      )}
      {approx && (
        <div className="sticky top-0 z-10 bg-blue-50/95 px-3 py-1.5 text-[11px] text-blue-700 shadow-sm">
          정확한 문장을 못 집어서, 관련 내용이 가장 많은 페이지로 이동했어요. 이 근처를 살펴보세요.
        </div>
      )}

      <Document
        file={url}
        onLoadSuccess={onLoad}
        loading={
          <div className="p-6 text-xs text-zinc-400">PDF 불러오는 중…</div>
        }
        error={
          <div className="p-6 text-xs text-red-500">
            PDF를 표시할 수 없습니다.
          </div>
        }
      >
        {Array.from({ length: numPages }, (_, idx) => {
          const n = idx + 1;
          return (
            <LazyPage
              key={n}
              pageNumber={n}
              width={width}
              dpr={dpr}
              // 텍스트 레이어(형광펜 오버레이)는 강조 페이지에만 생성 → 렌더 비용 최소화
              renderTextLayer={n === hlPage}
              forceRender={n === hlPage}
              render={makeRenderer(n)}
              setRef={(el) => {
                pageRefs.current[n] = el;
              }}
            />
          );
        })}
      </Document>
    </div>
  );
}
