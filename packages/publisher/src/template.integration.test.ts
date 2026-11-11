import { execFile as execFileCallback } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

import {
  createAstroTemplateManifest,
  createMarkdownArtifact,
} from "./index.js";

const roots: string[] = [];
const execFile = promisify(execFileCallback);
const astroCli = fileURLToPath(
  new URL("../node_modules/astro/bin/astro.mjs", import.meta.url),
);
const nodeModules = fileURLToPath(new URL("../node_modules", import.meta.url));

const legacyPost = `---
title: Legacy Post
description: Existing v1 content
publishedAt: 2026-07-18T01:00:00.000Z
updatedAt: 2026-07-18T02:00:00.000Z
---

This post predates metadata schema versions.
`;

const v2Post = `---
schemaVersion: 2
title: Version Two
description: Strict v2 content
publishedAt: 2026-07-19T01:00:00.000Z
updatedAt: 2026-07-19T02:00:00.000Z
manuscriptPages: 3
category: Engineering
categorySlug: engineering-a1b2c3d4
series: Old Series
seriesSlug: old-series-a1b2c3d4
seriesOrder: 1
tags:
  - Notion
  - Publishing
---

This post uses v2 metadata.

## Start

First section.

## Build

Second section.

![Local image](../../assets/blog/version-two/image-001.png)

## Ship

Third section.
`;

const compatibilityPage = `---
import { getCollection } from "astro:content";

const posts = (await getCollection("blog")).sort((left, right) =>
  left.id.localeCompare(right.id),
);
---
<ul>
  {posts.map((post) => (
    <li data-schema-version={post.data.schemaVersion}>
      {post.id}:{post.data.tags.join(",")}
    </li>
  ))}
</ul>
`;

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

