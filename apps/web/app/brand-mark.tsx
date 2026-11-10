/** 화면에 보이는 앱 이름. 내부 식별자(저장소·패키지·쿠키·DB 이름)는 `kanban-press`·`kp`를 쓴다. */
export const APP_NAME = "Kanban Press";

// 앱 로고: 칸반의 세 열(보관 중·게시 중·게시 완료)을 단순화한 막대. app/icon.svg와 같은 그림이다.
export function BrandMark() {
  return (
    <svg aria-hidden="true" className="brandMark" fill="none" height="28" viewBox="0 0 28 28" width="28">
      <rect fill="var(--color-accent)" height="28" rx="7" width="28" />
      <rect fill="#ffffff" height="14" rx="1.5" width="4" x="7" y="7" />
      <rect fill="#ffffff" height="10" rx="1.5" width="4" x="12" y="7" />
      <rect fill="#ffffff" fillOpacity="0.7" height="6" rx="1.5" width="4" x="17" y="7" />
    </svg>
  );
}
