import { existsSync, lstatSync, readFileSync, readdirSync, readlinkSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// package 경계는 check-package-boundaries.mjs가 검사한다. 이 파일은 문서·skill·agent 구조만 검사한다.
const forbiddenPaths = [/(^|\/)\.env(\..*)?$/, /\.(db|sqlite|sqlite3)$/];
const allowedPaths = [/(^|\/)\.env\.example$/];
const kinds = new Set(["rule", "design", "spec", "guide", "runbook", "snapshot", "history"]);
const list = (directory) => (existsSync(directory) ? readdirSync(directory) : []);

export function parseFrontmatter(source) {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(source);
  if (!match) return undefined;
  return Object.fromEntries(
    match[1]
      .split("\n")
      .map((line) => /^([\w-]+):\s*(.*)$/.exec(line))
      .filter(Boolean)
      .map(([, key, value]) => [key, value.trim()]),
  );
}

function trackedFiles(root) {
  const result = spawnSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
    cwd: root,
    encoding: "utf8",
  });
  if (result.status !== 0) throw new Error("Git 파일 목록을 읽지 못했습니다.");
  return result.stdout.split("\0").filter((path) => path && existsSync(join(root, path)));
}

// 규범 문서는 종류와 마지막 확인일, skill·역할은 이름과 사용 시점을 frontmatter로 가진다.
export function frontmatterErrors(root, files) {
  const errors = [];
  const ruleDocs = files.filter((path) => ["AGENTS.md", "TECH_RULES.md"].includes(path) || /^docs\/.*\.md$/.test(path));
  for (const path of ruleDocs) {
    const meta = parseFrontmatter(readFileSync(join(root, path), "utf8"));
    if (!meta?.title || !kinds.has(meta.kind)) errors.push(`${path}: title·kind frontmatter가 필요합니다.`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(meta?.last_verified ?? "")) errors.push(`${path}: last_verified(YYYY-MM-DD)가 필요합니다.`);
  }
  for (const name of list(join(root, ".codex/skills"))) {
    const meta = parseFrontmatter(readFileSync(join(root, ".codex/skills", name, "SKILL.md"), "utf8"));
    if (meta?.name !== name || !meta.description) errors.push(`.codex/skills/${name}: name(디렉터리와 같음)·description이 필요합니다.`);
  }
  for (const file of list(join(root, ".codex/agents"))) {
    const meta = parseFrontmatter(readFileSync(join(root, ".codex/agents", file), "utf8"));
    if (meta?.name !== file.replace(/\.md$/, "") || !meta.description) errors.push(`.codex/agents/${file}: name(파일명과 같음)·description이 필요합니다.`);
  }
  return errors;
}

// 도구별 진입 문서·skill·역할은 canonical 파일의 symlink여야 한다.
export function symlinkErrors(root) {
  const links = [["CLAUDE.md", "AGENTS.md"]];
  for (const name of list(join(root, ".codex/skills"))) links.push([`.claude/skills/${name}/SKILL.md`, `.codex/skills/${name}/SKILL.md`]);
  for (const file of list(join(root, ".codex/agents"))) links.push([`.claude/agents/${file}`, `.codex/agents/${file}`]);
  return links
    .filter(([path, canonical]) => {
      const absolute = join(root, path);
      return !existsSync(absolute) || !lstatSync(absolute).isSymbolicLink() || resolve(dirname(absolute), readlinkSync(absolute)) !== resolve(root, canonical);
    })
    .map(([path, canonical]) => `${path}: ${canonical}의 symlink가 필요합니다.`);
}

export function linkErrors(root, files) {
  const errors = [];
  for (const path of files.filter((file) => file.endsWith(".md") && !lstatSync(join(root, file)).isSymbolicLink())) {
    const source = readFileSync(join(root, path), "utf8").replace(/```[\s\S]*?```/g, "");
    for (const [, target] of source.matchAll(/\]\(([^\s)]+)\)/g)) {
      if (/^(https?:|mailto:|#)/.test(target)) continue;
      if (!existsSync(resolve(root, dirname(path), decodeURIComponent(target.split("#")[0])))) errors.push(`${path}: 깨진 문서 링크 ${target}`);
    }
  }
  return errors;
}

export function forbiddenFileErrors(files) {
  return files
    .filter((path) => !allowedPaths.some((pattern) => pattern.test(path)) && forbiddenPaths.some((pattern) => pattern.test(path)))
    .map((path) => `${path}: 금지 파일 추적`);
}

export function checkStructure(root = process.cwd()) {
  const files = trackedFiles(root);
  return [...symlinkErrors(root), ...frontmatterErrors(root, files), ...linkErrors(root, files), ...forbiddenFileErrors(files)];
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const errors = checkStructure();
  if (errors.length > 0) {
    console.error(errors.join("\n"));
    process.exitCode = 1;
  } else {
    console.info("Structure, symlinks, frontmatter, and document links are valid.");
  }
}
