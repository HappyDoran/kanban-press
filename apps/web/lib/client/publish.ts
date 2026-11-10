// 게시 요청 → GitHub Actions 배포 완료까지 기다리는 흐름. React와 IndexedDB를 모른다.
// 서버 측 재시도나 이력은 없으므로(제품 명세 §4) 화면을 닫으면 확인을 멈추고 결과는 남기지 않는다.
import { ApiError, fetchPublishStatus, requestPublish } from "./api";

const POLL_INTERVAL_MS = 3_000;
const MAX_POLLS = 120; // 약 6분

export interface PublishWatch {
  connectionId: string;
  githubLogin: string;
  /** 화면이 사라지는 등 더 기다릴 필요가 없으면 true. */
  isCancelled: () => boolean;
  /** Actions 실행 링크가 처음 생기거나 바뀔 때. */
  onActionsUrl: (url: string) => void;
  providerPageId: string;
  sleep?: (milliseconds: number) => Promise<void>;
}

/**
 * 게시를 요청하고 배포가 끝날 때까지 상태를 확인한다.
 * 성공하면 게시된 글 URL, 취소되면 `null`. 실패는 `ApiError`(code: deployment_failed·deployment_timeout 또는 서버 code).
 */
export async function publishAndWatch(watch: PublishWatch): Promise<string | null> {
  const sleep = watch.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const { commitSha, pageUrl } = await requestPublish(watch.connectionId, watch.providerPageId);

  for (let attempt = 0; attempt < MAX_POLLS; attempt += 1) {
    if (watch.isCancelled()) {
      return null;
    }
    const status = await fetchPublishStatus(commitSha, watch.githubLogin);
    if (status.actionsUrl !== null) {
      watch.onActionsUrl(status.actionsUrl);
    }
    if (status.state === "succeeded") {
      return pageUrl;
    }
    if (status.state === "failed") {
      throw new ApiError("deployment_failed");
    }
    await sleep(POLL_INTERVAL_MS);
  }
  throw new ApiError("deployment_timeout");
}