describe("Astro template build", () => {
  const sites = [
    {
      expectedBase: "/",
      defaultBranch: "main",
      owner: "HappyDoran",
      repository: "HappyDoran.github.io",
    },
    {
      expectedBase: "/notion-notes/",
      defaultBranch: "release/pages",
      owner: "HappyDoran",
      repository: "notion-notes",
    },
  ] as const;
  const collections = [
    { kind: "v1-only", posts: { "legacy-post.md": legacyPost } },
    {
      kind: "mixed-v1-v2",
      posts: { "legacy-post.md": legacyPost, "version-two.md": v2Post },
    },
  ] as const;

  it.each(
    sites.flatMap((site) =>
      collections.map((collection) => ({ ...site, ...collection })),
    ),
  )(
    "builds $kind content for $repository without changing post paths",
    async ({ defaultBranch, expectedBase, owner, posts, repository }) => {
      const { manifest, root } = await createFixture({
        defaultBranch,
        owner,
        repository,
      });
      await writeFixture(root, "src/pages/compatibility.astro", compatibilityPage);
      await Promise.all(
        Object.entries(posts).map(([name, content]) =>
          writeFixture(root, `src/content/blog/${name}`, content),
        ),
      );
      if ("version-two.md" in posts) {
        await writeFixture(
          root,
          "src/assets/blog/version-two/image-001.png",
          Buffer.from(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
            "base64",
          ),
        );
      }

      await build(root);

      const indexHtml = await readFile(join(root, "dist/index.html"), "utf8");
      const legacyHtml = await readFile(
        join(root, "dist/posts/legacy-post/index.html"),
        "utf8",
      );
      const compatibilityHtml = await readFile(
        join(root, "dist/compatibility/index.html"),
        "utf8",
      );
      const postsHtml = await readFile(
        join(root, "dist/posts/index.html"),
        "utf8",
      );
      const notFoundHtml = await readFile(join(root, "dist/404.html"), "utf8");
      expect(indexHtml).toContain(`${expectedBase}posts/legacy-post/`);
      expect(indexHtml).toContain(`${expectedBase}posts/`);
      expect(indexHtml).not.toContain("categories/");
      expect(indexHtml).not.toContain("주제");
      expect(indexHtml).toContain("본문으로 건너뛰기");
      expect(indexHtml).toContain('aria-current="page"');
      expect(indexHtml).toContain("HappyDoran.log");
      expect(indexHtml).toContain('aria-label="블로그 통계"');
      expect(indexHtml).toContain('href="https://github.com/HappyDoran"');
      expect(indexHtml).not.toContain("<script");
      expect(legacyHtml).toContain("<h1>Legacy Post</h1>");
      expect(legacyHtml).toContain('class="article-layout without-toc"');
      // 빵부스러기는 홈 / 전체 글 / 제목이다.
      expect(legacyHtml).toContain(`<a href="${expectedBase}posts/">전체 글</a>`);
      expect(postsHtml).toContain("전체 글");
      expect(postsHtml).toContain(`${expectedBase}posts/legacy-post/`);
      await expect(readFile(join(root, "dist/categories/index.html"))).rejects.toThrow();
      expect(notFoundHtml).toContain("페이지를 찾을 수 없습니다");
      expect(notFoundHtml).toContain(`${expectedBase}posts/legacy-post/`);
      expect(compatibilityHtml).toContain('data-schema-version="1"');
      // 분량 정보가 없는 옛 글도 판권은 그리되 분량 줄은 뺀다.
      expect(legacyHtml).toContain('<p class="post-end">(끝)</p>');
      expect(legacyHtml).not.toContain("원고지");
      expect(compatibilityHtml).toContain("legacy-post:");

      if ("version-two.md" in posts) {
        expect(indexHtml).toContain(`${expectedBase}posts/version-two/`);
        const v2Html = await readFile(
          join(root, "dist/posts/version-two/index.html"),
          "utf8",
        );
        expect(v2Html).toContain("<h1>Version Two</h1>");
        expect(v2Html).toContain("Strict v2 content");
        expect(v2Html).toContain("#Notion");
        expect(v2Html).toContain('href="#start"');
        expect(v2Html).toMatch(/<img[^>]+src="[^"]+_astro\/image-001\.[^"]+\.png"/);
        expect(v2Html).toContain('aria-label="현재 위치"');
        // 교정쇄 × 원고지: 메타·판권의 원고지 매수, (끝), 판권(디자인 기획 2.4).
        expect(v2Html).toContain("<span>200자 원고지 3매</span>");
        expect(v2Html).toContain('<p class="post-end">(끝)</p>');
        expect(v2Html).toMatch(/<footer class="post-colophon"[^>]*>\s*<h2 id="colophon-title">판권<\/h2>/);
        expect(v2Html).toContain("<dt>분량</dt><dd>200자 원고지 3매</dd>");
        expect(v2Html).toContain("<dt>쓴 사람</dt><dd>HappyDoran</dd>");
        expect(v2Html).toContain("fonts.googleapis.com/css2?family=Hahmlet:wght@700&display=swap");
        // 옛 주제·시리즈 field가 남은 글도 build되지만 화면에는 나오지 않는다.
        expect(v2Html).not.toContain("Engineering");
        expect(v2Html).not.toContain("Old Series");
        expect(compatibilityHtml).toContain('data-schema-version="2"');
        expect(compatibilityHtml).toContain("version-two:Notion,Publishing");
      }

      expect(
        manifest.artifacts.every(
          (artifact) => !new TextDecoder().decode(artifact.bytes).includes(root),
        ),
      ).toBe(true);
    },
  );

  it("builds structured Notion blocks into semantic HTML", async () => {
    const { root } = await createFixture({
      defaultBranch: "main",
      owner: "HappyDoran",
      repository: "HappyDoran.github.io",
    });
    const artifact = createMarkdownArtifact({
      blocks: [
        { kind: "heading", level: 2, richText: [{ text: "Heading One" }] },
        { kind: "heading", level: 3, richText: [{ text: "Heading Two" }] },
        { kind: "heading", level: 4, richText: [{ text: "Heading Three" }] },
        { kind: "heading", level: 2, richText: [{ text: "Heading Four" }] },
        { kind: "heading", level: 2, richText: [{ text: "Heading Five" }] },
        {
          children: [
            {
              children: [],
              kind: "listItem",
              richText: [{ text: "Nested" }],
              style: "numbered",
            },
          ],
          kind: "listItem",
          richText: [{ text: "Bullet" }],
          style: "bulleted",
        },
        {
          checked: true,
          children: [],
          kind: "toDo",
          richText: [{ text: "Done" }],
        },
        {
          children: [],
          icon: "📌",
          kind: "callout",
          richText: [{ text: "Notice" }],
        },
        {
          hasColumnHeader: true,
          hasRowHeader: true,
          kind: "table",
          rows: [
            [[{ text: "Name" }], [{ text: "Value" }]],
            [[{ text: "First" }], [{ bold: true, text: "Second" }]],
          ],
        },
        { expression: "E = mc^2", kind: "equation" },
        { kind: "paragraph", richText: [{ code: true, text: "<org> & co" }] },
        { kind: "paragraph", richText: [{ text: "MinIO에게 " }, { bold: true, text: "임시 출입증(presigned URL)" }, { text: "을 요청" }] },
        { kind: "paragraph", richText: [{ text: "핵심은 **\"직접 입력한 굵게\"**에 있다" }] },
        {
          caption: [{ text: "Reference" }],
          kind: "linkCard",
          url: "https://example.com/reference",
        },
        {
          caption: [{ text: "Attachment" }],
          kind: "media",
          mediaType: "file",
          url: null,
        },
      ],
      description: "Structured content",
      publishedAt: "2026-07-19T01:00:00.000Z",
      schemaVersion: 2,
      slug: "structured-content",
      tags: [],
      title: "Structured Content",
      updatedAt: "2026-07-19T02:00:00.000Z",
    });
    await writeFixture(root, artifact.path, artifact.bytes);

    await build(root);

    const html = await readFile(
      join(root, "dist/posts/structured-content/index.html"),
      "utf8",
    );
    expect(html).toContain('<h2 id="heading-one">Heading One</h2>');
    expect(html).toContain('<h3 id="heading-two">Heading Two</h3>');
    expect(html).toContain('<h4 id="heading-three">Heading Three</h4>');
    expect(html).toContain('class="article-layout with-toc"');
    expect(html).toContain('class="post-toc"');
    expect(html).toContain("<ul>");
    expect(html).toContain("<ol>");
    expect(html).toContain('type="checkbox"');
    expect(html).toContain("<blockquote>");
    expect(html).toContain('<div class="notion-table-wrap">');
    expect(html).toContain('<th scope="col">Name</th>');
    expect(html).toContain('<th scope="row">First</th>');
    expect(html).toContain("<strong>Second</strong>");
    expect(html).toContain('class="notion-equation"');
    // inline code는 한 번만 escape된다(화면에 `<org> & co`로 보인다).
    expect(html).toContain("<code>&lt;org&gt; &amp; co</code>");
    expect(html).not.toContain("&amp;lt;");
    // 닫는 강조 앞이 괄호이고 뒤가 글자여도 굵게 보인다.
    expect(html).toContain("MinIO에게 <strong>임시 출입증(presigned URL)</strong>을 요청");
    expect(html).toContain('핵심은 <strong>"직접 입력한 굵게"</strong>에 있다');
    expect(html).toContain('href="https://example.com/reference"');
    expect(html).toContain("Attachment");
  });

  it("limits the home page to twelve posts while keeping every post discoverable", async () => {
    const { root } = await createFixture({
      defaultBranch: "main",
      owner: "HappyDoran",
      repository: "HappyDoran.github.io",
    });
    await Promise.all(
      Array.from({ length: 13 }, (_, index) => {
        const number = String(index).padStart(2, "0");
        return writeFixture(
          root,
          `src/content/blog/post-${number}.md`,
          `---
schemaVersion: 2
title: Post ${number}
description: Description ${number}
publishedAt: 2026-07-${String(index + 1).padStart(2, "0")}T01:00:00.000Z
updatedAt: 2026-07-${String(index + 1).padStart(2, "0")}T02:00:00.000Z
tags: [${index < 8 ? '"Swift"' : '"React", "Swift"'}]
---

Post ${number} body.
`,
        );
      }),
    );

    await build(root);

    const indexHtml = await readFile(join(root, "dist/index.html"), "utf8");
    const postsHtml = await readFile(
      join(root, "dist/posts/index.html"),
      "utf8",
    );
    const css = await readBuiltCss(root);
    expect(indexHtml).toContain("Post 12");
    expect(indexHtml).not.toContain("Post 00");
    expect(postsHtml).toContain("Post 12");
    expect(postsHtml).toContain("Post 00");
    // 전체 글: 검색 → 태그(글 수 많은 순) → 글 목록 순서. JavaScript 없이도 모든 글이 HTML에 있다.
    const search = postsHtml.indexOf('id="post-query"');
    const swift = postsHtml.indexOf("#Swift");
    const react = postsHtml.indexOf("#React");
    const list = postsHtml.indexOf('class="post-list"');
    expect(search).toBeGreaterThan(0);
    expect([search, swift, react, list]).toEqual([search, swift, react, list].sort((left, right) => left - right));
    expect(postsHtml).toMatch(/data-tag-filter="swift-[a-f0-9]{8}">#Swift <span class="muted">13<\/span>/);
    expect(postsHtml.match(/data-post /g)).toHaveLength(13);
    expect(postsHtml).toContain('data-search="post 07 description 07 swift"');
    expect(postsHtml).toContain('data-pagination hidden');
    expect(postsHtml).toContain('data-tag-more hidden');
    expect(postsHtml).toContain("<script");
    expect(css).toContain("min-width:20rem");
    expect(css).toContain("font-size:clamp(1.55rem,3vw,1.9rem)");
    expect(css).toContain("font-size:clamp(1.3rem,2.5vw,1.55rem)");
    expect(css).toContain("font-size:clamp(1.18rem,2vw,1.3rem)");
    expect(css).toContain("container-type:inline-size");
    expect(css).toMatch(/@container \((?:min-width:|width>=)76rem\)/);
    expect(css).toContain("position:sticky");
    expect(css).toContain("prefers-reduced-motion:reduce");
    expect(indexHtml).not.toContain("<script");
  });

  it.each([
    {
      name: "a future schema version",
      frontmatter: v2Post.replace("schemaVersion: 2", "schemaVersion: 3"),
    },
    {
      name: "more than ten v2 tags",
      frontmatter: v2Post.replace(
        "  - Notion\n  - Publishing",
        Array.from({ length: 11 }, (_, index) => `  - tag-${index}`).join("\n"),
      ),
    },
    {
      name: "normalized duplicate v2 tags",
      frontmatter: v2Post.replace("  - Publishing", "  - notion"),
    },
    {
      name: "an overlong v2 tag",
      frontmatter: v2Post.replace("  - Publishing", `  - ${"x".repeat(41)}`),
    },
    {
      name: "an extra v2 field",
      frontmatter: v2Post.replace("tags:\n", "unexpected: true\ntags:\n"),
    },
  ])("fails the build for $name", async ({ frontmatter }) => {
    const { root } = await createFixture({
      defaultBranch: "main",
      owner: "HappyDoran",
      repository: "HappyDoran.github.io",
    });
    await writeFixture(root, "src/content/blog/invalid.md", frontmatter);

    await expect(build(root)).rejects.toThrow();
  });
});

describe("discovery routes (R9)", () => {
  it.each([
    { base: "/", repository: "HappyDoran.github.io", site: "https://happydoran.github.io/" },
    { base: "/notion-notes/", repository: "notion-notes", site: "https://happydoran.github.io/notion-notes/" },
  ])("builds tag filters, archive, RSS, sitemap and Open Graph for $repository", async ({ base, repository, site }) => {
    const { root } = await createFixture({ defaultBranch: "main", owner: "HappyDoran", repository });
    const post = (slug: string, title: string, tags: string[], publishedAt: string) =>
      createMarkdownArtifact({
        blocks: [{ kind: "paragraph", richText: [{ text: "본문" }] }],
        description: title + " 설명",
        publishedAt,
        schemaVersion: 2,
        slug,
        tags,
        title,
        updatedAt: publishedAt,
      });
    for (const artifact of [
      post("first-111111111111", "A & B <C>", ["정적 사이트", "Astro"], "2026-11-08T00:00:00.000Z"),
      post("second-222222222222", "Second", ["astro"], "2026-10-02T00:00:00.000Z"),
    ]) {
      await writeFixture(root, artifact.path, artifact.bytes);
    }
    await writeFixture(root, "src/content/blog/legacy-post.md", legacyPost);
    await build(root);

    const read = (path: string) => readFile(join(root, "dist", path), "utf8");
    const postsIndex = await read("posts/index.html");
    const astroTag = postsIndex.match(/href="([^"]*posts\/\?tag=(astro-[a-f0-9]{8}))" data-tag-filter="astro-[a-f0-9]{8}">#(?:Astro|astro) <span class="muted">(\d+)/);
    expect(astroTag?.[1]?.startsWith(base + "posts/?tag=")).toBe(true);
    // 대소문자만 다른 태그는 한 태그로 모인다.
    expect(astroTag?.[3]).toBe("2");
    expect(postsIndex).toMatch(/data-tag-filter="tag-[a-f0-9]{8}">#정적 사이트/);
    await expect(read("tags/index.html")).rejects.toThrow();

    const postHtml = await read("posts/first-111111111111/index.html");
    expect(postHtml).toContain(`href="${base}posts/?tag=${astroTag?.[2]}"`);
    expect(postHtml).toContain('<meta property="og:type" content="article">');
    // 따옴표 속성값 안의 `<`는 HTML 문법상 escape하지 않아도 된다. `&`와 `"`만 escape된다.
    expect(postHtml).toContain('<meta property="og:title" content="A &amp; B <C>">');
    expect(postHtml).toContain(`<link rel="alternate" type="application/rss+xml" title="HappyDoran.log" href="${base}rss.xml">`);

    const archive = await read("archive/index.html");
    expect(archive.indexOf("2026년 11월")).toBeLessThan(archive.indexOf("2026년 10월"));
    expect(archive).toContain(`${base}posts/legacy-post/`);

    const rss = await read("rss.xml");
    expect(rss).toMatch(/^<\?xml version="1.0" encoding="UTF-8"\?>\n<rss version="2.0">/);
    expect(rss).toContain("<title>A &amp; B &lt;C&gt;</title>");
    expect(rss).toContain(`<link>${site}posts/first-111111111111/</link>`);
    expect(rss).not.toContain("본문");
    expect(rss).not.toContain("<category>");
    expect(rss.match(/<item>/g)).toHaveLength(3);

    const sitemap = await read("sitemap.xml");
    for (const path of ["", "posts/", "archive/", "posts/first-111111111111/", "posts/legacy-post/"]) {
      expect(sitemap).toContain(`<loc>${site}${path}</loc>`);
    }
    expect(sitemap).not.toMatch(/tags\/|categories\/|series\//);
    expect(sitemap).toContain("<lastmod>2026-11-08</lastmod>");
    expect(await read("index.html")).not.toContain("<script");
  });
});

describe("pinned posts and post navigation (R10)", () => {
  it("pins posts above the latest list and links the previous (older) and next (newer) post", async () => {
    const { root } = await createFixture({ defaultBranch: "main", owner: "HappyDoran", repository: "HappyDoran.github.io" });
    const post = (slug: string, title: string, publishedAt: string, extra: object = {}) =>
      createMarkdownArtifact({
        blocks: [{ kind: "paragraph", richText: [{ text: "본문" }] }],
        description: "",
        publishedAt,
        schemaVersion: 2,
        slug,
        tags: [],
        title,
        updatedAt: publishedAt,
        ...extra,
      });
    for (const artifact of [
      post("new-111111111111", "새 글", "2026-11-05T00:00:00.000Z"),
      post("middle-222222222222", "가운데 글", "2026-11-01T00:00:00.000Z"),
      post("old-333333333333", "옛 글", "2026-10-01T00:00:00.000Z"),
      post("pinned-444444444444", "고정 공지", "2026-09-01T00:00:00.000Z", { pinned: true }),
    ]) {
      await writeFixture(root, artifact.path, artifact.bytes);
    }
    await build(root);
    const read = (path: string) => readFile(join(root, "dist", path), "utf8");

    const home = await read("index.html");
    const pinnedSection = home.slice(home.indexOf("고정 글"), home.indexOf("최신 글"));
    expect(pinnedSection).toContain("고정 공지");
    expect(home.slice(home.indexOf("최신 글"))).not.toContain("고정 공지");

    const middle = await read("posts/middle-222222222222/index.html");
    expect(middle).toContain('aria-label="이전 및 다음 글"');
    expect(middle).toMatch(/href="\/posts\/old-333333333333\/"><small>← 이전 글<\/small>옛 글/);
    expect(middle).toMatch(/href="\/posts\/new-111111111111\/"><small>다음 글 →<\/small>새 글/);
    await expect(read("series/index.html")).rejects.toThrow();
  });
});

describe("site settings (R11)", () => {
  it("uses .kanban-press/site.json for the site name, intro, links and RSS, ignoring invalid links", async () => {
    const { root } = await createFixture({ defaultBranch: "main", owner: "HappyDoran", repository: "HappyDoran.github.io" });
    await writeFixture(
      root,
      ".kanban-press/site.json",
      JSON.stringify({
        description: "도란의 <개발> 기록",
        links: [
          { label: "GitHub", url: "https://github.com/HappyDoran" },
          { label: "위험", url: "javascript:alert(1)" },
        ],
        title: "도란 블로그",
      }),
    );
    await writeFixture(root, "src/content/blog/legacy-post.md", legacyPost);
    await build(root);
    const read = (path: string) => readFile(join(root, "dist", path), "utf8");

    const home = await read("index.html");
    expect(home).toContain("<title>도란 블로그</title>");
    expect(home).toContain('<h1 id="site-title">도란 블로그</h1>');
    expect(home).toContain("도란의 &lt;개발&gt; 기록");
    expect(home).toContain('<a href="https://github.com/HappyDoran" rel="me">GitHub</a>');
    expect(home).not.toContain("javascript:");
    expect(await read("posts/legacy-post/index.html")).toContain("<title>Legacy Post · 도란 블로그</title>");
    expect(await read("rss.xml")).toContain("<title>도란 블로그</title>");
  });
});

describe("site settings in the folder used before the rename", () => {
  it("reads .notion-kanban-blog/site.json when .kanban-press/site.json is absent", async () => {
    const { root } = await createFixture({ defaultBranch: "main", owner: "HappyDoran", repository: "HappyDoran.github.io" });
    await writeFixture(
      root,
      ".notion-kanban-blog/site.json",
      JSON.stringify({ description: "옛 위치 소개", links: [], title: "옛 위치 블로그" }),
    );
    await build(root);
    const home = await readFile(join(root, "dist", "index.html"), "utf8");
    expect(home).toContain("<title>옛 위치 블로그</title>");
    expect(home).toContain("옛 위치 소개");
  });
});

async function createFixture(target: {
  defaultBranch: string;
  owner: string;
  repository: string;
}) {
  const root = await mkdtemp(join(process.cwd(), ".template-test-"));
  roots.push(root);
  const manifest = createAstroTemplateManifest(target);
  await symlink(nodeModules, join(root, "node_modules"), "dir");
  await Promise.all(
    manifest.artifacts.map((artifact) =>
      writeFixture(root, artifact.path, artifact.bytes),
    ),
  );
  return { manifest, root };
}

async function writeFixture(
  root: string,
  path: string,
  content: string | Uint8Array,
): Promise<void> {
  const destination = join(root, path);
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, content);
}

async function build(root: string): Promise<void> {
  await execFile(process.execPath, [astroCli, "build"], {
    cwd: root,
    env: { ...process.env, NO_COLOR: "1" },
  });
}

async function readBuiltCss(root: string): Promise<string> {
  const assetDirectory = join(root, "dist/_astro");
  const files = await readdir(assetDirectory);
  const stylesheets = files.filter((file) => file.endsWith(".css"));
  return (
    await Promise.all(
      stylesheets.map((file) => readFile(join(assetDirectory, file), "utf8")),
    )
  ).join("\n");
}
