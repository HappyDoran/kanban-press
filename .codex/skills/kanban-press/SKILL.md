---
name: kanban-press
description: Build and verify this repository's DB-free, multi-user Notion kanban publishing app. Use when implementing or reviewing GitHub OAuth, encrypted HttpOnly cookie sessions, Notion OAuth connections, stateless boards computed from Notion and the blog repository, direct OAuth publishing to username.github.io, Astro/GitHub Pages output, project architecture, backlog priorities, or acceptance tests.
---

# Kanban Press

## Start

Read these files before changing implementation:

1. `AGENTS.md`
2. `docs/spec/PROJECT_SPEC.md`
3. `TECH_RULES.md`
4. `docs/architecture/ARCHITECTURE.md`
5. `docs/spec/gap-analysis.md`

Work on the earliest unfinished item unless the user names another scope. Update a changed
architecture or contract in the documents before code.

## Preserve the DB-free boundaries

- Keep `apps/web` as the only server runtime.
- Treat users as independent GitHub identities, not tenants or team members.
- Do not persist board state anywhere; compute it from the Notion page list and the blog repository (ADR 0002).
- Keep credentials only in authenticated-encryption, HttpOnly cookies.
- Never put credentials in client JavaScript, IndexedDB, localStorage, URLs, or logs.
- Revalidate Notion page and GitHub repository access for every publish request.
- Limit direct GitHub publishing to the signed-in user's public `<login>.github.io`
  repository and require the OAuth `public_repo` (or `repo`) and `workflow` scopes.
- Keep persistent board records in `stored`; publishing and published UI state must remain
  in React memory only and may disappear on refresh.
- Allow repeated publish requests to create duplicate commits even when content is unchanged.
- Do not introduce a database, queue, Worker, or object store without a documented requirement
  that exceeds the explicit MVP limitations.

## Implement a vertical slice

For each slice:

1. Define the external input and failure cases.
2. Add or update domain and adapter contracts.
3. Implement server orchestration in `apps/web`.
4. Add unit or contract tests for authorization, malformed data, expiry, and retry behavior.
5. Run the narrow tests, then the repository checks.
6. Mark the gap-analysis backlog state only after the acceptance criteria pass.

## Verify

```bash
mise exec -- pnpm lint
mise exec -- pnpm typecheck
mise exec -- pnpm test
mise exec -- pnpm test:integration
mise exec -- pnpm build
```

Report what changed, which checks passed, any external app setup still required, and the next
unfinished backlog item in `docs/spec/gap-analysis.md`.
