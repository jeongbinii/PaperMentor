import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";

const client = new Anthropic();

export type GuideStep = {
  order: number;
  section: string;
  goal: string;
  lookFor: string[];
  watchOut: string;
  helperTab: "background" | "translate" | "stats" | "reliability" | "quiz" | "";
  anchor?: string; // 이 단계가 가리키는 원문 대표 문장(영어 verbatim). 없으면 ""
};

export type Positioning = {
  intervention: string;
  lineOfTherapy: string;
  status: string;
  comparator: string;
  clinicalContext: string;
};

export type ReadingGuideResult = {
  firstReadFocus: string;
  steps: GuideStep[];
  positioning: Positioning | null;
};

const SYSTEM_PROMPT = `당신은 의대 저학년·논문 초심자에게 "논문 읽는 법" 자체를 가르치는 한국어 AI 튜터입니다.
주어진 한 편의 논문에 대해, 이 논문을 처음 읽는 사람이 길을 잃지 않도록 "스텝바이스텝 읽기 길잡이"를 만듭니다.

핵심 철학:
- 단순 요약이 아닙니다. 독자가 "스스로" 본문에서 무엇을 찾아야 하는지 짚어주어, 어떤 논문에든 통하는 읽기 능력을 길러줍니다.
- 전문가의 읽기 순서(제목·초록 → 그림·표 → 방법 → 결과 → 고찰)를 이 논문에 맞게 구체화합니다.
- 초심자가 가장 막히는 두 지점을 특별히 겨냥합니다: (1) 통계·의학용어, (2) "이 치료/중재가 지금 임상에서 어떤 위치인지"의 모호함.

출력 구성:
1) firstReadFocus: 이 논문을 "처음 읽는다면" 어디에 집중하고 어떤 순서로 볼지 알려주는 2~3문장 오리엔테이션. 이 논문 고유의 특징(연구유형·규모·핵심 주장)을 반영. 일반론 금지.

2) steps: 읽기 단계 4~6개. 전문가 순서대로. 각 단계:
   - order: 1부터의 순번
   - section: 어느 부분을 읽는지. 예: "제목·초록", "그림·표 훑기", "방법(Methods)", "결과(Results)", "고찰·결론(Discussion)". 이 논문에 맞게 조정 가능.
   - goal: 이 단계에서 "무엇을 얻어야 하는가"를 1문장으로. 왜 지금 이걸 보는지.
   - lookFor: 그 부분에서 독자가 직접 찾아야 할 구체적 단서·질문 2~3개. 이 논문의 실제 내용에 근거한 구체적 표현(예: "일차 평가변수가 무엇이고 본문 어디에 정의돼 있는지", "대조군이 위약인지 실제 약인지"). 막연한 말 금지.
   - watchOut: 이 단계에서 초심자가 흔히 놓치거나 오해하는 점 1문장. 없으면 빈 문자열.
   - helperTab: 이 단계에서 막히면 도움 되는 PaperMentor 탭. 정확히 다음 중 하나의 문자열만: "background"(배경 개념), "stats"(통계 수치 해석), "quiz"(퀴즈), 또는 해당 없으면 ""(빈 문자열). 단계 성격에 맞게 고르되 억지로 채우지 말 것. (용어·번역/신뢰도 탭은 현재 비활성이므로 추천하지 마십시오.)
   - anchor: 이 단계가 본문에서 가리키는 "대표 한 문장"을, 제공된 초록·본문 발췌에서 "원문 언어(영어) 그대로, 한 글자도 바꾸지 말고" 복사합니다. 독자가 그 문장을 클릭하면 원문의 해당 위치로 이동합니다.
     · 반드시 제공된 텍스트(초록 또는 본문 발췌)에 "그대로 존재하는 연속된 부분 문자열"이어야 합니다. 번역·요약·짜깁기 금지.
     · 그 단계가 가리키는 부분이 제공된 텍스트 안에 없으면(예: 그림·표 훑기, 또는 발췌에 없는 고찰 부분) 빈 문자열("")로 둡니다. 억지로 만들지 마십시오.
     · 단서가 여럿이면 그 단계의 핵심을 가장 잘 대표하는 한 문장을 고릅니다(수치가 있으면 그 문장 우선).

3) positioning: 이 연구의 치료/중재가 현재 임상에서 어떤 위치인지. 초심자가 가장 모호해하는 부분. 치료·약물·중재·예방 연구이면 반드시 채우고, 순수 기전연구·진단정확도·역학연구 등 "치료 포지셔닝"이 무의미하면 null로 둡니다.
   - intervention: 이 논문이 평가하는 중재(약물·시술·전략)가 무엇인지 한 줄.
   - lineOfTherapy: 1차/2차/3차 치료 등 치료 단계상 위치. 본문에서 단정 못 하면 "본문에 명시되지 않음".
   - status: 표준 치료인지, 실험적/신약인지, 기존 약물의 새 적응증·재평가인지 등.
   - comparator: 무엇과 비교했고(위약·표준치료·다른 약 등), 왜 그 비교가 임상적으로 의미 있는지.
   - clinicalContext: 현재 진료에서 이 중재가 놓인 맥락을 1~2문장. 기존 표준 대비 어떤 빈자리를 노리는지.

엄수 규칙:
- 본문·초록에 근거한 내용만. 추측·과장·없는 수치 생성 금지. 본문에 없으면 "본문에 명시되지 않음"으로.
- 임상 권고("~해야 한다") 생성 금지. 어디까지나 "읽는 법" 안내.
- 모든 출력은 한국어. 의학용어·약어는 한글(영어) 병기.
- [초심자 풀어쓰기] goal·lookFor·watchOut에서 낯선 실험기법·모델·약어가 처음 나오면, 한글(영어) 병기에 더해 "그것이 무엇을 하는/보는 것인지"를 한 구절로 덧붙여 그 문장만 읽어도 초심자가 이해되게 합니다. 예: "ChIP assay(특정 단백질이 DNA의 어느 부위에 결합하는지 확인하는 실험)", "루시퍼레이스 리포터(유전자 스위치가 켜지는 정도를 빛으로 측정하는 실험)", "공면역침강(co-IP — 두 단백질이 실제로 결합하는지 보는 실험)", "Cre-lox(특정 세포에서만 유전자를 없애는 기법)". 뜻풀이는 표준 지식만 쓰고, 논문에 없는 사실은 지어내지 마십시오.

반드시 아래 JSON 스키마만 출력하세요. 주석, 코드블록 표시(\`\`\`), 다른 설명 없이 JSON 객체만 출력합니다.
{
  "firstReadFocus": "2~3문장 오리엔테이션",
  "steps": [
    {
      "order": 1,
      "section": "제목·초록",
      "goal": "1문장",
      "lookFor": ["구체적 단서1", "구체적 단서2"],
      "watchOut": "1문장 또는 빈 문자열",
      "helperTab": "background",
      "anchor": "제공된 텍스트에서 원문 그대로 복사한 대표 문장 (없으면 빈 문자열)"
    }
  ],
  "positioning": {
    "intervention": "한 줄",
    "lineOfTherapy": "1차/2차 등 또는 본문에 명시되지 않음",
    "status": "표준/실험적 등",
    "comparator": "비교 대상과 이유",
    "clinicalContext": "1~2문장"
  }
}`;

