import {
  createSiteSettingsDependencies,
  getSiteSettings,
  saveSiteSettings,
} from "../../../../lib/publish/site-settings-route";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  return getSiteSettings(request, createSiteSettingsDependencies());
}

export async function PUT(request: Request): Promise<Response> {
  return saveSiteSettings(request, createSiteSettingsDependencies());
}
