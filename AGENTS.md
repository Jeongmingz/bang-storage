<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Repository Guidelines

## Project Structure & Module Organization
App Router lives in `src/app/`. Nest each segment (`src/app/(marketing)/page.tsx`), keep shared UI in `src/app/components/`, and move logic helpers to `src/lib/`. Static assets stay under `public/`, while Tailwind tokens plus globals live in `src/app/globals.css`. Tweak behavior via `next.config.ts` and `tsconfig.json`, using the `@/*` alias rather than deep relative paths.

## Build, Test, and Development Commands
`npm run dev` serves port 3000 with hot reload. `npm run build` performs type checks, optimizes routes, and must pass before review. `npm run start` runs the compiled bundle—use it for smoke tests and production. `npm run lint` executes `eslint.config.mjs`; append `-- --fix` for autofixes. Declare new automation as npm scripts so CI mirrors local steps exactly.

## Coding Style & Naming Conventions
Write strict TypeScript with async/await and Server Components by default; add `'use client'` only when browser APIs or interactive hooks are required. React components export PascalCase, hooks use camelCase filenames, and utilities use kebab-case. Keep modules lean (<200 lines) and move heavy logic into `src/lib/`. Tailwind v4 tokens (`text-[var(--color-foreground)]`) keep theming consistent and accessible.

## Testing Guidelines
Use Vitest for utilities and Playwright for routed flows. Store unit specs beside the source (`src/lib/foo.test.ts`) and E2E specs under `tests/e2e/*.spec.ts`. Run `npx vitest run --coverage`, then `npm run build && npm run start` followed by `npx playwright test` before pushing. Target ≥80 % coverage on lib code and pair every bug fix with a regression test; snapshots only cover static marketing pages.

## Commit & Pull Request Guidelines
Follow Conventional Commits (`feat: add hero grid`, `fix: normalize colors`). Rebase on `main`, keep commits focused, and avoid merges. PRs should explain the behavior change, list executed commands (`npm run lint`, tests), and attach screenshots or logs for UX shifts. Reference issues with “Closes #123” and request review before merging.
