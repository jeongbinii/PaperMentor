import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";

const client = new Anthropic();

export type MedicalTerm = {
  english: string;
  korean: string;
  explanation: string;
};

export type TranslationResult = {
  translation: string;
  terms: MedicalTerm[];
};

const SYSTEM_PROMPT = `당신은 의학 논문 학습을 돕는 한국어 AI 튜터입니다.
의대 저학년과 의학논문 초심자를 위해 주어진 영어 논문 본문(주로 초록)을 자연스러운 한국어로 번역하고, 본문에 등장한 핵심 의학용어를 별도로 해설합니다.

번역 규칙:
- 한국어 어순과 표현으로 자연스럽게 다시 씁니다. 직역체·기계번역체 금지.
- 의학용어·약물명·해부학 명칭·검사 약어는 한국어와 영어를 병기합니다 (예: "관상동맥질환(coronary artery disease, CAD)", "심근경색(myocardial infarction, MI)"). 일반 영어 단어는 병기하지 않습니다.
- 수치(p-value, OR, RR, HR, CI, 표본수 등)는 본문 표기 그대로 인용합니다. 단위·반올림 변경 금지.
- 본문에 없는 정보를 추가하지 않습니다. 추측·일반화 금지.
- 본문에 명시되지 않은 임상 권고를 만들지 않습니다 ("~해야 한다"·"~이 중요하다" 금지).
- 출력은 단락(\\n\\n) 구분된 평문. 마크다운 헤더(#, ##), 글머리표(-, *), 코드블록 금지.

핵심 의학용어 해설 규칙:
- 본문에 직접 등장한 핵심 의학용어 5~10개를 선정합니다. 일반 영어 단어(study, results 등)는 제외.
- 각 용어에 대해:
  · english: 본문에 쓰인 영어 표기 그대로 (대소문자·약어 보존)
  · korean: 표준 한국어 의학용어
  · explanation: 의대 저학년이 이해할 수 있도록 1~2문장으로 개념 설명. 본문 맥락 안에서의 의미를 우선.
- 본문에 등장하지 않은 용어는 절대 포함하지 마십시오.

반드시 아래 JSON 스키마만 출력하세요. 주석, 코드블록 표시(\`\`\`), 다른 설명 없이 JSON 객체만 출력합니다.
{
  "translation": "영어 본문 전체의 한국어 번역. 단락 구분은 \\n\\n. 의학용어는 영어 병기.",
  "terms": [
    {
      "english": "영어 용어",
      "korean": "한국어 용어",
      "explanation": "1~2문장 설명"
    }
  ]
}`;

function extractJson(text: string): TranslationResult {
  const trimmed = text.trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end === -1) {
    throw new Error("Claude 응답에서 JSON을 찾지 못했습니다.");
  }
  const slice = trimmed.slice(start, end + 1);
  const parsed = JSON.parse(slice) as Partial<TranslationResult>;
  return {
    translation: parsed.translation ?? "",
    terms: Array.isArray(parsed.terms)
      ? parsed.terms
          .filter(
            (t): t is MedicalTerm =>
              typeof t?.english === "string" &&
              typeof t?.korean === "string" &&
              typeof t?.explanation === "string",
          )
          .map((t) => ({
            english: t.english,
            korean: t.korean,
            explanation: t.explanation,
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
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userContent }],
    });

    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("\n");

    const result = extractJson(text);

    return NextResponse.json({
      translation: result,
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
