import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";

const client = new Anthropic();

export type KeyFinding = {
  claim: string;
  evidence: string;
  source: string;
};

export type StructuredSummary = {
  keyFindings: KeyFinding[];
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

[핵심 결과 — keyFindings, 가장 중요]
이 논문의 핵심 결과를 "주장 + 근거 수치" 쌍으로 1~4개 만듭니다.
- claim: abstract에서 저자가 내세운 핵심 결과·쟁점을 의학적 평문 한 문장으로. (예: "운동이 폐경 여성의 우울을 개선함", "스트레스에 대한 효과는 불확실함")
- evidence: 그 주장을 뒷받침하는 본문 수치 + 짧은 해석.
  · 긍정 주장이면 "얼마나"인지 — 효과크기·CI·유의성 (예: "SMD -0.65, 95% CI -0.90~-0.40 → 중등도 효과, 유의함")
  · 애매·부정 주장이면 "왜"인지 — 작은 효과크기·CI가 귀무값(1 또는 0) 포함·연구 간 상충 등 (예: "효과크기 작고 95% CI가 0을 포함하여 유의하지 않음")
- abstract의 주장을 우선으로 잡되, 본문 발췌(Methods/Results)로 수치를 보강합니다. 본문에 정량 수치가 없으면 evidence에 "본문에 정량 수치 없음"이라고 적습니다.
- [풀어쓰기 — 중요] claim과 evidence는 "그 항목만 따로 읽어도" 초심자가 이해되도록 씁니다. 낯선 동물모델·약어·측정지표·시점·전문용어가 나오면 그 자리에서 짧은 괄호·삽입구로 뜻을 덧붙여 자립적인 문장으로 만듭니다.
  · 예: "산소유발망막병증(OIR — 갓 태어난 쥐를 고농도 산소에 뒀다가 정상 산소로 되돌려 허혈성 망막병증을 재현하는 표준 동물모델)", "P17(생후 17일)", "유리체액(안구 속을 채운 젤 형태의 액체)", "상향 조절(발현량이 늘어남)".
  · 뜻풀이는 널리 알려진 표준 배경지식만 사용합니다. 이 논문의 결과·수치·결론을 새로 지어내지 마십시오(수치가 본문에 없으면 "본문에 구체적 수치 없음"이라고 적습니다).
  · 뜻풀이는 핵심 용어에만, 한 구절 수준으로 짧게 답니다. 문장이 장황해지지 않게 합니다.
- 본문에 없는 수치를 만들지 마십시오.
- source: 이 claim의 직접적 근거가 된 원문 문장을, 제공된 초록·본문에서 "있는 그대로(verbatim) 한 글자도 바꾸지 말고" 복사합니다.
  · 원문의 언어(주로 영어) 그대로. 한국어로 번역하지 마십시오.
  · 1~2개 연속된 문장. 중간을 생략(…)하거나 여러 군데를 이어붙이지 마십시오. 반드시 원문에 그대로 존재하는 "연속된 부분 문자열"이어야 합니다(독자가 원문에서 형광펜으로 찾을 수 있어야 함).
  · 가장 근거가 되는 한 문장이 핵심입니다. 수치가 있으면 그 수치가 들어 있는 문장을 고릅니다.
  · 적절한 단일 근거 문장을 찾지 못하면 빈 문자열("")로 둡니다.

반드시 아래 JSON 스키마만 출력하세요. 주석, 코드블록 표시(\`\`\`), 다른 설명 없이 JSON 객체만 출력합니다.
{
  "keyFindings": [
    {
      "claim": "핵심 결과·쟁점 (의학적 평문 한 문장, 낯선 용어는 짧게 풀어서)",
      "evidence": "주장을 뒷받침하는 본문 수치 + 해석 (얼마나/왜). 모델·약어·시점은 뜻을 덧붙여 그 항목만 읽어도 이해되게",
      "source": "이 결과의 근거가 된 원문 문장을 원어 그대로 복사 (없으면 빈 문자열)"
    }
  ],
  "background": "연구 배경. 왜 이 연구가 필요했는가.",
  "methods": "연구 방법. 연구설계(RCT/코호트/메타분석 등), 표본수, 대상, 그리고 이 연구의 일차결과(primary outcome)가 무엇인지 명시. 분석 방법 포함.",
  "results": "주요 결과. 본문에 명시된 효과크기·신뢰구간·p-value를 표기 그대로 인용. 단정적 임상 효과 과대 해석 금지.",
  "conclusion": "연구 결론. 저자가 본문에 명시한 결론을 인용·재진술. 본인 해석·일반화 추가 금지.",
  "keyMessage": "결론과 중복되지 않도록, 의대생이 이 논문 한 줄로 기억할 take-home 1~2문장. 결론이 '무엇이 밝혀졌나'라면 핵심 메시지는 '그래서 학습자가 어떻게 받아들여야 하나."
}`;

function tryParse(s: string): unknown | undefined {
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
}

// 응답이 max_tokens 등으로 잘려 JSON이 미완성일 때, 열린 괄호/문자열을 닫아 복구한다.
function balanceAndClose(s: string): string {
  let inStr = false;
  let esc = false;
  const stack: string[] = [];
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    out += c;
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "{") stack.push("}");
    else if (c === "[") stack.push("]");
    else if (c === "}" || c === "]") stack.pop();
  }
  if (inStr) out += '"';
  out = out.replace(/[,:\s]+$/, "");
  while (stack.length) out += stack.pop();
  return out;
}

function looseParse(slice: string): unknown | undefined {
  const direct = tryParse(slice);
  if (direct !== undefined) return direct;
  const balanced = tryParse(balanceAndClose(slice));
  if (balanced !== undefined) return balanced;
  let end = slice.lastIndexOf("}");
  while (end > 0) {
    const cand = tryParse(balanceAndClose(slice.slice(0, end + 1)));
    if (cand !== undefined) return cand;
    end = slice.lastIndexOf("}", end - 1);
  }
  return undefined;
}

function extractJson(text: string): StructuredSummary {
  const trimmed = text.trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end === -1) {
    throw new Error("Claude 응답에서 JSON을 찾지 못했습니다.");
  }
  const slice = trimmed.slice(start, end + 1);
  const parsed = (looseParse(slice) ?? {}) as Partial<StructuredSummary>;
  return {
    keyFindings: Array.isArray(parsed.keyFindings)
      ? parsed.keyFindings
          .filter(
            (f): f is KeyFinding =>
              typeof f?.claim === "string" && typeof f?.evidence === "string",
          )
          .map((f) => ({
            claim: f.claim,
            evidence: f.evidence,
            source: typeof f.source === "string" ? f.source : "",
          }))
      : [],
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
      max_tokens: 5120,
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
