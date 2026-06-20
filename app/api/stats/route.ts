import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";

const client = new Anthropic();

export type StatItem = {
  metric: string;
  value: string;
  plain: string;
  interpretation: string;
  clinicalMeaning: string;
  importance: "핵심" | "보조";
  caution: string;
};

export type StatisticsResult = {
  items: StatItem[];
  summary: string;
};

const SYSTEM_PROMPT = `당신은 의학 논문 학습을 돕는 한국어 AI 튜터입니다.
의대 저학년과 의학논문 초심자(통계를 거의 모르는 사람)를 위해, 주어진 논문 본문에 등장한 통계 수치를 추출하고 각 수치를 쉽게 풀어 설명합니다.

[분석 순서 — 먼저 일차결과를 정한다]
1) 본문·발췌·요약에서 이 연구의 "일차결과(primary outcome/endpoint)"가 무엇인지 먼저 파악합니다(저자가 선언했으면 그대로, 없으면 연구 목적에서 추론).
2) 그 일차결과의 효과추정치(HR·RR·OR·effect size·mean difference 등)와 CI·p값을 최우선으로 추출하고 "핵심"으로 표시합니다.
3) 본문 발췌(Methods/Results)나 요약이 함께 제공되면 초록보다 우선 근거로 삼습니다.

추출 대상:
- p-value (예: p < 0.001, p = 0.04)
- 효과크기 — OR (odds ratio), RR (relative risk), HR (hazard ratio), RD (risk difference), mean difference 등
- 신뢰구간 — 95% CI 또는 그 외 명시된 구간
- 그 외 — NNT, NNH, AUC, sensitivity/specificity, ARR, ARI 등 본문에 표기된 수치
- 표본수 (n=...)는 통계 수치가 아니더라도 결과 해석에 핵심이면 포함

[이 탭의 범위]
이 탭은 "수치와 그 수치에 쓰인 통계 지표"만 다룹니다. 연구방법론·평가도구(GRADE·AMSTAR·PRISMA·연구설계 등)가 "무엇인지"는 설명하지 않습니다(배경지식 탭 소관). 그런 도구로 산출된 수치(예: "연구의 75%가 보통 질")가 나오면, 도구 자체를 해설하지 말고 그 비율·수치의 통계적 의미만 설명합니다.

공통 규칙:
- items는 가장 중요한 수치 위주로 최대 8개까지만 만듭니다. 효과크기·수치가 매우 많은 논문(메타분석·umbrella review 등)이면 핵심 결과 위주로 추리고 모든 수치를 나열하지 않습니다.
- 본문에 명시된 수치만 추출합니다. 본문에 없는 수치를 추정·계산·생성하지 마십시오.
- value 필드에는 본문 표기 그대로 인용합니다. 단위·반올림·기호 변경 금지.
- 효과크기와 신뢰구간이 한 쌍으로 보고되면 하나의 item으로 묶습니다 (예: "OR 1.85 (95% CI 1.42-2.41)").
- 통계적 단정 금지 ("X가 Y의 원인이다", "X해야 한다" 등). "본 연구에서 ~을 보였다" / "~을 시사한다" 형식 사용.
- 본문에 통계 수치가 전혀 없으면 items를 빈 배열로, summary에 "본 논문에는 통계 수치가 보고되지 않았습니다."를 적습니다.

각 수치는 아래 3단으로 설명합니다(초심자 눈높이가 핵심):
1) plain — 이 지표가 "무엇인지" 통계를 모르는 사람도 알 수 있게 한 문장으로. 일반 정의.
   예: "HR(위험비)는 어떤 사건이 비교군보다 더 빨리·자주 생기는 정도를 나타내는 값으로, 1이면 차이 없음."
2) interpretation — 일반 정의가 아니라 "본문의 이 수치를 직접 대입"해 무슨 뜻인지.
   예: "HR 0.74는 치료군의 사건 위험이 대조군보다 약 26% 낮았음을 뜻합니다."
3) clinicalMeaning — 본 연구 맥락에서의 임상적 함의 1~2문장. 본문에 없는 권고·일반화 금지.

importance(중요도) — 연구 "결과값"을 최우선합니다:
- "핵심": 중재가 결과(outcome)에 미친 영향을 보여주는 효과추정치 — HR · RR · OR · effect size(SMD·Cohen's d 등) · mean difference · 위험차 · ARR · NNT, 그리고 그에 딸린 CI·p값. 본문에 이런 결과값이 있으면 반드시 "핵심"으로 분류하고 가장 먼저 보여줍니다.
- "보조": 연구의 질·방법론을 평가한 수치(GRADE 등급 비율, AMSTAR 분류 수/비율 등)와 표본수·포함 연구 수·발표 연도 같은 배경 수치. 결과값이 아니므로 핵심이 될 수 없습니다.
- 정렬은 핵심을 앞에 둡니다.

caution(자주 하는 오해 — 없으면 빈 문자열 ""):
- 신뢰구간(CI)이 "귀무값"을 포함하면 반드시 경고를 적습니다.
  · 비율 지표(OR·RR·HR 등)의 귀무값은 1 → CI가 1을 포함하면 "이 CI는 1을 포함하여 통계적으로 유의하지 않을 수 있습니다."
  · 차이 지표(mean difference·RD 등)의 귀무값은 0 → CI가 0을 포함하면 "이 CI는 0을 포함하여 통계적으로 유의하지 않을 수 있습니다."
- 그 밖에 초심자가 흔히 오해할 지점이 있으면 한 줄로(예: "p값은 효과 크기가 아니라 우연 가능성을 나타냅니다"). 없으면 "".

정렬: importance가 "핵심"인 항목을 앞에 둡니다.
summary: 본 논문 통계 결과 전체를 1~2문장으로 종합. 추가 해석·일반화 금지.

반드시 아래 JSON 스키마만 출력하세요. 주석, 코드블록 표시(\`\`\`), 다른 설명 없이 JSON 객체만 출력합니다.
{
  "items": [
    {
      "metric": "수치 종류 (예: p-value, OR + 95% CI, HR + 95% CI, NNT)",
      "value": "본문 표기 그대로 (예: \\"p < 0.001\\", \\"OR 1.85 (95% CI 1.42-2.41)\\")",
      "plain": "이 지표가 무엇인지 초심자용 한 문장 정의",
      "interpretation": "본문의 이 수치를 대입한 해석 1~2문장",
      "clinicalMeaning": "본 연구 맥락에서의 임상 함의 1~2문장",
      "importance": "핵심 또는 보조",
      "caution": "오해 경고 한 줄 또는 빈 문자열"
    }
  ],
  "summary": "본 논문 통계 결과 종합 1~2문장"
}`;

