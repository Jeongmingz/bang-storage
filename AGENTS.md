<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Repository Guidelines

## Project Structure & Module Organization
이 레포는 Next.js 16 App Router를 `src/app/` 아래에서 운용하며 페이지·레이아웃은 세그먼트 기준으로 중첩한다. 공유 UI는 `src/components/`, 스토리지·인증 로직은 `src/lib/`, 정적 자산은 `public/`에 둔다. 경로는 `@/*` 별칭으로 참조하고 테스트 코드는 소스 옆(`*.test.ts`)과 `tests/e2e/` 폴더에 둔다.

## Build, Test, and Development Commands
`npm run dev`는 핫리로드 서버를 3000번 포트로 띄운다. 릴리스 전에는 `npm run build`로 타입 검사를 통과하고, `npm run start`로 번들 스모크 테스트 후 `npx playwright test`를 돌린다. 유닛 커버리지는 `npx vitest run --coverage`로 측정하며, `npm run lint`는 `eslint.config.mjs` 규칙을 따른다.

## Coding Style & Naming Conventions
모든 모듈은 strict TypeScript와 async/await를 사용하며 브라우저 API나 상호작용 훅이 필요한 경우에만 `'use client'`를 선언한다. 컴포넌트는 PascalCase, 훅은 camelCase, 유틸은 케밥 표기, 파일 길이는 200줄 이하로 유지하고 복잡한 로직은 `src/lib/`로 이동한다. Tailwind 커스텀 프로퍼티(`text-[var(--color-foreground)]`)를 활용해 모바일 퍼스트·핑크 톤 테마를 일관되게 유지한다.

## Testing Guidelines
버그 수정 시 동일 시나리오의 회귀 테스트를 함께 추가하고, E2E 시나리오는 Playwright, 유틸은 Vitest를 사용한다. 테스트 실행 순서는 `npx vitest run --coverage` → `npm run build && npm run start` → `npx playwright test`이며, 라이브러리 코드는 80% 이상 커버리지를 유지한다. 마케팅 페이지에만 스냅샷을 허용한다.

## Commit & Pull Request Guidelines
Conventional Commits(`feat:`, `fix:` 등)을 따르며 의미 단위로 커밋한다. PR에는 변경 요약, 실행한 명령(`npm run lint`, 테스트, 빌드)과 UX 변경 시 스크린샷, “Closes #123” 이슈 링크를 포함한다. 항상 `main`을 리베이스하고 머지 커밋은 사용하지 않는다.

## 환경 변수 & 스토리지 구성
`.env.local`에는 `STORAGE_ADMIN_PASSWORD`, `CLOUDFLARE_R2_ACCESS_KEY_ID`, `CLOUDFLARE_R2_SECRET_ACCESS_KEY`, `CLOUDFLARE_R2_ENDPOINT`, `CLOUDFLARE_R2_BUCKET`을 지정해 인증과 Cloudflare R2 클라이언트가 초기화되도록 한다. 스토리지 연산은 `src/lib/storage.ts` 헬퍼를 재사용해야 한글 경로와 권한 정책이 안전하게 유지된다.

## 기록 & 개발 메모
- OTP UI는 4자리 전용 커스텀 패드로 재작성되었고, 로그인 헤더는 “지현아 반가워.” 단일 H1으로 간결하게 유지한다.
- 로그인 이후 홈은 Finder 스타일 좌측 내비+우측 작업 영역으로 개편되었으며, 모든 요소는 핑크 배경을 기본 전제한다.
- 스토리지는 Supabase에서 Cloudflare R2로 전환되었고, 폴더 생성·삭제·이름 변경, 다중·폴더 업로드, drag & drop, 확장자 아이콘, 다운로드 링크 복사, 한글 경로 표시, presigned PUT 기반 CORS 정책(`http://localhost:3000`, `https://bang-storage.vercel.app`)을 지원한다.
