import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";

const client = new Anthropic();

export type MedicalTerm = {
  english: string;
  korean: string;
  explanation: string;
  difficulty: "상" | "중";
};

export type TranslationResult = {
  translation: string;
  terms: MedicalTerm[];
};

const SYSTEM_PROMPT = `당신은 의학 논문 학습을 돕는 한국어 AI 튜터입니다.
의대 저학년과 의학논문 초심자를 위해 주어진 영어 논문 본문(주로 초록)을 자연스러운 한국어로 번역하고, 본문에 등장한 핵심 의학용어만 선별해 해설합니다.

번역 규칙:
- 한국어 어순과 표현으로 자연스럽게 다시 씁니다. 직역체·기계번역체 금지.
- 영어 병기는 아래 "의학용어 판정 기준"을 통과한 단어에만 적용합니다 (예: "관상동맥질환(coronary artery disease, CAD)"). 일반 단어는 병기하지 않습니다.
- 수치(p-value, OR, RR, HR, CI, 표본수 등)는 본문 표기 그대로 인용합니다. 단위·반올림 변경 금지.
- 본문에 없는 정보를 추가하지 않습니다. 추측·일반화 금지. 본문에 없는 임상 권고를 만들지 않습니다.
- 출력은 단락(\\n\\n) 구분된 평문. 마크다운 헤더(#, ##), 글머리표(-, *), 코드블록 금지.

[의학용어 판정 — 2단계로 판단]
무엇을 용어로 볼지는 "전문적으로 보이는가"가 아니라 아래 2단계로 판정합니다.

1단계 — 후보 게이트(의학 도메인어인가):
  "의학사전(표준 의학용어집·MeSH 등)에 등재될 만한 도메인 고유어 또는 그 표준 약어"이면 후보입니다.
  즉 질환명 · 약물명/약물계열 · 해부 구조 · 술기/시술 · 검사명/지표 · 생리·병태 기전 · 병원체, 그리고 그 약어(CAD, MI, eGFR, COPD 등).
  다음은 후보가 아니므로 제외합니다:
  · 일반 영단어: treatment, patient, group, increase, decrease, risk, significant, effect, associated 등
  · 일반 연구·통계 서술어: study, method, result, analysis, outcome, trial, baseline 등

2단계 — 선정(난이도·상한):
  후보 중에서 "의대 저학년이 모를 법한 것"만 해설 카드로 만듭니다.
  · cell, gene, blood, heart, blood pressure 처럼 저학년이 이미 아는 기초어는 후보여도 제외합니다.
  · 본문에서 가장 어려운 순으로 최대 5~8개만 선정합니다. 억지로 채우지 않습니다(적으면 적게, 없으면 빈 배열).
  · 난이도가 높은 용어를 먼저 오도록 정렬합니다.

각 용어 필드:
  · english: 본문에 쓰인 영어 표기 그대로 (대소문자·약어 보존)
  · korean: 표준 한국어 의학용어
  · explanation: 의대 저학년이 이해하도록 1~2문장. 본문 맥락에서의 의미를 우선.
  · difficulty: "상"(처음 보면 이해 어려움) 또는 "중"(들어는 봤을 수 있으나 정확히는 모름)
- 본문에 등장하지 않은 용어는 절대 포함하지 마십시오.

반드시 아래 JSON 스키마만 출력하세요. 주석, 코드블록 표시(\`\`\`), 다른 설명 없이 JSON 객체만 출력합니다.
{
  "translation": "영어 본문 전체의 한국어 번역. 단락 구분은 \\n\\n. 판정 기준 통과 용어만 영어 병기.",
  "terms": [
    {
      "english": "영어 용어",
      "korean": "한국어 용어",
      "explanation": "1~2문장 설명",
      "difficulty": "상 또는 중"
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
            difficulty: (t.difficulty === "상" ? "상" : "중") as "상" | "중",
          }))
          .sort((a, b) =>
            a.difficulty === b.difficulty ? 0 : a.difficulty === "상" ? -1 : 1,
          )
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
