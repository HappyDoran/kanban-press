import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { forbiddenFileErrors, frontmatterErrors, linkErrors, parseFrontmatter, symlinkErrors } from "./check-structure.mjs";

function withRoot(run) {
  const root = mkdtempSync(join(tmpdir(), "kp-structure-"));
  try {
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("규범 문서·skill·agent frontmatter 누락과 이름 불일치를 잡는다", () => {
  withRoot((root) => {
    writeFileSync(join(root, "AGENTS.md"), "---\ntitle: 규범\nkind: rule\nlast_verified: 2026-01-01\n---\n# 규범\n");
    mkdirSync(join(root, "docs"));
    writeFileSync(join(root, "docs/a.md"), "# frontmatter 없음\n");
    writeFileSync(join(root, "docs/b.md"), "---\ntitle: b\nkind: memo\nlast_verified: 2026-01-01\n---\n");
    mkdirSync(join(root, ".codex/skills/good"), { recursive: true });
    writeFileSync(join(root, ".codex/skills/good/SKILL.md"), "---\nname: other\ndescription: 설명\n---\n");
    mkdirSync(join(root, ".codex/agents"));
    writeFileSync(join(root, ".codex/agents/kp-a.md"), "---\nname: kp-a\n---\n");
    const errors = frontmatterErrors(root, ["AGENTS.md", "docs/a.md", "docs/b.md"]);
    assert.equal(errors.length, 5, errors.join("\n"));
    assert.deepEqual(parseFrontmatter("---\nname: a\n---\n"), { name: "a" });
  });
});

test("canonical symlink가 아니면 거부하고 올바른 symlink는 통과한다", () => {
  withRoot((root) => {
    writeFileSync(join(root, "AGENTS.md"), "# a\n");
    writeFileSync(join(root, "CLAUDE.md"), "# 복사본\n");
    mkdirSync(join(root, ".codex/skills/s"), { recursive: true });
    writeFileSync(join(root, ".codex/skills/s/SKILL.md"), "");
    mkdirSync(join(root, ".claude/skills/s"), { recursive: true });
    symlinkSync("../../../.codex/skills/s/SKILL.md", join(root, ".claude/skills/s/SKILL.md"));
    mkdirSync(join(root, ".codex/agents"));
    writeFileSync(join(root, ".codex/agents/kp-a.md"), "");
    assert.deepEqual(symlinkErrors(root), [
      "CLAUDE.md: AGENTS.md의 symlink가 필요합니다.",
      ".claude/agents/kp-a.md: .codex/agents/kp-a.md의 symlink가 필요합니다.",
    ]);
  });
});

test("깨진 상대 링크와 금지 파일을 잡고 코드 블록·외부 링크는 무시한다", () => {
  withRoot((root) => {
    writeFileSync(join(root, "a.md"), "[ok](a.md) [web](https://x.y) [bad](missing.md)\n```\n[skip](nope.md)\n```\n");
    assert.deepEqual(linkErrors(root, ["a.md"]), ["a.md: 깨진 문서 링크 missing.md"]);
  });
  assert.deepEqual(forbiddenFileErrors([".env.example", "apps/web/.env.local", "data.sqlite", "apps/web/smoke.env.example"]), [
    "apps/web/.env.local: 금지 파일 추적",
    "data.sqlite: 금지 파일 추적",
  ]);
});
