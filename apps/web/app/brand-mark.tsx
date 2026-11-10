/** 화면에 보이는 앱 이름. 내부 식별자(저장소·패키지·쿠키·DB 이름)는 `kanban-press`·`kp`를 쓴다. */
export const APP_NAME = "Kanban Press";

// 앱 로고: ‘칸’‘반’ 두 원고지 칸과 교정 삽입 표시(∧). 칸반의 ‘칸’을 원고지 칸으로 읽는다(디자인 기획 2.4).
// app/icon.svg는 같은 그림의 ‘칸’ 한 칸이다.
export function BrandMark() {
  return (
    <svg aria-hidden="true" className="brandMark" fill="none" height="28" viewBox="0 0 44 28" width="44">
      <rect height="21" stroke="var(--color-guide)" width="21" x="0.5" y="6.5" />
      <rect height="21" stroke="var(--color-guide)" width="21" x="21.5" y="6.5" />
      <text fill="var(--color-text-primary)" fontFamily="var(--font-title)" fontSize="14" fontWeight="700" textAnchor="middle" x="11" y="22">
        칸
      </text>
      <text fill="var(--color-text-primary)" fontFamily="var(--font-title)" fontSize="14" fontWeight="700" textAnchor="middle" x="32" y="22">
        반
      </text>
      <path d="M28.5 6.5 32 1l3.5 5.5" stroke="var(--color-proof)" strokeWidth="1.5" />
    </svg>
  );
}
