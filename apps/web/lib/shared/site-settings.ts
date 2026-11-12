// 블로그 사이트 설정(제품 명세 §5.1 R11). 블로그 저장소의 `.kanban-press/site.json` 한 파일에 두고
// 생성 블로그 template이 빌드할 때 읽는다. 브라우저와 서버가 같은 형식을 쓴다.
import { z } from "zod";

export const SITE_SETTINGS_PATH = ".kanban-press/site.json";
/** 프로젝트 이름을 바꾸기 전(2026-11-10) 위치. 새 파일이 없을 때만 읽고, 저장할 때 새 위치로 옮긴다. */
export const LEGACY_SITE_SETTINGS_PATH = ".notion-kanban-blog/site.json";
export const DEFAULT_SITE_DESCRIPTION = "Notion에서 쓰고 GitHub Pages에 쌓아 가는 개발 기록입니다.";

export const siteSettingsSchema = z
  .object({
    description: z.string().trim().max(200),
    links: z
      .array(
        z
          .object({
            label: z.string().trim().min(1).max(20),
            url: z.url({ protocol: /^https$/ }).max(300),
          })
          .strict(),
      )
      .max(4),
    title: z.string().trim().min(1).max(40),
  })
  .strict();

export type SiteSettings = z.infer<typeof siteSettingsSchema>;

/** 설정 파일이 없을 때 template이 쓰는 값과 같다. */
export function defaultSiteSettings(githubLogin: string): SiteSettings {
  return { description: DEFAULT_SITE_DESCRIPTION, links: [], title: `${githubLogin}.log` };
}

/** 저장소에 쓰는 결정적 JSON(키 순서 고정, 끝 줄바꿈). */
export function serializeSiteSettings(settings: SiteSettings): string {
  return `${JSON.stringify(
    {
      description: settings.description,
      links: settings.links.map((link) => ({ label: link.label, url: link.url })),
      title: settings.title,
    },
    null,
    2,
  )}\n`;
}
