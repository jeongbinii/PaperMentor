import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";

const client = new Anthropic();

type QuizQuestion = {
  question: string;
  options: string[];
  answer: number;
  explanation: string;
};

type QuizResult = {
  questions: QuizQuestion[];
};

function extractJson(text: string): QuizResult {
  const trimmed = text.trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end === -1)
    throw new Error("Claude 응답에서 JSON을 찾지 못했습니다.");
  const parsed = JSON.parse(trimmed.slice(start, end + 1)) as Partial<QuizResult>;
  const questions = Array.isArray(parsed.questions)
    ? parsed.questions.filter(
        (q) => q.question && Array.isArray(q.options) && q.options.length >= 2,
      )
    : [];
  return { questions };
}

export async function POST(request: Request) {
  try {
    const { title, abstract, fullText } = await request.json();

    if (!abstract) {
      return NextResponse.json(
        { error: "abstract 필드가 필요합니다." },
        { status: 400 },
      );
    }

    const content = fullText || abstract;

    const systemPrompt = `당신은 의대생을 위한 의학 논문 이해도 퀴즈를 출제하는 교육 전문가입니다.
제공된 논문을 바탕으로 5개의 4지선다 문제를 생성하세요.

반드시 아래 JSON 형식으로만 출력하세요:
{
  "questions": [
    {
      "question": "문제 내용",
      "options": ["선택지 A", "선택지 B", "선택지 C", "선택지 D"],
      "answer": 0,
      "explanation": "정답 해설 — 왜 이것이 정답인지, 나머지 오답은 왜 틀렸는지 구체적으로"
    }
  ]
}

출제 기준:
- 객관식 4지선다 5문제
- 논문에서 직접 확인할 수 있는 내용만 출제 (연구 설계, 주요 결과, 통계 수치, 결론 등 골고루)
- 의대 저학년이 이해할 수 있는 수준
- answer는 0~3 사이의 정수 (0이 첫 번째 선택지)`;

    const userContent = `제목: ${title ?? "정보 없음"}

${content}`;

    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: "user", content: userContent }],
    });

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n");

    const quiz = extractJson(text);
    return NextResponse.json({ quiz, usage: response.usage });
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
