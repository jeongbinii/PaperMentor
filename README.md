# PaperMentor

> 의과대학 저학년 및 의학논문 초심자를 위한 AI 기반 의학 논문 학습 플랫폼

---

## 프로젝트 개요

PaperMentor는 오픈 액세스 의학 논문을 대상으로, 논문 이해부터 발표 준비까지
하나의 흐름 안에서 지원하는 교육 특화 AI 웹 플랫폼입니다.

- **대상**: 의과대학 저학년, 의학논문 초심자
- **기간**: 2026.05.01 ~ 2026.07.20 (12주)
- **팀**: PaperMentor (부산대학교)

---

## 핵심 기능

| # | 기능 | 우선순위 | 설명 |
|---|------|---------|------|
| 1 | 논문 불러오기 | P0 | PubMed ID / DOI / 키워드 검색 |
| 2 | 구조화 요약 | P0 | 연구 배경·방법·결과·결론·핵심 메시지 자동 요약 |
| 3 | 의학 특화 번역·설명 | P0 | 자연스러운 한국어 + 의학용어 영어 병기 |
| 4 | 통계 수치 해석 | P0 | p-value, OR, RR, HR, CI, NNT 임상적 해석 |
| 5 | 배경지식 보완 | P0 | 논문 이해에 필요한 기초 개념 카드 자동 생성 |
| 6 | Intra-paper QA | P0 | 논문 내부 근거 기반 질의응답 |
| 7 | 신뢰도 해석 보조 | P0 | 연구설계·저널·인용 등 메타데이터 카드 |
| 8 | 시각화 | P1 | Mermaid 기반 연구 구조 다이어그램 |
| 9 | 이해도 점검 퀴즈 | P1 | 논문 기반 객관식/참거짓 퀴즈 생성 |
| 10 | PPT 초안 생성 | 후속 | 발표용 슬라이드 자동 생성 |

---

## 기술 스택

| 영역 | 도구 |
|------|------|
| 프레임워크 | Next.js (App Router) |
| 스타일링 | Tailwind CSS |
| 배포 | Vercel |
| DB / 인증 | Supabase (PostgreSQL + Auth) |
| LLM | Claude API (Sonnet 4) |
| 논문 데이터 | PubMed E-utilities API, Unpaywall API |
| 시각화 | Mermaid |
| 개발 도구 | VS Code + Claude Code |

---

## 프로젝트 구조
papermentor/
├── app/
│   ├── layout.tsx
│   ├── page.tsx                  # 홈: 검색 + 히스토리
│   ├── login/
│   │   └── page.tsx              # 로그인 / 회원가입
│   ├── paper/
│   │   └── [pmid]/
│   │       └── page.tsx          # 분석 화면 (3분할 레이아웃)
│   ├── history/
│   │   └── page.tsx              # 전체 히스토리
│   └── api/
│       ├── summarize/            # 구조화 요약
│       ├── translate/            # 번역·설명
│       ├── statistics/           # 통계 해석
│       ├── background/           # 배경지식 보완
│       ├── qa/                   # Intra-paper QA
│       ├── quiz/                 # 이해도 점검 퀴즈
│       └── pubmed/               # 논문 불러오기
├── components/
│   ├── layout/
│   │   └── Navbar.tsx
│   ├── home/
│   │   ├── SearchBar.tsx         # 키워드 / PubMed ID / DOI 입력
│   │   ├── SearchResults.tsx     # 검색 결과 인라인 표시
│   │   └── RecentPapers.tsx      # 최근 분석 논문 목록
│   └── paper/
│       ├── LeftPanel.tsx         # 논문 정보 + 신뢰도 카드
│       ├── CenterPanel.tsx       # 구조화 요약 + 시각화
│       └── RightPanel/
│           ├── RightPanel.tsx    # 탭 컨테이너
│           ├── TranslateTab.tsx
│           ├── StatisticsTab.tsx
│           ├── BackgroundTab.tsx
│           ├── QATab.tsx
│           ├── QuizTab.tsx
│           └── CredibilityTab.tsx
├── lib/
│   ├── prompts/
│   │   ├── summarize.ts
│   │   ├── translate.ts
│   │   ├── statistics.ts
│   │   ├── background.ts
│   │   └── qa.ts
│   └── api/
│       ├── claude.ts
│       └── pubmed.ts
├── .env.local                    # 환경변수 (git 제외)
└── README.md

