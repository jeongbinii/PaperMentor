# PaperMentor 12주 개발 흐름

> **한 줄 요약:** "집 짓기" — 1~2주에 기초, 3~7주에 핵심 기능, 8~10주에 추가 기능 및 안정화, 11~12주에 사용자 테스트 및 마무리.

---

## 개요

| 항목 | 내용 |
|---|---|
| 프로젝트 | PaperMentor |
| 기간 | 2026.05.01 ~ 07.24 (12주) |
| 핵심 체크포인트 | 7주차 — P0 6개 기능 모두 연결된 프로토타입 완성 |
| 7주차 이후 | 여유 있을 때 P1 기능 추가 (퀴즈, 신뢰도 카드, 시각화) |

---

## 주차별 상세

### 1주차 (5/1~5/7) — 환경 세팅 ✅

- API 키 발급 (Claude, Supabase, Vercel, Pinecone, Voyage AI)
- GitHub 저장소 생성 및 팀 작업 규약 정의
- **완성 기준:** 모든 계정·키 세팅 완료, 두 개발자가 같은 repo 공유

---

### 2주차 (5/8~5/14) — 앱 골격 생성 ✅

- 3분할 레이아웃 생성 (좌: 논문 검색, 중: 요약, 우: 기능 패널)
- Claude API 연동 테스트
- **완성 기준:** 브라우저에서 열리는 웹앱 존재, Claude API 응답 확인

---

### 3주차 (5/15~5/21) — 논문 불러오기 + 요약 ✅ (완료: 2026-05-24)

> ⚠️ 이 기능이 동작해야 이후 모든 기능이 연결됨. 가장 중요한 주차.

- PubMed ID / DOI 입력 → 논문 본문 fetch
- Claude로 구조화 요약 출력: 배경 / 방법 / 결과 / 결론 / 핵심메시지
- **완성 기준:** PubMed ID 입력 → 5개 항목 요약이 화면에 출력 ✅

**산출물**

- `POST /api/pubmed` — PMID 또는 DOI 입력 → NCBI E-utilities(esearch/esummary/efetch)로 메타데이터 + 초록 반환
- `POST /api/summarize` — 초록 → 5필드 JSON 구조화 요약 (Claude Sonnet 4.6, 한국어 + 의학용어 영어 병기)
- `app/page.tsx` — 좌(검색·최근목록) / 중(5섹션 요약) / 우(Q&A·번역탭 placeholder) 3분할 레이아웃 통합

---

### 4주차 (5/22~5/28) — 번역·설명 + 통계 해석 + 중간보고 ✅ (완료: 2026-06-04)

- 의학 특화 번역 (의학용어는 영어 유지, 나머지는 자연스러운 한국어)
- 통계 해석: p-value, OR, CI 등을 논문 맥락에서 풀어 설명
- 중간보고 자료 준비
- **완성 기준:** 번역·설명 탭 + 통계 해석 탭 각각 작동, 중간보고 PPT 준비 완료 ✅

**산출물**

- `POST /api/translate` — 초록 → `{ translation, terms[] }` JSON (Claude Sonnet 4.6, 자연스러운 한국어 + 의학용어 영어 병기 + 핵심 의학용어 5~10개 해설)
- `POST /api/stats` — 초록 → `{ items[], summary }` JSON (Claude Sonnet 4.6, p-value/OR/HR/CI/NNT 등 추출 + 통계적 의미 + 임상적 함의)
- `app/page.tsx` — `RightTab` 타입에 `"stats"` 추가, `LoadedPaper`에 `translation`/`statistics` optional 필드 통합, 우측 사이드바에 "번역·설명" / "통계 해석" 탭 UI 채움
- 탭 캐싱 패턴 확립: `handleTabChange()`에서 첫 클릭 시 fetch → `loadedPaper` 갱신 → 재클릭 시 즉시 표시 (README의 lazy 캐싱 규칙)
- 중간보고 PPT (팀에서 별도 작성)

---

### 5주차 (5/29~6/4) — 배경지식 보완 + PDF 업로드 ✅ (완료: 2026-06-11)

- 논문 읽기 전 사전 개념 카드 3~5개 자동 생성
- 논문 본문에 직접 기술되지 않은 배경 개념 포함
- PDF 파일 업로드 → 기존 PMID/DOI 파이프라인으로 편입
- **완성 기준:** 배경지식 탭에 카드 3~5개 자동 생성 + PDF 업로드 시 요약까지 동일하게 작동 ✅

**산출물**

- `POST /api/background` — `{ title, abstract }` → `{ cards: [{ concept, summary, importance }] }` JSON (Claude Sonnet 4.6, 사전 개념 카드 3~5개 + 본 논문 이해에 필요한 이유)
- `POST /api/pdf` — PDF 파일(FormData, ≤32MB) → Claude에 base64 document 블록으로 전달 → `{ paper }` (제목/초록/저자/저널/연도/DOI 추출, 기존 `PubMedPaper` 모양). pmid는 DOI 또는 `pdf:<파일명>` 합성 식별자
- `app/page.tsx` — `RightTab`에 `"background"` 추가, `LoadedPaper`에 `background?` 필드, "배경지식" 탭 UI(`handleBackground` lazy 캐싱), 좌측 사이드바에 "PDF 업로드" 입력 추가, `summarizeAndLoad()` 헬퍼로 PMID/DOI·PDF 경로 공유

**4주차 자산 활용**

