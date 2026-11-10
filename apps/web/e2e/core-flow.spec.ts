import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const CONNECTION_ID = "3c90c3cc-0d44-4b50-8888-8dd25736052a";
const PAGE_ID = "9188c6a5-7381-452f-b3dc-d4865aa89bdf";
const LAST_EDITED_AT = "2026-08-20T10:00:00.000Z";

test("signed-out OAuth entry is explicit and accessible", async ({ page }) => {
  await page.route("**/api/me", (route) =>
    route.fulfill({ json: { authenticated: false }, status: 401 }),
  );
  await page.goto("/");

  await expect(page.getByRole("link", { name: "GitHub로 시작" }).first()).toHaveAttribute(
    "href",
    "/auth/github/start?returnTo=%2F",
  );
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "글쓰기는 Notion에서",
  );
  await expectNoSeriousAccessibilityViolations(page);
});

test("session, IndexedDB, preview, publish, and user isolation", async ({
  page,
}) => {
  let userId = "52277540";
  let publishCalls = 0;
  await installAppRoutes(page, () => userId, () => {
    publishCalls += 1;
  });
  // R8: 블로그 저장소에 올라간 글 목록과 블로그에서 내리기.
  let onBlog = false;
  let unpublishCalls = 0;
  await page.route("**/api/publish/posts", (route) =>
    route.fulfill({
      json: {
        posts: onBlog
          ? [{ pageIdSuffix: "9188c6a57381", pageUrl: "https://happydoran.github.io/posts/e2e-post-9188c6a57381/" }]
          : [],
      },
    }),
  );
  await page.route("**/api/publish/unpublish", (route) => {
    unpublishCalls += 1;
    onBlog = false;
    return route.fulfill({ json: { commitSha: "c".repeat(40) } });
  });
  await page.goto("/");

  await expect(page.getByText("E2E 게시 문서", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("게시 준비 완료")).toBeVisible();
  await expect(
    page.getByRole("button", { exact: true, name: "미리보기" }),
  ).toBeVisible();

  const databases = await page.evaluate(async () =>
    (await indexedDB.databases()).map((database) => database.name),
  );
  expect(databases).toContain("kanban-press.board.52277540");

  await page.getByRole("button", { exact: true, name: "미리보기" }).click();
  await expect(page.getByRole("dialog")).toContainText("E2E 프리뷰 본문");
  const headingSizes = await page.evaluate(() => {
    const size = (text: string) => {
      const element = [...document.querySelectorAll(".previewBody *")].find(
        (candidate) => candidate.textContent === text,
      );
      if (!(element instanceof HTMLElement)) throw new Error(`Missing ${text}`);
      return Number.parseFloat(getComputedStyle(element).fontSize);
    };
    const body = document.querySelector(".previewBody p");
    if (!(body instanceof HTMLElement)) throw new Error("Missing preview body");
    return [
      size("E2E 제목 1"),
      size("E2E 제목 2"),
      size("E2E 제목 3"),
      Number.parseFloat(getComputedStyle(body).fontSize),
    ];
  });
  expect(headingSizes[0]).toBeGreaterThan(headingSizes[1]!);
  expect(headingSizes[1]).toBeGreaterThan(headingSizes[2]!);
  expect(headingSizes[2]).toBeGreaterThan(headingSizes[3]!);
  await page.getByRole("button", { name: "닫기" }).click();

  const card = page.getByRole("button", { name: "E2E 게시 문서 카드 이동" });
  const publishingColumn = page.getByRole("region", { name: /게시 중/ });
  const source = await card.boundingBox();
  const target = await publishingColumn.boundingBox();
  expect(source).not.toBeNull();
  expect(target).not.toBeNull();
  await page.mouse.move(source!.x + source!.width / 2, source!.y + source!.height / 2);
  await page.mouse.down();
  await page.mouse.move(source!.x + source!.width / 2 + 10, source!.y + source!.height / 2, {
    steps: 3,
  });
  await page.mouse.move(target!.x + target!.width / 2, target!.y + target!.height / 2, {
    steps: 12,
  });
  await page.mouse.up();
  await expect.poll(() => publishCalls).toBe(1);
  await expect(page.getByText("게시된 글 보기")).toBeVisible();

  const storedVisibility = await page.evaluate(
    async ({ connectionId, pageId }) => {
      const request = indexedDB.open("kanban-press.board.52277540");
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const transaction = database.transaction("boardRecords", "readonly");
      const store = transaction.objectStore("boardRecords");
      const get = store.get(["52277540", connectionId, pageId]);
      const record = await new Promise<Record<string, unknown> | undefined>(
        (resolve, reject) => {
          get.onsuccess = () => resolve(get.result as Record<string, unknown> | undefined);
          get.onerror = () => reject(get.error);
        },
      );
      database.close();
      return record?.isVisible;
    },
    { connectionId: CONNECTION_ID, pageId: PAGE_ID },
  );
  // 게시해도 칸반에서 숨기지 않는다. 게시 완료 열은 새로고침 뒤 블로그 저장소 기준으로 다시 그린다.
  expect(storedVisibility).toBe(true);
  onBlog = true;
  await page.reload();
  await expect(page.getByText("게시 완료 1편")).toBeVisible();
  await expect(page.getByText("게시된 글 보기")).toBeVisible();

  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: "블로그에서 내리기" }).click();
  await expect.poll(() => unpublishCalls).toBe(1);
  await expect(page.getByText("보관 중 1편")).toBeVisible();
  await expect(page.getByText("게시 완료 0편")).toBeVisible();

  userId = "90000001";
  await page.reload();
  await expect(page.getByText("보관 중 1편")).toBeVisible();
  const isolatedDatabases = await page.evaluate(async () =>
    (await indexedDB.databases()).map((database) => database.name),
  );
  expect(isolatedDatabases).toEqual(
    expect.arrayContaining([
      "kanban-press.board.52277540",
      "kanban-press.board.90000001",
    ]),
  );
  const newOwnerVisibility = await page.evaluate(
    async ({ connectionId, pageId }) => {
      const request = indexedDB.open("kanban-press.board.90000001");
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const get = database
        .transaction("boardRecords", "readonly")
        .objectStore("boardRecords")
        .get(["90000001", connectionId, pageId]);
      const record = await new Promise<Record<string, unknown> | undefined>(
        (resolve, reject) => {
          get.onsuccess = () => resolve(get.result as Record<string, unknown> | undefined);
          get.onerror = () => reject(get.error);
        },
      );
      database.close();
      return record?.isVisible;
    },
    { connectionId: CONNECTION_ID, pageId: PAGE_ID },
  );
  expect(newOwnerVisibility).toBe(true);
  await expectNoSeriousAccessibilityViolations(page);
});

