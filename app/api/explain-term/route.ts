import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";

const client = new Anthropic();

const SYSTEM_PROMPT = `당신은 의대 저학년·논문 초심자를 돕는 한국어 AI 튜터입니다.
사용자가 논문을 읽다가 "모르는 단어/구절"을 드래그해 물어봅니다. 그 선택 부분을 해설합니다.

규칙:
- 선택된 표현(term)을, 함께 주어진 문맥(context) 안에서의 의미로 풀어 설명합니다.
- 의대 저학년이 이해할 수 있게 1~3문장으로 간결하게. 군더더기·인사말 없이 해설만.
- 영어 의학용어면 한국어 뜻 + 영어 원어를 같이 제시합니다.
- 통계 용어·수치(예: HR, 95% CI, p-value)면 "이 맥락에서 무슨 뜻인지"를 평이하게 풀어줍니다.
- 문맥에 없는 사실을 지어내지 않습니다. 일반적인 교과서 수준 설명만.
- 선택이 너무 일반적이거나 의학과 무관하면, 그 표현의 일반적 의미만 짧게 답합니다.
- 출력은 순수 해설 텍스트(JSON·마크다운 머리표·코드블록 없이).`;

export async function POST(request: Request) {
  try {
    const { term, context, title } = await request.json();

    if (!term || typeof term !== "string") {
      return NextResponse.json(
        { error: "term 필드가 필요합니다." },
        { status: 400 },
      );
    }

    const userContent = [
      title ? `논문 제목: ${title}` : null,
      context && typeof context === "string"
        ? `문맥(이 표현이 등장한 문장/단락):\n${context}`
        : null,
      `해설할 표현: "${term}"`,
    ]
      .filter(Boolean)
      .join("\n\n");

    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 512,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userContent }],
    });

    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("\n")
      .trim();

    return NextResponse.json({
      explanation: text,
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
