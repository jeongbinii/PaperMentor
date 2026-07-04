// 논문 발표 슬라이드 "플랜" — compose(기존 분석 조립) / llm(AI 재구성) 두 경로가 공유하는 중간 표현.
// 렌더러(buildPptx.ts)는 이 플랜만 보고 pptx를 그린다. 이미지는 imageKey로 참조하고 route가 실제 데이터를 채운다.
import type { PubMedPaper } from "@/app/api/pubmed/route";
import type { StructuredSummary } from "@/app/api/summarize/route";
import type { StatisticsResult } from "@/app/api/stats/route";
import type { BackgroundResult } from "@/app/api/background/route";

export type StatRow = { metric: string; value: string; meaning: string };
export type KFRow = { claim: string; evidence?: string };

export type SlideBody =
  | { kind: "bullets"; bullets: string[] }
  | { kind: "keyFindings"; items: KFRow[] }
  | { kind: "stats"; items: StatRow[] }
  | { kind: "figure"; imageKey: string; caption: string }
  | { kind: "text"; text: string };

export type SlideSpec = {
  eyebrow?: string;
  title: string;
  body?: SlideBody;
};

export type DeckMeta = {
  title: string;
  authors: string[];
  journal: string;
  date: string;
  pmid: string;
  doi: string | null;
};

export type DeckPlan = { meta: DeckMeta; slides: SlideSpec[] };

export type SlideSource = {
  paper: PubMedPaper;
  summary: StructuredSummary;
  statistics?: StatisticsResult | null;
  background?: BackgroundResult | null;
};

// 그림 최대 개수(덱 비대·용량 상한과 route 이미지 fetch를 함께 제한)
export const MAX_FIGURES = 8;

export function figureKey(i: number): string {
  return `fig${i}`;
}

// 코드포인트 단위 클립. 경계로 정리하고 숫자 중간에서 자르지 않는다(수치 왜곡 방지).
function clipText(s: string, n: number): string {
  const chars = Array.from((s || "").trim());
  if (chars.length <= n) return chars.join("");
  const cut = chars.slice(0, n);
  const tail = chars.slice(n).join("");
  // 숫자 런 중간에서 잘리면 숫자 앞까지 되돌림 (예: "HR 0.8…" 방지)
  if (/\d$/.test(cut.join("")) && /^[\d.,%]/.test(tail)) {
    while (cut.length && /[\d.,%]$/.test(cut[cut.length - 1])) cut.pop();
  }
  return `${cut.join("").replace(/[\s,.;·]+$/, "")}…`;
}

// "분석 내용 없음" placeholder 문구 판별 → 그런 슬라이드는 생성하지 않는다(초록전용 논문 정리).
export function isPlaceholder(text: string): boolean {
  const t = (text || "").trim();
  if (!t) return true;
  return /(명시되어 있지 않|명시되지 않|제공된 초록|확인할 수 없|포함되어 있지 않|기술되어 있지 않|나와 있지 않|제시되어 있지 않|알 수 없)/.test(
    t,
  );
}

export function metaFrom(paper: PubMedPaper): DeckMeta {
  return {
    title: paper.title || "제목 없음",
    authors: Array.isArray(paper.authors) ? paper.authors : [],
    journal: paper.journal || "",
    date: paper.pubdate || "",
    // PDF 업로드본은 pmid에 doi나 "pdf:파일명"이 들어올 수 있음 → 숫자 PMID만 표기(오라벨 방지).
    pmid: /^\d+$/.test(paper.pmid || "") ? paper.pmid : "",
    doi: paper.doi ?? null,
  };
}

// 원본 논문 그림 → 그림 슬라이드(각 그림 1장, 첫 이미지 사용). route가 imageKey로 실제 이미지를 채운다.
export function figureSlides(paper: PubMedPaper): SlideSpec[] {
  const figs = paper.figures ?? [];
  const out: SlideSpec[] = [];
  figs.slice(0, MAX_FIGURES).forEach((fig, i) => {
    if (fig.srcs && fig.srcs.length > 0) {
      const label = (fig.label || `Figure ${i + 1}`).replace(/\bFIGURE\b/g, "Figure").trim();
      out.push({
        eyebrow: "그림",
        title: clipText(label, 70),
        body: { kind: "figure", imageKey: figureKey(i), caption: fig.caption || "" },
      });
    }
  });
  return out;
}