test("mobile board fits 320px and remains keyboard operable", async ({ page }) => {
  await installAppRoutes(page, () => "52277540", () => undefined);
  await page.goto("/");
  await expect(page.getByText("E2E 게시 문서", { exact: true }).first()).toBeVisible();

  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBe(true);
  const performanceBudget = await page.evaluate(() => {
    const navigation = performance.getEntriesByType(
      "navigation",
    )[0] as PerformanceNavigationTiming | undefined;
    return {
      domContentLoadedMs: navigation?.domContentLoadedEventEnd ?? Infinity,
      transferBytes: performance
        .getEntriesByType("resource")
        .reduce((total, entry) => total + (entry as PerformanceResourceTiming).transferSize, 0),
    };
  });
  expect(performanceBudget.domContentLoadedMs).toBeLessThan(3_000);
  expect(performanceBudget.transferBytes).toBeLessThan(3_000_000);
  const card = page.getByRole("button", { name: "E2E 게시 문서 카드 이동" });
  await card.focus();
  await expect(card).toBeFocused();
  await card.press("Space");
  await expect(page.getByRole("status").last()).toContainText("위에 있습니다");
  await card.press("Escape");
  await expectNoSeriousAccessibilityViolations(page);
});

test("blog settings are edited in a dialog and saved as one request", async ({ page }) => {
  await installAppRoutes(page, () => "52277540", () => undefined);
  let saved: unknown = null;
  await page.route("**/api/blog/settings", (route) => {
    if (route.request().method() === "PUT") {
      saved = route.request().postDataJSON();
      return route.fulfill({ json: { commitSha: "d".repeat(40), settings: saved } });
    }
    return route.fulfill({
      json: {
        settings: { description: "기본 소개", links: [], title: "HappyDoran.log" },
        stored: false,
      },
    });
  });
  await page.goto("/");
  await page.getByText("게시 준비 완료").click();
  await page.getByRole("button", { name: "블로그 설정" }).click();
  const dialog = page.getByRole("dialog", { name: "블로그 설정" });
  await expect(dialog.getByLabel("블로그 이름")).toHaveValue("HappyDoran.log");

  await dialog.getByLabel("블로그 이름").fill("도란 블로그");
  await dialog.getByRole("button", { name: "+ 링크 추가" }).click();
  await dialog.getByLabel("링크 1 이름").fill("GitHub");
  await dialog.getByLabel("링크 1 주소").fill("https://github.com/HappyDoran");
  await expectNoSeriousAccessibilityViolations(page);
  await dialog.getByRole("button", { name: "저장" }).click();

  await expect(dialog.getByRole("status")).toContainText("저장했습니다");
  expect(saved).toEqual({
    description: "기본 소개",
    links: [{ label: "GitHub", url: "https://github.com/HappyDoran" }],
    title: "도란 블로그",
  });
});

