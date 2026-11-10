// 게시 요청 → GitHub Actions 배포 완료까지 기다리는 흐름. React와 IndexedDB를 모른다.
// 서버 측 재시도나 이력은 없으므로(제품 명세 §4) 화면을 닫으면 확인을 멈추고 결과는 남기지 않는다.
import { TaskLimiter } from "../board/task-limiter";
import { ApiError, fetchPublishStatus, requestPublish, requestUnpublish } from "./api";

// 상태 확인 한 번에 서버가 GitHub API를 2~6번 부른다. 여러 글을 함께 게시하면 사용자 GitHub 한도(시간당 5,000)를
// 금방 다 쓰므로 간격을 넉넉히 둔다. 빌드·Pages 반영에 보통 1분 이상 걸려 10초 간격이면 충분하다.
const POLL_INTERVAL_MS = 10_000;
const MAX_POLLS = 36; // 약 6분

// 서버는 요청마다 기본 branch의 최신 commit 위에 새 commit을 쌓고 force 없이 ref를 옮긴다. 이 탭에서
// 게시·내리기 요청을 동시에 보내면 늦은 쪽이 conflict로 실패하므로 commit 요청만 한 번에 하나씩 보낸다.
// 배포 상태 확인은 동시에 한다. 다른 탭·기기와의 충돌은 막지 못한다.
const commitQueue = new TaskLimiter(1);

/** 이 탭의 다른 게시·내리기 commit 요청이 끝난 뒤 내리기를 요청한다. */
export function unpublishInOrder(connectionId: string, providerPageId: string): ReturnType<typeof requestUnpublish> {
  return commitQueue.run(() => requestUnpublish(connectionId, providerPageId));
}

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
  const { commitSha, pageUrl } = await commitQueue.run(() =>
    requestPublish(watch.connectionId, watch.providerPageId),
  );

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
