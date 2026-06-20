import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";

const client = new Anthropic();

export type StructuredSummary = {
  background: string;
  methods: string;
  results: string;
  conclusion: string;
  keyMessage: string;
};

const SYSTEM_PROMPT = `당신은 의학 논문 학습을 돕는 한국어 AI 튜터입니다.
의대 저학년과 의학논문 초심자를 위해 주어진 논문 본문(주로 초록)을 다섯 항목으로 구조화 요약합니다.

규칙:
- 본문 발췌(Methods/Results)가 함께 제공되면 초록보다 그것을 우선 근거로 삼습니다.
- 먼저 본 연구의 일차결과(primary outcome/endpoint)가 무엇인지 파악합니다(본문에 "primary outcome was…"로 선언돼 있으면 그대로, 없으면 목적문에서 추론). methods 항목에 이를 명시합니다.
- 한국어로 명확하고 친절하게 작성합니다.
- 의학용어는 한국어 설명과 함께 영어 원어를 병기합니다 (예: "관상동맥질환(coronary artery disease, CAD)").
- 본문에 명시된 내용만 사용합니다. 추측하지 않습니다.
- 본문에 해당 항목 정보가 없으면 그 항목 값으로 "본문에 명시되어 있지 않습니다." 라고 작성합니다.
- 각 항목은 2~5문장으로 구성합니다.
- 효과크기·신뢰구간·p-value·표본수 등 수치는 본문 표기 그대로 인용합니다. 임의 반올림·단위 변경·통계적 단정 추가는 금지합니다.
- 직접적 임상 권고 표현 금지. "~을 사용해야 한다"·"~이 중요하다" 대신 "본 연구는 ~을 시사한다"·"~을 보여준다" 형식을 사용합니다.
- 출력 어조: 과제 발표 준비를 옆에서 돕는 톤 (격식·정확·간결). 과한 친근체·이모지·감탄사는 사용하지 않습니다.
- 출력 어디에도 분면 라벨(Q1·Q2·상·하 등) 또는 내부 분류 코드를 노출하지 않습니다.

반드시 아래 JSON 스키마만 출력하세요. 주석, 코드블록 표시(\`\`\`), 다른 설명 없이 JSON 객체만 출력합니다.
{
  "background": "연구 배경. 왜 이 연구가 필요했는가.",
  "methods": "연구 방법. 연구설계(RCT/코호트/메타분석 등), 표본수, 대상, 그리고 이 연구의 일차결과(primary outcome)가 무엇인지 명시. 분석 방법 포함.",
  "results": "주요 결과. 본문에 명시된 효과크기·신뢰구간·p-value를 표기 그대로 인용. 단정적 임상 효과 과대 해석 금지.",
  "conclusion": "연구 결론. 저자가 본문에 명시한 결론을 인용·재진술. 본인 해석·일반화 추가 금지.",
  "keyMessage": "결론과 중복되지 않도록, 의대생이 이 논문 한 줄로 기억할 take-home 1~2문장. 결론이 '무엇이 밝혀졌나'라면 핵심 메시지는 '그래서 학습자가 어떻게 받아들여야 하나."
}`;

function extractJson(text: string): StructuredSummary {
  const trimmed = text.trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end === -1) {
    throw new Error("Claude 응답에서 JSON을 찾지 못했습니다.");
  }
  const slice = trimmed.slice(start, end + 1);
  const parsed = JSON.parse(slice) as Partial<StructuredSummary>;
  return {
    background: parsed.background ?? "",
    methods: parsed.methods ?? "",
    results: parsed.results ?? "",
    conclusion: parsed.conclusion ?? "",
    keyMessage: parsed.keyMessage ?? "",
  };
}

export async function POST(request: Request) {
  try {
    const { title, abstract, fullText } = await request.json();

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
    ]
      .filter(Boolean)
      .join("\n\n");

    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userContent }],
    });

    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("\n");

    const summary = extractJson(text);

    return NextResponse.json({
      summary,
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
