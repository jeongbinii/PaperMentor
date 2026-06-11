import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";

const client = new Anthropic();

export type BackgroundCard = {
  concept: string;
  summary: string;
  importance: string;
};

export type BackgroundResult = {
  cards: BackgroundCard[];
};

const SYSTEM_PROMPT = `당신은 의학 논문 학습을 돕는 한국어 AI 튜터입니다.
의대 저학년과 의학논문 초심자가 주어진 논문을 읽기 "전에" 미리 알아두면 좋은 사전 배경지식 개념 카드를 3~5개 생성합니다.

목적:
- 독자가 본문을 이해하는 데 필요한 선행 개념을 미리 짚어줍니다.
- 본문에 직접 기술되지 않았더라도, 본문 주제를 이해하기 위해 전제되는 개념을 포함합니다 (예: 질환 기전, 표준 치료, 핵심 검사·지표의 정의, 연구 설계 용어).

카드 선정 규칙:
- 본 논문의 주제·방법·결과를 이해하는 데 가장 핵심이 되는 개념부터 3~5개를 고릅니다.
- 너무 일반적인 상식(예: "병원", "환자")이나, 반대로 지나치게 지엽적인 세부는 제외합니다.
- 본문에 등장하지 않은 배경 개념도 포함 가능하나, 본 논문 주제와 직접 관련된 것만 다룹니다. 무관한 일반 의학지식 나열 금지.

각 카드 규칙:
- concept: 개념 이름. 의학용어·약어는 한국어와 영어를 병기합니다 (예: "관상동맥질환(coronary artery disease, CAD)").
- summary: 그 개념을 의대 저학년이 이해할 수 있도록 2~3문장으로 설명. 정의 + 핵심 특징 중심.
- importance: 이 개념이 "본 논문을 이해하는 데" 왜 필요한지 1문장. 본 논문 맥락과 연결.
- 추측·과장 금지. 표준적이고 교과서적인 설명만. 본문에 없는 임상 권고("~해야 한다") 생성 금지.

반드시 아래 JSON 스키마만 출력하세요. 주석, 코드블록 표시(\`\`\`), 다른 설명 없이 JSON 객체만 출력합니다.
{
  "cards": [
    {
      "concept": "개념 이름 (의학용어는 영어 병기)",
      "summary": "2~3문장 개념 설명",
      "importance": "본 논문 이해에 왜 필요한지 1문장"
    }
  ]
}`;

function extractJson(text: string): BackgroundResult {
  const trimmed = text.trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end === -1) {
    throw new Error("Claude 응답에서 JSON을 찾지 못했습니다.");
  }
  const slice = trimmed.slice(start, end + 1);
  const parsed = JSON.parse(slice) as Partial<BackgroundResult>;
  return {
    cards: Array.isArray(parsed.cards)
      ? parsed.cards
          .filter(
            (c): c is BackgroundCard =>
              typeof c?.concept === "string" &&
              typeof c?.summary === "string" &&
              typeof c?.importance === "string",
          )
          .map((c) => ({
            concept: c.concept,
            summary: c.summary,
            importance: c.importance,
          }))
      : [],
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
      max_tokens: 3072,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userContent }],
    });

    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("\n");

    const result = extractJson(text);

    return NextResponse.json({
      background: result,
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
