"use client";

// 블로그 사이트 설정(R11, 결정 D3): 이름·소개·프로필 링크. 저장하면 블로그 저장소에 설정 파일 하나를 commit하고,
// 블로그는 다음 배포 때 이 값을 읽는다.
import { type FormEvent, useEffect, useRef, useState } from "react";

import { ApiError, fetchSiteSettings, publishErrorMessage, saveSiteSettings } from "@/lib/client/api";
import { type SiteSettings, siteSettingsSchema } from "@/lib/shared/site-settings";

const MAX_LINKS = 4;

type Status =
  | { kind: "error"; message: string }
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "saved" }
  | { kind: "saving" };

export function SiteSettingsButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="buttonSecondary small" onClick={() => setOpen(true)} type="button">
        블로그 설정
      </button>
      {open ? <SiteSettingsDialog onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function SiteSettingsDialog({ onClose }: { onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [settings, setSettings] = useState<SiteSettings | null>(null);
  const [status, setStatus] = useState<Status>({ kind: "loading" });

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    if (dialog !== null && !dialog.open && typeof dialog.showModal === "function") dialog.showModal();
    const controller = new AbortController();
    fetchSiteSettings(controller.signal)
      .then(({ settings: loaded }) => {
        setSettings(loaded);
        setStatus({ kind: "idle" });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setStatus({ kind: "error", message: errorMessage(error) });
        }
      });
    return () => {
      controller.abort();
      if (dialog?.open === true) dialog.close();
      previousFocus?.focus();
    };
  }, []);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (settings === null) return;
    const parsed = siteSettingsSchema.safeParse({
      ...settings,
      links: settings.links.filter((link) => link.label.trim() !== "" || link.url.trim() !== ""),
    });
    if (!parsed.success) {
      setStatus({ kind: "error", message: publishErrorMessage("invalid_site_settings") });
      return;
    }
    setStatus({ kind: "saving" });
    try {
      await saveSiteSettings(parsed.data);
      setSettings(parsed.data);
      setStatus({ kind: "saved" });
    } catch (error) {
      setStatus({ kind: "error", message: errorMessage(error) });
    }
  }

  const update = (patch: Partial<SiteSettings>) => setSettings((current) => (current === null ? current : { ...current, ...patch }));
  const updateLink = (index: number, patch: Partial<SiteSettings["links"][number]>) =>
    update({ links: (settings?.links ?? []).map((link, at) => (at === index ? { ...link, ...patch } : link)) });

  return (
    <dialog
      aria-labelledby="site-settings-title"
      className="settingsDialog"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      ref={dialogRef}
    >
      <form onSubmit={(event) => void submit(event)}>
        <div className="previewDialogHeader">
          <p className="previewTitle" id="site-settings-title">
            블로그 설정
          </p>
          <button className="buttonSecondary" onClick={onClose} type="button">
            닫기
          </button>
        </div>
        {settings === null ? (
          <p className="settingsNotice" role="status">
            {status.kind === "error" ? status.message : "설정을 불러오고 있습니다."}
          </p>
        ) : (
          <div className="settingsBody">
            <label>
              <span>블로그 이름</span>
              <input maxLength={40} onChange={(event) => update({ title: event.target.value })} required value={settings.title} />
            </label>
            <label>
              <span>소개</span>
              <textarea
                maxLength={200}
                onChange={(event) => update({ description: event.target.value })}
                rows={3}
                value={settings.description}
              />
            </label>
            <fieldset>
              <legend>프로필 링크 (최대 {MAX_LINKS}개, https 주소)</legend>
              {settings.links.map((link, index) => (
                <div className="settingsLink" key={index}>
                  <input
                    aria-label={`링크 ${index + 1} 이름`}
                    maxLength={20}
                    onChange={(event) => updateLink(index, { label: event.target.value })}
                    placeholder="이름"
                    value={link.label}
                  />
                  <input
                    aria-label={`링크 ${index + 1} 주소`}
                    onChange={(event) => updateLink(index, { url: event.target.value })}
                    placeholder="https://"
                    type="url"
                    value={link.url}
                  />
                  <button
                    aria-label={`링크 ${index + 1} 삭제`}
                    className="iconButton"
                    onClick={() => update({ links: settings.links.filter((_, at) => at !== index) })}
                    type="button"
                  >
                    ✕
                  </button>
                </div>
              ))}
              {settings.links.length < MAX_LINKS ? (
                <button
                  className="buttonQuiet"
                  onClick={() => update({ links: [...settings.links, { label: "", url: "" }] })}
                  type="button"
                >
                  + 링크 추가
                </button>
              ) : null}
            </fieldset>
            <p className="settingsNotice" role="status">
              {status.kind === "saved"
                ? "저장했습니다. 블로그 배포가 끝나면 반영됩니다."
                : status.kind === "error"
                  ? status.message
                  : "저장하면 블로그 저장소에 설정 파일을 commit합니다."}
            </p>
            <div className="settingsActions">
              <button className="buttonPrimary" disabled={status.kind === "saving"} type="submit">
                {status.kind === "saving" ? "저장 중…" : "저장"}
              </button>
            </div>
          </div>
        )}
      </form>
    </dialog>
  );
}

function errorMessage(error: unknown): string {
  return publishErrorMessage(error instanceof ApiError ? error.code : "site_settings_unavailable");
}
