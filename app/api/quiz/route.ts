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

// 인덱스 순열(Fisher–Yates) — 정답 위치 편향 제거용
function shufflePermutation(n: number): number[] {
  const idx = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  return idx;
}

function extractJson(text: string): QuizResult {
  const trimmed = text.trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end === -1)
    throw new Error("Claude 응답에서 JSON을 찾지 못했습니다.");
  const parsed = JSON.parse(trimmed.slice(start, end + 1)) as { questions?: unknown };
  const raw = Array.isArray(parsed.questions) ? (parsed.questions as unknown[]) : [];
  const questions: QuizQuestion[] = [];
  for (const item of raw) {
    const q = item as {
      question?: unknown;
      options?: unknown;
      answer?: unknown;
      explanation?: unknown;
    };
    if (typeof q.question !== "string" || !q.question.trim()) continue;
    if (
      !Array.isArray(q.options) ||
      !q.options.every((o) => typeof o === "string" && o.trim().length > 0)
    )
      continue;
    const options = q.options as string[];
    if (options.length < 3) continue; // 최소 3지선다
    if (!Number.isInteger(q.answer) || (q.answer as number) < 0 || (q.answer as number) >= options.length)
      continue;
    const answer = q.answer as number;
    const explanation = typeof q.explanation === "string" ? q.explanation : "";
    // 보기를 섞고 정답 인덱스를 재매핑 (LLM의 정답 위치 쏠림 제거)
    const order = shufflePermutation(options.length);
    questions.push({
      question: q.question,
      options: order.map((i) => options[i]),
      answer: order.indexOf(answer),
      explanation,
    });
  }
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

    // 초록은 저자의 결론·핵심 메시지를 담고 있어 '핵심 메시지·한계' 문제의 근거로 필수 → 본문 발췌와 함께 전달.
    const content = [
      abstract ? `초록:\n${abstract}` : "",
      fullText ? `본문 발췌(Methods/Results):\n${fullText}` : "",
    ]
      .filter(Boolean)
      .join("\n\n");

    const systemPrompt = `당신은 의대생을 위한 의학 논문 "이해도" 퀴즈를 출제하는 교육 전문가입니다.
제공된 논문을 바탕으로 4지선다 5문제를 생성하세요.

[가장 중요 — 출제 방향]
이 퀴즈의 목적은 "암기 확인"이 아니라 "논문을 제대로 이해했는지" 확인하는 것입니다.
- 좋은 문제: 연구의 핵심 주장·결과가 무엇을 의미하는지, 결과를 어떻게 해석하는지,
  그 결과가 실제 진료·임상에서 갖는 함의(치료 포지셔닝), 연구 설계를 그렇게 택한 이유,
  결과 해석 시의 한계·주의점, 저자가 전달하려는 핵심 메시지를 묻는 문제.
- 피해야 할 문제(금지): 단순 수치 암기(예: "표본 수는?", "AUC 값은?", "추적 기간은?"),
  본문에서 단어만 그대로 찾으면 풀리는 단순 사실 확인, 논문 이해와 무관한 지엽적 트리비아.
- 수치가 등장하더라도 "그 값을 외웠는지"가 아니라 "그 값이 의미하는 바를 아는지"를 물으세요.

[문제 구성 — 5문제를 아래 유형에서 골고루]
1) 이 논문의 핵심 메시지(main takeaway)
2) 주요 결과의 올바른 해석
3) 결과의 임상적 의미·치료 포지셔닝
4) 연구 설계·방법 선택의 이유, 또는 그것이 결론의 신뢰도에 주는 영향
5) 결과를 받아들일 때 주의할 점·한계

[선택지]
- 오답은 흔한 오해나 그럴듯한 함정으로 구성하세요 (명백히 틀린 보기는 지양).
- 정답은 논문 내용에 근거해 분명히 도출 가능해야 합니다.

[사실성 — 반드시]
- 문제와 해설에서 논문에 대해 진술하는 모든 사실·수치는 제공된 본문에 실제로 있는 내용이어야 합니다.
  논문에 없는 수치·결과를 논문의 내용인 것처럼 쓰지 마십시오(할루시네이션 금지).
- 오답 보기는 그럴듯하되, 논문 본문에 비추어 틀렸음이 확인 가능해야 합니다.

반드시 아래 JSON 형식으로만 출력하세요:
{
  "questions": [
    {
      "question": "문제 내용",
      "options": ["선택지 A", "선택지 B", "선택지 C", "선택지 D"],
      "answer": 0,
      "explanation": "왜 이것이 정답인지 + 주요 오답이 왜 틀렸는지, 논문 내용에 근거해 구체적으로"
    }
  ]
}

- 의대 저학년이 이해할 수 있는 수준의 한국어
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
