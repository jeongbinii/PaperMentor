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
- 한국어로 명확하고 친절하게 작성합니다.
- 의학용어는 한국어 설명과 함께 영어 원어를 병기합니다 (예: "관상동맥질환(coronary artery disease, CAD)").
- 본문에 명시된 내용만 사용합니다. 추측하지 않습니다.
- 본문에 해당 항목 정보가 없으면 그 항목 값으로 "본문에 명시되어 있지 않습니다." 라고 작성합니다.
- 각 항목은 2~5문장으로 구성합니다.

반드시 아래 JSON 스키마만 출력하세요. 주석, 코드블록 표시(\`\`\`), 다른 설명 없이 JSON 객체만 출력합니다.
{
  "background": "연구 배경. 왜 이 연구가 필요했는가.",
  "methods": "연구 방법. 설계, 표본수, 대상, 분석 방법.",
  "results": "주요 결과. 핵심 수치와 효과 크기.",
  "conclusion": "연구 결론. 저자가 내린 결론.",
  "keyMessage": "임상/학습 관점의 핵심 메시지 1~2문장."
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
    const { title, abstract } = await request.json();

    if (!abstract || typeof abstract !== "string") {
      return NextResponse.json(
        { error: "abstract 필드가 필요합니다." },
        { status: 400 },
      );
    }

    const userContent = [
      title ? `제목: ${title}` : null,
      `본문:\n${abstract}`,
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