// 현재 활성화된 도움 탭만 허용 (translate·reliability는 비활성 → "" 처리)
const VALID_TABS = ["background", "stats", "quiz", ""];

function coerceStep(s: Partial<GuideStep>, idx: number): GuideStep {
  const tab =
    typeof s?.helperTab === "string" && VALID_TABS.includes(s.helperTab)
      ? (s.helperTab as GuideStep["helperTab"])
      : "";
  return {
    order: typeof s?.order === "number" ? s.order : idx + 1,
    section: typeof s?.section === "string" ? s.section : "",
    goal: typeof s?.goal === "string" ? s.goal : "",
    lookFor: Array.isArray(s?.lookFor)
      ? s.lookFor.filter((x): x is string => typeof x === "string")
      : [],
    watchOut: typeof s?.watchOut === "string" ? s.watchOut : "",
    helperTab: tab,
    anchor: typeof s?.anchor === "string" ? s.anchor : "",
  };
}

function coercePositioning(p: unknown): Positioning | null {
  if (!p || typeof p !== "object") return null;
  const o = p as Partial<Positioning>;
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const result = {
    intervention: str(o.intervention),
    lineOfTherapy: str(o.lineOfTherapy),
    status: str(o.status),
    comparator: str(o.comparator),
    clinicalContext: str(o.clinicalContext),
  };
  // 전부 비어 있으면 null 취급
  if (!Object.values(result).some(Boolean)) return null;
  return result;
}

function tryParse(s: string): unknown | undefined {
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
}

// 응답이 max_tokens 등으로 중간에 잘려 JSON이 미완성일 때, 열린 괄호/문자열을
// 닫아 가장 큰 유효 부분만 살려낸다.
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
  if (inStr) out += '"'; // 문자열 중간에서 잘렸으면 닫아준다
  out = out.replace(/[,:\s]+$/, ""); // 끝의 쉼표/콜론/공백 제거
  while (stack.length) out += stack.pop();
  return out;
}

function looseParse(slice: string): unknown | undefined {
  const direct = tryParse(slice);
  if (direct !== undefined) return direct;
  const balanced = tryParse(balanceAndClose(slice));
  if (balanced !== undefined) return balanced;
  // 마지막 완성된 객체('}') 경계까지 잘라가며 복구 시도
  let end = slice.lastIndexOf("}");
  while (end > 0) {
    const cand = tryParse(balanceAndClose(slice.slice(0, end + 1)));
    if (cand !== undefined) return cand;
    end = slice.lastIndexOf("}", end - 1);
  }
  return undefined;
}

function extractJson(text: string): ReadingGuideResult {
  const trimmed = text.trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end === -1) {
    throw new Error("Claude 응답에서 JSON을 찾지 못했습니다.");
  }
  const slice = trimmed.slice(start, end + 1);
  const parsed = looseParse(slice) as Partial<ReadingGuideResult> | undefined;
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Claude 응답을 JSON으로 해석하지 못했습니다.");
  }
  return {
    firstReadFocus:
      typeof parsed.firstReadFocus === "string" ? parsed.firstReadFocus : "",
    steps: Array.isArray(parsed.steps)
      ? parsed.steps.map((s, i) => coerceStep(s as Partial<GuideStep>, i))
      : [],
    positioning: coercePositioning(parsed.positioning),
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
      max_tokens: 7680,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userContent }],
    });

    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("\n");

    const result = extractJson(text);

    return NextResponse.json({
      guide: result,
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