- `/api/summarize`, `/api/translate`, `/api/stats` 패턴 그대로 복제해서 `/api/background` 신규 라우트 생성 권장 (시스템 프롬프트 + JSON 강제 출력 + `extractJson`)
- 입력은 동일하게 `{ title, abstract }` 받아 `{ cards: [{ concept, summary, importance }] }` 형태 JSON 출력
- `app/page.tsx`의 `LoadedPaper` 타입에 `background?: BackgroundResult` optional 필드 추가
- `RightTab` 타입에 `"background"` 추가, `handleTabChange()` 분기에 추가
- 탭 캐싱 패턴(`handleTranslate`/`handleStatistics`) 그대로 복제하여 `handleBackground` 핸들러 생성
- 다른 탭과 다르게 README는 "진입 시 자동 생성"으로 명시되어 있음 — `handleAnalyzePaper` 마지막에 자동 호출하는 것도 옵션
- PDF 업로드: 파일 선택 UI 추가, base64 변환 후 Claude API에 직접 전달, 추출된 title/abstract를 기존 파이프라인에 편입

---

### 6주차 (6/5~6/11) — Intra-paper QA

- 논문 전체 본문을 컨텍스트로 제공 후 사용자 질문에 응답
- 논문 범위 내 답변만 제공, 없는 내용은 명시적으로 "이 논문에 없습니다" 응답
- 응답 시 섹션 참조 포함 (예: `[Methods]`, `[Table 2]`)
- **완성 기준:** QA 입력 → 논문 내 섹션 참조와 함께 답변 출력

---

### 7주차 (6/12~6/18) — 통합 + UI 정리 🎯 핵심 체크포인트

> ⚠️ 이 체크포인트 미달 시 8~9주차 P1 기능을 포기하고 여기에 추가 시간 투입.

- P0 6개 기능을 하나의 흐름으로 연결: 불러오기 → 요약 → 번역 → 통계 → 배경지식 → QA
- 버그 수정 및 레이아웃 정리
- **완성 기준:** P0 6개 기능이 하나의 앱 안에서 끊김 없이 작동

---

### 8주차 (6/19~6/25) — P1 선택 기능 1: 퀴즈 또는 신뢰도 카드

- 퀴즈: 논문 기반 객관식 / 참거짓 문제 자동 생성
- 신뢰도 카드: 연구설계·표본수·저널 정보 시각화 (둘 중 하나 선택)
- 외부 전문가 자문 진행
- **완성 기준:** P1 기능 1개 작동

---

### 9주차 (6/26~7/2) — P1 선택 기능 2: 시각화

- Mermaid 기반 연구 구조 다이어그램 (Claude가 코드 생성)
- 시간 여유 시 Replicate API로 생성형 이미지 시도
- **완성 기준:** 논문 업로드 시 다이어그램 자동 생성

---

### 10주차 (7/3~7/9) — 내부 안정화 테스트

- 팀 내 의대생 1~2명 직접 사용 → 버그 수정
- 테스트 시나리오 문서 작성 (논문 선택, 테스트 순서 등)
- **완성 기준:** 주요 버그 없는 안정화 프로토타입 + 테스트 시나리오 준비 완료

---

### 11주차 (7/10~7/16) — 실제 사용자 테스트

- 의대생 5~10명 대상 실사용 테스트
- 5점 척도 설문 + 자유의견 수집
- **완성 기준:** 테스트 결과 보고서 (정량 + 정성 데이터) 완성

---

### 12주차 (7/17~7/24) — 최종 마무리

- 피드백 기반 수정
- 최종보고서 작성
- 후속 로드맵 정리 (PPT 생성, 협업, 커뮤니티 등 확장 계획)
- **완성 기준:** 최종 PaperMentor 버전 + 최종보고서 + 확장 로드맵

---

## 주차별 완성 상태 요약

| 주차 | 완성 상태 | 우선순위 |
|:---:|---|:---:|
| 1 | 개발 환경 세팅 완료 | — |
| 2 | 빈 웹앱 브라우저에서 열림 | — |
| 3 | 논문 입력 → 요약 출력 작동 | ✅ 2026-05-24 완료 |
| 4 | 번역·통계 해석 탭 작동 + 중간보고 | ✅ 2026-06-04 완료 |
| 5 | 배경지식 카드 + PDF 업로드 작동 | ✅ 2026-06-11 완료 |
| 6 | QA 기능 작동 | P0 🔴 |
| 7 | P0 6개 기능 모두 연결된 프로토타입 | 🎯 핵심 |
| 8 | 퀴즈 또는 신뢰도 카드 추가 | P1 🟡 |
| 9 | 시각화 추가 | P1 🟡 |
| 10 | 안정화된 버전 | — |
| 11 | 테스트 결과 보고서 | — |
| 12 | 최종 산출물 일체 | — |

---

## P0 핵심 기능 목록

- 논문 불러오기 (PubMed ID / DOI)
- 구조화 요약 (배경 / 방법 / 결과 / 결론 / 핵심메시지)
- 의학 특화 번역 및 용어 설명
- 통계 해석 (p-value, OR, CI 등)
- 배경지식 보완 카드
- Intra-paper QA

## P1 선택 기능 목록

- 이해도 퀴즈 또는 신뢰도 카드 (택 1)
- 연구 구조 시각화 (Mermaid)

---

## 기술 스택 참고

| 분류 | 기술 |
|---|---|
| Frontend | Next.js (App Router), React |
| Backend | Vercel API Routes |
| DB / Auth | Supabase |
| Vector DB | Pinecone |
| Embeddings | Voyage AI |
| LLM | Claude Sonnet (주요 기능) / Claude Haiku (보조 기능) |
| IDE | VS Code + Claude Code 확장 |
