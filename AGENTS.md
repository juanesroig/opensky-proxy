# AGENTS.md

Repository guidance for agentic coding assistants.

Project context: this service is an OpenSky proxy that delivers updates through SSE.

## 1) Architecture Snapshot

- Stack: Node.js, TypeScript, Express, CORS.
- Entrypoint: `index.ts`.
- SSE polling utility: `polling.ts` (`BroadcastPoller`).
- Domain types: `types.ts`.
- Build output: `dist/`.
- Module mode: ESM (`"type": "module"` in `package.json`).

Main runtime flow:
1. Client connects to `/api/opensky/states`.
2. Server ensures valid OpenSky auth token.
3. Client is registered in poller.
4. Poller fetches states on interval.
5. Poller broadcasts SSE `success`/`error` events to all clients.

## 2) Cursor / Copilot Rules Check

Verified locations:
- `.cursor/rules/` -> not found.
- `.cursorrules` -> not found.
- `.github/copilot-instructions.md` -> not found.

Policy:
- No external Cursor/Copilot rule files are active today.
- Use this `AGENTS.md` as the local rule source.
- If those files appear later, merge their rules with this document.

## 3) Install / Build / Run

Install dependencies:
- `npm install`

Build TypeScript:
- `npx tsc index.ts --module nodenext --target es2022 --outDir dist`

Run server (build + execute, current script):
- `npm run start`

Environment variables (`.env`):
- `PORT`: HTTP port used by the Express server (required).
- `OPENSKY_CLIENT_ID`: OpenSky OAuth client id (required).
- `OPENSKY_CLIENT_SECRET`: OpenSky OAuth client secret (required).

Manual smoke test:
1. Start server.
2. Open SSE client against `GET /api/opensky/states`.
3. Confirm `connected` event then periodic `success` or `error` events.

## 4) Lint / Format / Typecheck Status

Current repo state:
- No `lint` script in `package.json`.
- No committed ESLint or Prettier config.
- No `typecheck` script.

Agent expectations:
- Do not claim lint commands exist when they do not.
- Use TypeScript compile as the current quality gate.
- Keep file formatting consistent with touched code.

## 5) Test Commands (Especially Single Test)

Current status:
- `npm test` is a placeholder and fails intentionally.
- No test framework is configured yet.

Single-test command guidance for future setups:
- Node test runner: `node --test path/to/file.test.ts`
- Vitest: `npx vitest run path/to/file.test.ts -t "test name"`
- Jest: `npx jest path/to/file.test.ts -t "test name"`

## 6) Naming Conventions (Critical)

These conventions are mandatory in this project.

- Functions: `snake_case` (example: `ensure_auth_token`).
- Constants: `snake_case` (example: `opensky_states_url`, `states_poll_interval_ms`).
- Classes: `PascalCase` (example: `BroadcastPoller`).
- Types/interfaces/type aliases: `PascalCase` (example: `Auth`, `TokenPayload`).
- ID-like variables: descriptive `snake_case` (example: `client_uuid`).

Do not rename existing snake_case functions/constants to camelCase unless explicitly requested.

## 7) Imports and Modules

- Use ESM-safe imports.
- Keep import order stable:
  1. External packages.
  2. Internal modules.
- For local TS imports, keep `.js` specifiers compatible with emitted ESM.
- Prefer named imports for local symbols when practical.
- Remove unused imports.

## 8) TypeScript Style

- Type all external boundaries (HTTP payloads, auth/token structures, SSE payloads).
- Prefer `unknown` + narrowing over `any`.
- Keep nullability explicit (`T | null`, `T | undefined`).
- Preserve useful generics (e.g., `BroadcastPoller<T>`).
- Avoid unnecessary casts.
- Favor precise aliases over broad anonymous object types.

## 9) Formatting and Readability

- Follow local style in each file you edit.
- Keep functions focused and short.
- Use guard clauses and early returns.
- Prefer explicit, descriptive names.
- Keep SSE payload/event structure consistent.
- Avoid pure formatting churn in unrelated code.

Note: repository has mixed quote and semicolon styles; do not reformat entire files only for style preference.

## 10) Error Handling Rules

- Validate config/credentials early.
- Check `response.ok` before parsing body.
- Throw informative internal errors with status/context.
- Return safe client-facing errors from request handlers.
- Never leak credentials, raw tokens, or provider internals.
- Polling errors should stream SSE error events without crashing server.

## 11) SSE and Polling Rules

- Set SSE headers before streaming.
- Call `res.flushHeaders()` before first event.
- Keep frame format: `event: ...` + `data: ...` + blank line.
- On `req.close`, unregister client and end response.
- Maintain one shared polling loop for all subscribers.
- Prevent overlapping fetches (`is_fetching` lock pattern).

## 12) Security Rules

- Do not commit secrets or live tokens.
- Prefer environment variables for sensitive config.
- If hardcoded secrets are found, propose migration to `.env` usage.
- Keep logs and errors sanitized.

## 13) Agent Workflow in This Repo

Before coding:
1. Read `package.json` and relevant source files.
2. Confirm naming conventions from this file.
3. Plan minimal, targeted edits.

After coding:
1. Run TypeScript compile command.
2. Run tests if introduced.
3. Report behavior changes and any residual risk.

Maintenance rule:
- Keep this file updated when scripts, tests, or conventions change.