---

## 페이지 및 라우팅

| 경로 | 설명 | 접근 조건 |
|------|------|----------|
| `/login` | 로그인 / 회원가입 | 비로그인 허용 |
| `/` | 홈: 검색 + 최근 히스토리 | 로그인 필수 |
| `/paper/[pmid]` | 논문 분석 화면 | 로그인 필수 |
| `/history` | 전체 히스토리 | 로그인 필수 |

> 비로그인 상태에서 `/`, `/paper/*`, `/history` 접근 시 `/login`으로 리다이렉트

---

## 화면 구성

### 홈 (`/`)

검색창(키워드 / PubMed ID / DOI 통합 입력)과 최근 분석 논문 목록이 한 화면에 표시됩니다.
검색 결과는 별도 페이지 이동 없이 홈 하단에 인라인으로 표시되며,
논문 선택 시 `/paper/[pmid]`로 이동합니다.
OA(Open Access)가 아닌 논문은 비활성화 처리됩니다.

### 분석 화면 (`/paper/[pmid]`) — 3분할 레이아웃
┌──────────────┬─────────────────────────┬────────────────────┐
│  좌측 (20%)  │       중앙 (50%)        │    우측 (30%)      │
│              │                         │                    │
│ 논문 제목    │ 구조화 요약             │ 탭 네비게이션      │
│ 저자·저널    │  - 연구 배경            │ [번역] [통계]      │
│ 연도         │  - 연구 방법            │ [배경] [QA]        │
│              │  - 주요 결과            │ [퀴즈] [신뢰도]    │
│ 신뢰도 카드  │  - 결론                 │                    │
│  연구설계    │  - 핵심 메시지          │ 선택한 탭 내용     │
│  표본수      │                         │                    │
│  저널 IF     │ [시각화 보기] 버튼      │                    │
│  인용수      │  → Mermaid 다이어그램   │                    │
│              │                         │                    │
│ [원문 PDF]   │                         │                    │
│ [다른 논문]  │                         │                    │
└──────────────┴─────────────────────────┴────────────────────┘

**모바일**: 3분할이 하단 탭 네비게이션으로 전환 (정보 / 요약 / 번역 / QA 순)

---

## 분석 화면 자동 실행 순서

`/paper/[pmid]` 진입 시 아래 순서로 자동 실행됩니다.
1단계: 논문 본문 fetch        (PubMed / Unpaywall API)
2단계: 구조화 요약 생성       → 중앙 패널 표시
3단계: 배경지식 카드 생성     → 배경 탭에 미리 채워둠
4단계: 신뢰도 메타데이터 파싱 → 좌측 패널 표시

나머지 탭(번역·통계·QA·퀴즈)은 사용자가 탭을 클릭할 때 생성됩니다.
한 번 생성된 결과는 세션 내에서 캐싱되어 탭 재진입 시 API를 재호출하지 않습니다.

### 탭별 동작 방식

| 탭 | 첫 클릭 시 | 재클릭 시 |
|----|-----------|----------|
| 번역·설명 | Claude 호출 → 생성 | 캐시 표시 |
| 통계 해석 | Claude 호출 → 생성 | 캐시 표시 |
| 배경지식 | 이미 생성됨 (자동) | 캐시 표시 |
| 질의응답 | 입력창 표시, 질문 시 호출 | 대화 히스토리 유지 |
| 퀴즈 | "퀴즈 생성" 버튼 → 클릭 시 생성 | 생성된 퀴즈 표시 |
| 신뢰도 | 이미 생성됨 (자동) | 캐시 표시 |

