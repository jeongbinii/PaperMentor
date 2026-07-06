# [보관] 상세 Graphical Abstract 생성 프롬프트 (구버전)

> **상태: 비활성화 (2026-07-06).**
> `app/api/visualize-image/route.ts`의 `buildPrompt`에서 제거하고 **"논문 유형 무관 범용 개념 시각화"** 프롬프트로 교체함.
> 향후 데이터가 풍부한 논문 전용 **'상세 모드'**가 필요하면 여기서 복원할 것.

## 왜 교체했나
1. **생성 지연**: 요약 전문(방법·결과·근거 수치)을 다 넣으니 추론형 이미지 모델(Nano Banana Pro)의 파싱·계획 부담↑ → 60초+ 지연 → Vercel Hobby 60초 상한 초과로 실패.
2. **가짜 수치 할루시네이션**: 프롬프트에 수치를 안 줘도 모델이 forest plot·effect size·막대그래프를 **지어냄** → 의료 맥락에서 오해·신뢰도 훼손 위험.
3. **구조 강요**: "대상-개입-효과"(임상시험 PICO) 틀이 모든 논문에 강제됨 → **기전·분자 논문, 리뷰, 진단 논문 등엔 안 맞음.**

→ 대안: 세부 수치·데이터 차트를 빼고 **"논문의 논리 구조를 유형에 맞게 보여주는 범용 개념 시각화"**로 전환.

---

## 구버전 프롬프트 원문

### 입력 content 조립 (데이터 풍부형)
```
제목: {title}

핵심 결과:
1. {claim}
   - 근거: {evidence}
2. {claim}
   - 근거: {evidence}
...

연구 방법: {methods}

주요 결과: {results}

결론: {conclusion}
```
(현재 범용 버전은 `주제 + 핵심 메시지(주장 3개, 수치 없음) + 결론`으로 축소)

### 지시/스타일 (한글 라벨, ko 브랜치)
```
위 내용을 한눈에 들어오도록 정리한 시각화 요약 이미지를 한 장 생성해줘. 설명 텍스트 말고 이미지를 직접 그려줘.

[스타일 규칙]
- 색은 절제해서 써. 장기·세포·환자군·기기 등 대상을 사실적으로 나타내기 위한 채색은 허용하되, 단순히 강조하려고 알록달록하게 칠하지 마. 배경·도형·화살표는 흰색과 회색, 옅은 한두 가지 색조 위주로.
- 저널 이름("NEJM" 등)이나 "graphical abstract"·"그래피컬 초록" 같은 제목/워터마크 문구를 이미지에 절대 넣지 마.
- 라벨과 텍스트는 모두 한글로, 꼭 필요한 최소한만.
```

### 지시/스타일 (영어 라벨, en 브랜치 — GPT 등 한글 깨지는 모델용)
```
Create a single graphical-abstract style summary image that captures the content above at a glance. The source text is in Korean — translate any labels you draw into clear, correctly spelled English. Draw the image itself, not explanatory prose.

[Style rules]
- Use restrained color. Realistic coloring of organs, cells, patient groups, or devices is allowed, but do not add colorful highlights merely for emphasis; keep backgrounds, shapes, and arrows mostly white, gray, and one or two pale tones.
- Never put a journal name ("NEJM" etc.) or watermark text such as "graphical abstract" in the image.
- All labels and text must be in clear, correctly spelled English, kept to the necessary minimum. Do not render any Korean characters.
```

---

## 복원 시 주의
- 상세 모드로 되살리려면 **가짜 수치 문제를 먼저 해결**해야 함(모델이 수치 차트를 창작). 진짜 수치를 넣더라도 이미지 모델은 값을 왜곡하므로, 상세 모드는 사실상 "원본 그림 사용"(→ 발표 슬라이드처럼) 방향이 더 안전.
- 관련: [[project_papermentor_image_gen]] 메모리, `feedback_papermentor_graphical_abstract_style`.
