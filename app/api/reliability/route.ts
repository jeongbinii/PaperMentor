import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";

const client = new Anthropic();

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

function extractJson(text: string): ReliabilityResult {
  const trimmed = text.trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end === -1)
    throw new Error("Claude 응답에서 JSON을 찾지 못했습니다.");
  const parsed = JSON.parse(trimmed.slice(start, end + 1)) as Partial<ReliabilityResult>;
  return {
    cards: Array.isArray(parsed.cards)
      ? parsed.cards.filter((c) => c.category && c.value)
      : [],
    overall: parsed.overall ?? "",
  };
}

export async function POST(request: Request) {
  try {
    const { title, abstract, journal, authors, pubdate, doi } =
      await request.json();

    if (!abstract) {
      return NextResponse.json(
        { error: "abstract 필드가 필요합니다." },
        { status: 400 },
      );
    }

    const systemPrompt = `당신은 의학 논문의 신뢰도와 연구 품질을 평가하는 전문가입니다.
제공된 논문 정보를 바탕으로 신뢰도 카드를 생성하세요.

반드시 아래 JSON 형식으로만 출력하세요:
{
  "cards": [
    {
      "category": "항목명",
      "value": "실제 값 또는 정보",
      "interpretation": "이 값이 의미하는 바 (2~3문장)",
      "level": "높음" | "보통" | "낮음" | "정보없음"
    }
  ],
  "overall": "전반적인 신뢰도 종합 평가 (2~3문장)"
}

평가 항목 (해당 정보가 있는 경우만 포함):
- 연구 설계 (RCT, 코호트, 증례대조 등 — 높을수록 인과관계 근거 강함)
- 표본 크기 (충분한지 여부)
- 저널 (알려진 저널인 경우 신뢰도 언급)
- 발표 연도 (최신성)
- 맹검 여부 (언급 시)
- 통계 방법 적절성`;

    const userContent = `제목: ${title ?? "정보 없음"}
저널: ${journal ?? "정보 없음"}
저자: ${Array.isArray(authors) ? authors.slice(0, 3).join(", ") : "정보 없음"}
발표연도: ${pubdate ?? "정보 없음"}
DOI: ${doi ?? "없음"}

초록:
${abstract}`;

    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 3072,
      system: systemPrompt,
      messages: [{ role: "user", content: userContent }],
    });

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n");

    const reliability = extractJson(text);
    return NextResponse.json({ reliability, usage: response.usage });
  } catch (error) {
    if (error instanceof Anthropic.APIError) {
      return NextResponse.json(
        { error: error.message, status: error.status },
        { status: error.status ?? 500 },
      );
    }
    return NextResponse.json(
      { error: "알 수 없는 오류가 발생했습니다." },
      { status: 500 },
    );
  }
}