---

## 환경변수 설정

`.env.local` 파일을 프로젝트 루트에 생성하고 아래 값을 채워넣으세요.

```env
# Claude API
ANTHROPIC_API_KEY=your_api_key_here

# Supabase
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key

# PubMed (선택 - rate limit 완화용)
PUBMED_API_KEY=your_pubmed_key
```

> ⚠️ `.env.local`은 절대 git에 커밋하지 마세요. `.gitignore`에 포함되어 있습니다.

---

## 시작하기

### 사전 요구사항

- Node.js 18 이상
- npm 또는 yarn
- VS Code + Claude Code 확장

### 설치 및 실행

```bash
# 1. 저장소 클론
git clone https://github.com/your-org/papermentor.git
cd papermentor

# 2. 의존성 설치
npm install

# 3. 환경변수 설정
cp .env.local.example .env.local
# .env.local 파일을 열어 API 키 입력

# 4. 개발 서버 실행
npm run dev
```

브라우저에서 `http://localhost:3000` 접속

---

## 개발 규칙

### Git 커밋 메시지 형식
[feat] 구조화 요약 - Claude API 연동
[fix] PubMed API 응답 파싱 오류 수정
[refactor] 프롬프트 파일 분리
[chore] 환경변수 설정 추가

### 핵심 원칙

- **API 키는 서버사이드에서만** — LLM 호출은 반드시 `app/api/` 안에서 처리
- **프롬프트는 코드와 분리** — `/lib/prompts/*.ts`에서 관리
- **탭 결과는 캐싱** — 동일 세션 내 탭 재진입 시 API 재호출 없음
- **기능 1개 완성 = 1 commit** — 작업 단위를 작게 유지

---

## 개발 일정

| 주차 | 목표 | 완성 기준 |
|------|------|----------|
| 1 | 환경 세팅 | API 키·repo·팀 규약 완료 |
| 2 | 앱 골격 생성 | 3분할 레이아웃 웹앱이 브라우저에서 열림 |
| 3 | 논문 불러오기 + 요약 | PubMed ID → 구조화 요약 자동 출력 |
| 4 | 번역·통계 해석 + 중간보고 | 우측 탭 2개 작동 |
| 5 | 배경지식 보완 | 진입 시 배경지식 카드 자동 생성 |
| 6 | Intra-paper QA | 논문 기반 QA 작동 |
| **7** | **P0 통합** | **6개 기능 모두 연결** ✅ |
| 8 | P1: 퀴즈 or 신뢰도 카드 | P1 기능 1개 작동 |
| 9 | P1: 시각화 | Mermaid 다이어그램 작동 |
| 10 | 내부 안정화 | 버그 수정 + 테스트 시나리오 |
| 11 | 사용자 테스트 | 의대생 5~10명 설문 완료 |
| 12 | 최종 마무리 | 보고서 + 확장 로드맵 |

> **7주차 체크포인트**: P0 기능이 모두 통합되어 작동하지 않으면 8~9주차 P1을 축소하고 안정화에 집중합니다.

---

## 팀

| 역할 | 이름 | 담당 |
|------|------|------|
| 팀 리더 | 신민기 | 연구 방향, 프롬프트 설계, 보고서 총괄 |
| 도메인 | 남궁윤, 이혜린 | 논문 선정, 기능 피드백, 사용자 테스트 |
| 풀스택 개발 | 안정빈 | Next.js, Supabase, Vercel 배포, UI |
| LLM 개발 | 신훈교 | Claude API, 프롬프트, PubMed 연동 |
| 지도교수 | 김윤학, 박정빈 | 교육적 타당성·기술 자문 |

---

## 라이선스

본 프로젝트는 부산대학교 RISE 의과대학 교육혁신지원사업의 지원을 받아 개발되었습니다.