test("document sidebar can be resized and remembers its width", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "경계선은 900px 이상에서만 보인다");
  await installAppRoutes(page, () => "52277540", () => undefined);
  await page.goto("/");
  const handle = page.getByRole("separator", { name: "문서 목록 너비" });
  await expect(handle).toHaveAttribute("aria-valuenow", "288");

  await handle.focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Shift+ArrowRight");
  await expect(handle).toHaveAttribute("aria-valuenow", "352");
  await page.keyboard.press("End");
  await expect(handle).toHaveAttribute("aria-valuenow", "520");
  const sidebarWidth = await page.getByRole("navigation", { name: "Notion 문서" }).evaluate((element) => element.getBoundingClientRect().width);
  expect(Math.round(sidebarWidth)).toBe(520);

  await page.reload();
  await expect(page.getByRole("separator", { name: "문서 목록 너비" })).toHaveAttribute("aria-valuenow", "520");
  await page.getByRole("separator", { name: "문서 목록 너비" }).dblclick();
  await expect(page.getByRole("separator", { name: "문서 목록 너비" })).toHaveAttribute("aria-valuenow", "288");
});

test("document titles can be searched in the sidebar", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "320px 흐름은 카드 게시 버튼 테스트가 맡는다");
  await installAppRoutes(page, () => "52277540", () => undefined);
  await page.goto("/");
  const sidebar = page.getByRole("navigation", { name: "Notion 문서" });
  await expect(sidebar.getByText("E2E 게시 문서")).toBeVisible();

  // 행의 "구조 확인 중…"도 status라서 검색 결과 문구만 골라 본다.
  const searchStatus = sidebar.getByRole("status").filter({ hasText: /^(문서 \d+개|일치하는 문서가 없습니다\.)$/ });
  await sidebar.getByRole("searchbox", { name: "문서 제목 검색" }).fill("없는 제목");
  await expect(searchStatus).toHaveText("일치하는 문서가 없습니다.");
  await expect(sidebar.getByText("E2E 게시 문서")).toHaveCount(0);

  await sidebar.getByRole("searchbox", { name: "문서 제목 검색" }).fill("e2e 게시");
  await expect(searchStatus).toHaveText("문서 1개");
  await expect(sidebar.getByText("E2E 게시 문서")).toBeVisible();
  await sidebar.getByRole("searchbox", { name: "문서 제목 검색" }).press("Escape");
  await expect(searchStatus).toHaveCount(0);
});

test("cards can be published with a button on narrow screens", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chromium", "넓은 화면은 끌어 놓기로 게시한다");
  let publishCalls = 0;
  await installAppRoutes(page, () => "52277540", () => {
    publishCalls += 1;
  });
  await page.goto("/");
  await page.getByRole("button", { exact: true, name: "게시" }).click();
  await expect.poll(() => publishCalls).toBe(1);
  await expect(page.getByText("게시된 글 보기")).toBeVisible();
  await expect(page.getByRole("button", { exact: true, name: "다시 게시" })).toBeVisible();
});