// 한 문단을 담백한 불릿으로. 소수점·약어를 보호하고 문장 종결 기준으로 분리.
function toBullets(text: string, max = 4): string[] {
  if (!text) return [];
  const raw = text.replace(/\s+/g, " ").trim();
  if (!raw) return [];

  const PROT = String.fromCharCode(1);
  let guarded = raw
    // 소수점: 숫자.숫자, 그리고 선행 소수점(예: p<.05, (.05)
    .replace(/(\d)\.(\d)/g, (_m, a, b) => `${a}${PROT}${b}`)
    .replace(/([<>=(,\s])\.(\d)/g, (_m, a, b) => `${a}${PROT}${b}`);
  // 흔한 약어의 마침표 보호 (vs. e.g. i.e. et al. Fig. cf. No. ca. approx.)
  guarded = guarded.replace(
    /\b(vs|e\.g|i\.e|et al|Fig|cf|No|ca|approx|Dr|Prof)\./gi,
    (m) => m.split(".").join(PROT),
  );

  const restore = (s: string) => s.split(PROT).join(".").trim();
  const sentences = (guarded.match(/[^.。!?]+[.。!?]?/g) ?? [guarded]).map(restore).filter(Boolean);

  // 너무 긴 조각은 세미콜론에서 2차 분리
  const parts: string[] = [];
  for (const seg of sentences) {
    if (Array.from(seg).length > 100 && /[;；]/.test(seg)) {
      for (const piece of seg.split(/[;；]\s*/)) {
        const t = piece.trim();
        if (t) parts.push(t);
      }
    } else {
      parts.push(seg);
    }
  }

  // 짧은 조각(수치 파편 등)은 앞 불릿에 붙여 손실 방지
  const out: string[] = [];
  for (const s of parts) {
    if (out.length > 0 && (s.length < 15 || out[out.length - 1].length < 25)) {
      out[out.length - 1] = `${out[out.length - 1]} ${s}`;
    } else {
      out.push(s);
    }
  }
  // 문장부호만 남은 orphan 제거(예: ")" 하나)
  return out.filter((s) => s.replace(/[\s.,;:!?)\]}([{]+/g, "").length >= 3).slice(0, max);
}

// 기존 분석 결과를 그대로 슬라이드로 조립 — 새 LLM 호출 없음(무할루시네이션·담백).
// "분석 내용 없음" placeholder 슬라이드는 생성하지 않는다.
export function composePlan(src: SlideSource): DeckPlan {
  const { paper, summary, statistics, background } = src;
  const slides: SlideSpec[] = [];

  if (summary.background && !isPlaceholder(summary.background)) {
    slides.push({
      eyebrow: "배경 · 목적",
      title: "연구 배경",
      body: { kind: "bullets", bullets: toBullets(summary.background, 4) },
    });
  }

  if (background?.cards?.length) {
    slides.push({
      eyebrow: "핵심 개념",
      title: "미리 알아둘 개념",
      body: {
        kind: "bullets",
        bullets: background.cards.slice(0, 4).map((c) => `${c.concept} — ${clipText(c.summary, 62)}`),
      },
    });
  }

  if (summary.methods && !isPlaceholder(summary.methods)) {
    slides.push({
      eyebrow: "방법",
      title: "연구 방법",
      body: { kind: "bullets", bullets: toBullets(summary.methods, 4) },
    });
  }

  if (summary.results && !isPlaceholder(summary.results)) {
    slides.push({
      eyebrow: "결과",
      title: "주요 결과",
      body: { kind: "bullets", bullets: toBullets(summary.results, 4) },
    });
  }

  const findings = (summary.keyFindings ?? []).filter((f) => f.claim && !isPlaceholder(f.claim));
  if (findings.length) {
    slides.push({
      eyebrow: "결과",
      title: "핵심 결과",
      body: {
        kind: "keyFindings",
        items: findings.slice(0, 4).map((f) => ({ claim: f.claim, evidence: f.evidence })),
      },
    });
  }

  if (statistics?.items?.length) {
    const core = statistics.items.filter((it) => it.importance === "핵심");
    const pick = (core.length ? core : statistics.items).slice(0, 5);
    const rows: StatRow[] = pick.map((it) => ({
      metric: it.metric,
      value: it.value,
      meaning: it.interpretation || it.plain || "",
    }));
    if (rows.length) {
      slides.push({ eyebrow: "통계", title: "핵심 통계 지표", body: { kind: "stats", items: rows } });
    }
  }

  // 원본 그림 슬라이드 — 결과 근거로서 결론 앞에 배치
  slides.push(...figureSlides(paper));

  if (summary.conclusion && !isPlaceholder(summary.conclusion)) {
    slides.push({
      eyebrow: "결론",
      title: "결론",
      body: { kind: "bullets", bullets: toBullets(summary.conclusion, 4) },
    });
  }

  if (summary.keyMessage && !isPlaceholder(summary.keyMessage)) {
    slides.push({
      eyebrow: "핵심 메시지",
      title: "한 줄 요약",
      body: { kind: "text", text: summary.keyMessage },
    });
  }

  return { meta: metaFrom(paper), slides };
}