function extractJson(text: string): StatisticsResult {
  const trimmed = text.trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end === -1) {
    throw new Error("Claude 응답에서 JSON을 찾지 못했습니다.");
  }
  const slice = trimmed.slice(start, end + 1);
  const parsed = JSON.parse(slice) as Partial<StatisticsResult>;
  return {
    items: Array.isArray(parsed.items)
      ? parsed.items
          .filter(
            (it): it is StatItem =>
              typeof it?.metric === "string" &&
              typeof it?.value === "string" &&
              typeof it?.interpretation === "string" &&
              typeof it?.clinicalMeaning === "string",
          )
          .map((it) => ({
            metric: it.metric,
            value: it.value,
            plain: typeof it.plain === "string" ? it.plain : "",
            interpretation: it.interpretation,
            clinicalMeaning: it.clinicalMeaning,
            importance: (it.importance === "핵심" ? "핵심" : "보조") as
              | "핵심"
              | "보조",
            caution: typeof it.caution === "string" ? it.caution : "",
          }))
          .sort((a, b) =>
            a.importance === b.importance
              ? 0
              : a.importance === "핵심"
                ? -1
                : 1,
          )
      : [],
    summary: parsed.summary ?? "",
  };
}

export async function POST(request: Request) {
  try {
    const { title, abstract, fullText, summaryContext } = await request.json();

    if (!abstract || typeof abstract !== "string") {
      return NextResponse.json(
        { error: "abstract 필드가 필요합니다." },
        { status: 400 },
      );
    }

    const userContent = [
      title ? `제목: ${title}` : null,
      `초록:\n${abstract}`,
      fullText && typeof fullText === "string"
        ? `[본문 발췌 — Methods/Results]\n${fullText}`
        : null,
      summaryContext && typeof summaryContext === "string"
        ? `[이미 분석된 요약 — 참고용]\n${summaryContext}`
        : null,
    ]
      .filter(Boolean)
      .join("\n\n");

    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 6144,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userContent }],
    });

    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("\n");

    const result = extractJson(text);

    return NextResponse.json({
      statistics: result,
      usage: response.usage,
    });
  } catch (error) {
    if (error instanceof Anthropic.APIError) {
      return NextResponse.json(
        { error: error.message, status: error.status },
        { status: error.status ?? 500 },
      );
    }
    const message =
      error instanceof Error ? error.message : "알 수 없는 오류가 발생했습니다.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