async function installAppRoutes(
  page: Page,
  currentUserId: () => string,
  onPublish: () => void,
): Promise<void> {
  await page.route("**/api/me", (route) =>
    route.fulfill({
      json: {
        authenticated: true,
        user: { id: currentUserId(), login: "HappyDoran" },
      },
    }),
  );
  await page.route("**/api/notion/connections", (route) =>
    route.fulfill({
      json: {
        connections: [
          {
            connectedAt: 2_000_000_000,
            connectionId: CONNECTION_ID,
            workspaceIcon: null,
            workspaceName: "E2E Workspace",
          },
        ],
      },
    }),
  );
  await page.route("**/api/notion/connections/*/pages", (route) =>
    route.fulfill({
      json: {
        pages: [
          {
            hasChildren: false,
            iconUrl: null,
            lastEditedAt: LAST_EDITED_AT,
            parentContainerId: null,
            parentPageId: null,
            providerPageId: PAGE_ID,
            title: "E2E 게시 문서",
          },
        ],
      },
    }),
  );
  await page.route("**/api/notion/connections/*/pages/*/outline", (route) =>
    route.fulfill({ json: { outline: [] } }),
  );
  await page.route("**/api/github/pages-repository", (route) =>
    route.fulfill({
      json: {
        readiness: {
          conflictingPaths: [],
          managedPaths: ["package.json"],
          pagesSettingsUrl:
            "https://github.com/HappyDoran/HappyDoran.github.io/settings/pages",
          state: "ready",
        },
        repository: {
          defaultBranch: "main",
          fullName: "HappyDoran/HappyDoran.github.io",
        },
      },
    }),
  );
  await page.route("**/api/publish/preview", (route) =>
    route.fulfill({
      json: {
        document: {
          blocks: [
            {
              kind: "heading",
              level: 2,
              richText: [{ bold: false, code: false, href: null, italic: false, strikethrough: false, text: "E2E 제목 1" }],
            },
            {
              kind: "heading",
              level: 3,
              richText: [{ bold: false, code: false, href: null, italic: false, strikethrough: false, text: "E2E 제목 2" }],
            },
            {
              kind: "heading",
              level: 4,
              richText: [{ bold: false, code: false, href: null, italic: false, strikethrough: false, text: "E2E 제목 3" }],
            },
            {
              kind: "paragraph",
              richText: [
                {
                  bold: false,
                  code: false,
                  href: null,
                  italic: false,
                  strikethrough: false,
                  text: "E2E 프리뷰 본문",
                },
              ],
            },
          ],
          category: { name: "테스트", slug: "test-e2e00001" },
          description: "E2E 설명",
          publishedAt: LAST_EDITED_AT,
          slug: "e2e-post-9188c6a57381",
          tags: ["E2E"],
          title: "E2E 게시 문서",
          updatedAt: LAST_EDITED_AT,
        },
        previewSchemaVersion: 1,
        sourceLastEditedAt: LAST_EDITED_AT,
        templateVersion: 2,
        warnings: [],
      },
    }),
  );
  await page.route("**/api/publish", (route) => {
    onPublish();
    return route.fulfill({
      json: {
        commitSha: "a".repeat(40),
        contentHash: "b".repeat(64),
        created: true,
        pageUrl: "https://happydoran.github.io/posts/e2e-post-9188c6a57381/",
      },
    });
  });
  await page.route("**/api/publish/status?**", (route) =>
    route.fulfill({
      json: {
        actionsUrl:
          "https://github.com/HappyDoran/HappyDoran.github.io/actions/runs/123",
        commitSha: "a".repeat(40),
        pageUrl: "https://happydoran.github.io/posts/e2e-post-9188c6a57381/",
        state: "succeeded",
      },
    }),
  );
}

async function expectNoSeriousAccessibilityViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .analyze();
  expect(
    results.violations.filter((violation) =>
      ["critical", "serious"].includes(violation.impact ?? ""),
    ),
  ).toEqual([]);
}
