import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import type { Figure } from "@/app/api/pubmed/route";
import {
  composePlan,
  figureKey,
  figureSlides,
  isPlaceholder,
  MAX_FIGURES,
  metaFrom,
  type DeckPlan,
  type SlideSource,
  type SlideSpec,
} from "@/app/lib/slidePlan";
import { buildPptxBuffer, type ImageMap } from "@/app/lib/buildPptx";

export const runtime = "nodejs";
export const maxDuration = 60;

const client = new Anthropic();

// 웜 람다에서 compose→llm 반복/재다운로드 시 재fetch 방지 (url -> data URI)
const imageCache = new Map<string, string>();
const IMAGE_CACHE_MAX = 40;

// 원본 그림 URL → "image/xxx;base64,...." (실패/타임아웃 시 null)
async function fetchImageData(url: string): Promise<string | null> {
  const cached = imageCache.get(url);
  if (cached) return cached;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "PaperMentor/1.0 (mailto:risepapermentor@gmail.com)" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const ct = (res.headers.get("content-type") || "").split(";")[0].trim();
    if (!ct.startsWith("image/")) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0 || buf.length > 2_500_000) return null; // 개별 2.5MB 상한
    const data = `${ct};base64,${buf.toString("base64")}`;
    if (imageCache.size >= IMAGE_CACHE_MAX) {
      const oldest = imageCache.keys().next().value;
      if (oldest !== undefined) imageCache.delete(oldest);
    }
    imageCache.set(url, data);
    return data;
  } catch {
    return null;
  }
}

// 그림 이미지 병렬 fetch(동시성 4) + 누적 용량 예산(Vercel 4.5MB 응답 한도 고려).
async function fetchFigureImages(figs: Figure[]): Promise<ImageMap> {
  const images: ImageMap = {};
  let budget = 3_500_000; // base64 문자 예산
  const tasks = figs
    .slice(0, MAX_FIGURES)
    .map((fig, i) => ({ i, url: fig.srcs?.[0] }))
    .filter((t): t is { i: number; url: string } => typeof t.url === "string" && t.url.length > 0);

  let cursor = 0;
  const worker = async () => {
    while (cursor < tasks.length) {
      const t = tasks[cursor++];
      const data = await fetchImageData(t.url);
      if (data && data.length <= budget) {
        images[figureKey(t.i)] = data;
        budget -= data.length;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, tasks.length) }, worker));
  return images;
}

// 그림 슬라이드를 '주요 결과' 뒤(결론/한계 앞)에 끼워넣는다. 결과 슬라이드가 없으면 결론 앞, 그것도 없으면 끝.
function insertFiguresAfterResults(slides: SlideSpec[], figs: SlideSpec[]): SlideSpec[] {
  if (!figs.length) return slides;
  const isResult = (s: SlideSpec) => /결과|통계/.test(`${s.eyebrow ?? ""}${s.title}`);
  const isTail = (s: SlideSpec) => /결론|한계|의의|요약|시사/.test(`${s.eyebrow ?? ""}${s.title}`);
  let insertAt = -1;
  slides.forEach((s, i) => {
    if (isResult(s)) insertAt = i + 1;
  });
  if (insertAt === -1) {
    const t = slides.findIndex(isTail);
    insertAt = t === -1 ? slides.length : t;
  }
  return [...slides.slice(0, insertAt), ...figs, ...slides.slice(insertAt)];
}

