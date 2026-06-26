import { NextResponse } from "next/server";

// Gemini 이미지 생성 모델. 모델 ID가 다르면 .env.local의 GEMINI_IMAGE_MODEL로 교체.
const MODEL = process.env.GEMINI_IMAGE_MODEL || "gemini-2.5-flash-image-preview";

type KeyFinding = { claim?: string; evidence?: string };

export async function POST(request: Request) {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        {
          error:
            "GEMINI_API_KEY가 설정되어 있지 않습니다. .env.local에 GEMINI_API_KEY=... 를 추가한 뒤 서버를 재시작하세요.",
        },
        { status: 400 },
      );
    }

    const { title, keyFindings, methods, results, conclusion } =
      await request.json();

    const kf = Array.isArray(keyFindings)
      ? (keyFindings as KeyFinding[])
          .map(
            (f, i) =>
              `${i + 1}. ${f.claim ?? ""}${f.evidence ? `\n   - 근거: ${f.evidence}` : ""}`,
          )
          .join("\n")
      : "";

    const paperText = [
      title ? `제목: ${title}` : "",
      kf ? `핵심 결과:\n${kf}` : "",
      methods ? `연구 방법: ${methods}` : "",
      results ? `주요 결과: ${results}` : "",
      conclusion ? `결론: ${conclusion}` : "",
    ]
      .filter(Boolean)
      .join("\n\n");

    // 사용자가 지정한 프롬프트
    const prompt = `${paperText}

이 내용을 시각화자료로 요약해봐. graphical abstract 형식으로. NEJM 을 참고해봐. 한글로 만들어.`;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      const msg = data?.error?.message || `Gemini API 오류 (${res.status})`;
      return NextResponse.json({ error: msg, status: res.status }, { status: res.status });
    }

    const parts = data?.candidates?.[0]?.content?.parts ?? [];
    let image = "";
    let note = "";
    for (const p of parts) {
      const inline = p.inlineData ?? p.inline_data;
      if (inline?.data) {
        const mime = inline.mimeType ?? inline.mime_type ?? "image/png";
        image = `data:${mime};base64,${inline.data}`;
      } else if (typeof p.text === "string") {
        note += p.text;
      }
    }

    if (!image) {
      return NextResponse.json(
        {
          error:
            "Gemini가 이미지를 반환하지 않았습니다. 모델 ID(GEMINI_IMAGE_MODEL)가 이미지 생성을 지원하는지 확인하세요.",
          note,
        },
        { status: 502 },
      );
    }

    return NextResponse.json({ image, note });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "알 수 없는 오류가 발생했습니다.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
