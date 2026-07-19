---
name: notion-kanban-blog
description: Build and verify this repository's DB-free, multi-user Notion kanban publishing app. Use when implementing or reviewing GitHub OAuth, encrypted HttpOnly cookie sessions, Notion OAuth connections, per-GitHub-user IndexedDB boards, GitHub App publishing, Astro/GitHub Pages output, project architecture, TODO priorities, or acceptance tests.
---

# Notion Kanban Blog

## Start

Read these files before changing implementation:

1. `.codex/AGENTS.md`
2. `.codex/docs/PROJECT_SPEC.md`
3. `.codex/docs/TECH_STACK.md`
4. `.codex/docs/ARCHITECTURE.md`
5. `.codex/TODO.md`

Work on the earliest unfinished item unless the user names another scope. Update a changed
architecture or contract in the documents before code.

## Preserve the DB-free boundaries

- Keep `apps/web` as the only server runtime.
- Treat users as independent GitHub identities, not tenants or team members.
- Store board state in IndexedDB under the immutable GitHub numeric user ID.
- Keep credentials only in authenticated-encryption, HttpOnly cookies.
- Never put credentials in client JavaScript, IndexedDB, localStorage, URLs, or logs.
- Revalidate Notion page and GitHub repository access for every publish request.
- Use deterministic content hashes so retrying a request does not create duplicate commits.
- Do not introduce a database, queue, Worker, or object store without a documented requirement
  that exceeds the explicit MVP limitations.

## Implement a vertical slice

For each slice:

1. Define the external input and failure cases.
2. Add or update domain and adapter contracts.
3. Implement server orchestration in `apps/web`.
4. Add unit or contract tests for authorization, malformed data, expiry, and retry behavior.
5. Run the narrow tests, then the repository checks.
6. Mark TODO state only after the acceptance criteria pass.

## Verify

```bash
mise exec -- corepack pnpm lint
mise exec -- corepack pnpm typecheck
mise exec -- corepack pnpm test
mise exec -- corepack pnpm test:integration
mise exec -- corepack pnpm build
```

Report what changed, which checks passed, any external app setup still required, and the next
unfinished TODO item.