// AI 재구성 모드: 근거 자료만으로 발표 슬라이드 텍스트 생성(무할루시네이션·담백). 그림 슬라이드는 코드가 배치.
// requirements: 사용자 추가 요청(선택). 절대 규칙 아래에서만 반영한다.
async function llmPlan(src: SlideSource, requirements?: string): Promise<DeckPlan> {
  const { paper, summary, statistics } = src;

  const summaryPairs: [string, string | undefined][] = [
    ["배경", summary.background],
    ["방법", summary.methods],
    ["결과", summary.results],
    ["결론", summary.conclusion],
    ["핵심 메시지", summary.keyMessage],
  ];
  const summaryBlock = summaryPairs
    .filter(([, v]) => typeof v === "string" && v.trim() && !isPlaceholder(v))
    .map(([k, v]) => `- ${k}: ${v}`)
    .join("\n");

  const grounding = [
    `제목: ${paper.title}`,
    paper.abstract ? `초록:\n${paper.abstract}` : "",
    paper.fullText ? `본문 발췌(Methods/Results):\n${paper.fullText}` : "",
    summaryBlock ? `구조화 요약:\n${summaryBlock}` : "",
    summary.keyFindings?.length
      ? `핵심 결과:\n${summary.keyFindings.map((f) => `• ${f.claim} (근거: ${f.evidence})`).join("\n")}`
      : "",
    statistics?.items?.length
      ? `통계 수치:\n${statistics.items.map((it) => `• ${it.metric} ${it.value} — ${it.interpretation}`).join("\n")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  const baseSystem = `당신은 의학 논문을 발표용 슬라이드로 정리하는 전문가입니다.
제공된 "근거 자료"만 사용해 발표 슬라이드의 텍스트를 작성합니다.

[절대 규칙 — 반드시 지킬 것]
- 근거 자료에 없는 내용·수치·주장을 절대 만들어내지 마십시오(할루시네이션 금지). 확실하지 않으면 넣지 마십시오.
- 수치는 근거 자료에 있는 그대로만 사용하고, 임의로 바꾸거나 추정하지 마십시오.
- 비유·은유·함축·수사적 표현을 쓰지 마십시오. 담백하고 사실적인 평서문만 사용합니다.
- 과장 형용사("혁신적", "획기적", "놀라운" 등) 금지.
- 근거 자료가 말하는 강도 그대로 표현하십시오. 근거가 "연관/시사" 수준이면 "입증/증명/~시킨다" 같은 단정·인과 표현을 쓰지 마십시오. 관찰연구 결과를 인과관계로 서술하지 마십시오.
- 각 불릿은 한 문장으로 간결하게 쓰십시오(대략 45자 이내 권장). 한 불릿이 길어지면 두 개로 나누십시오. 한국어.
- 원문 그림은 시스템이 주요 결과 뒤에 원본 캡션과 함께 자동으로 배치합니다. 본문 텍스트에서 존재하지 않는 그림 번호나 그림 속 내용을 지어내지 마십시오.

[구성]
- 4~8장. 논리 순서: 배경·목적 → 방법 → 주요 결과 → (근거에 있으면) 핵심 통계 → 결론 → (근거 자료에 임상적 의의가 명시된 경우에만) 임상적 의의 → (근거가 있으면) 한계·주의.
- 지시된 슬라이드라도 근거 자료에 해당 내용이 없으면 그 슬라이드를 생략하십시오. 슬라이드 수를 채우려고 내용을 만들지 마십시오.
- 각 슬라이드는 eyebrow(짧은 분류 라벨), title(제목), bullets(2~4개)로 구성합니다.

[출력 — 아래 JSON만 출력]
{ "slides": [ { "eyebrow": "배경 · 목적", "title": "연구 배경", "bullets": ["문장1", "문장2"] } ] }`;

  // 사용자 추가 요구사항: 절대 규칙(무할루시네이션·무비유·무과장) 아래에서만 반영. 규칙과 충돌하면 무시.
  const reqClean = (requirements ?? "").replace(/\s+/g, " ").trim().slice(0, 500);
  const system = reqClean
    ? `${baseSystem}

[사용자 추가 요청 — 낮은 우선순위]
사용자가 다음 추가 요청을 했습니다. 위 [절대 규칙]을 지키는 범위 안에서만 반영하십시오. 규칙과 충돌하는 요청(근거 자료에 없는 내용 추가, 수치·결과 과장, 비유·수사 표현, 인과 단정 등)은 따르지 말고 무시하십시오. 이 요청은 발표의 강조점·구성·분량 조정 정도에만 활용합니다.
요청: "${reqClean}"`
    : baseSystem;

  // 여러 슬라이드를 한 번에 생성하므로 스트리밍으로 받아 요청 레벨 타임아웃을 피한다.
  const resp = await client.messages
    .stream({
      model: "claude-sonnet-4-6",
      max_tokens: 4096,
      system,
      messages: [{ role: "user", content: grounding }],
    })
    .finalMessage();

  const text = resp.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");

  const slides = parseLlmSlides(text);
  // 파싱 실패/빈 결과(또는 max_tokens 절단) → 결정적 무할루시네이션 경로로 폴백.
  if (slides.length === 0) return composePlan(src);

  return { meta: metaFrom(paper), slides: insertFiguresAfterResults(slides, figureSlides(paper)) };
}

function parseLlmSlides(text: string): SlideSpec[] {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return [];
  }
  const raw = (parsed as { slides?: unknown }).slides;
  if (!Array.isArray(raw)) return [];
  const out: SlideSpec[] = [];
  for (const item of raw) {
    const o = item as { eyebrow?: unknown; title?: unknown; bullets?: unknown };
    if (typeof o.title !== "string" || !o.title.trim()) continue;
    const bullets = Array.isArray(o.bullets)
      ? o.bullets.filter((b): b is string => typeof b === "string" && b.trim().length > 0)
      : [];
    out.push({
      eyebrow: typeof o.eyebrow === "string" ? o.eyebrow : undefined,
      title: o.title,
      body: bullets.length ? { kind: "bullets", bullets } : undefined,
    });
  }
  return out;
}

function makeFilename(title: string, mode: "compose" | "llm"): string {
  const cleaned = (title || "논문")
    .replace(/[\\/:*?"<>|\n\r\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  // 코드포인트 단위로 잘라 서로게이트 쌍이 쪼개지지 않게 함 (encodeURIComponent URIError 방지).
  const base =
    Array.from(cleaned)
      .slice(0, 50)
      .join("")
      .replace(/[\uD800-\uDBFF]$/, "")
      .trim() || "논문";
  const suffix = mode === "llm" ? "발표_AI재구성" : "발표_요약조립";
  return `${base}_${suffix}.pptx`;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as SlideSource & { mode?: string; requirements?: string };
    const mode: "compose" | "llm" = body.mode === "llm" ? "llm" : "compose";

    if (!body.paper || !body.summary) {
      return NextResponse.json(
        { error: "paper와 summary가 필요합니다. 먼저 논문을 분석해 주세요." },
        { status: 400 },
      );
    }

    const src: SlideSource = {
      paper: body.paper,
      summary: body.summary,
      statistics: body.statistics ?? null,
      background: body.background ?? null,
    };

    // 슬라이드 플랜(llm은 LLM 호출)과 원본 그림 fetch를 병렬로 — llm 모드에서 시간 절약.
    const [plan, images] = await Promise.all([
      mode === "llm" ? llmPlan(src, body.requirements) : Promise.resolve(composePlan(src)),
      fetchFigureImages(src.paper.figures ?? []),
    ]);

    // 이미지를 못 받은 그림 슬라이드는 제거(깔끔 유지)
    plan.slides = plan.slides.filter(
      (sl) => !(sl.body?.kind === "figure" && !images[sl.body.imageKey]),
    );

    if (plan.slides.length === 0) {
      return NextResponse.json(
        { error: "발표로 만들 분석 내용이 없습니다. 먼저 요약을 완료해 주세요." },
        { status: 422 },
      );
    }

    // pptx 생성
    const buf = await buildPptxBuffer(plan, images);
    const bytes = new Uint8Array(buf.length);
    bytes.set(buf);
    const fname = makeFilename(src.paper.title, mode);
    const figCount = plan.slides.filter((s) => s.body?.kind === "figure").length;

    return new NextResponse(bytes, {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "Content-Disposition": `attachment; filename="paper.pptx"; filename*=UTF-8''${encodeURIComponent(fname)}`,
        "Cache-Control": "no-store",
        "X-Slide-Count": String(plan.slides.length + 1),
        "X-Figure-Count": String(figCount),
      },
    });
  } catch (error) {
    if (error instanceof Anthropic.APIError) {
      return NextResponse.json({ error: error.message }, { status: error.status ?? 500 });
    }
    return NextResponse.json(
      { error: "슬라이드 생성 중 오류가 발생했습니다." },
      { status: 500 },
    );
  }
}
