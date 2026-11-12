// 게시 요청 → GitHub Actions 배포 완료까지 기다리는 흐름. React를 모른다.
// 서버 측 재시도나 이력은 없으므로(제품 명세 §4) 화면을 닫으면 확인을 멈추고 결과는 남기지 않는다.
import { TaskLimiter } from "@/lib/shared/task-limiter";
import { ApiError, fetchPublishStatus, type PublishStatus, requestPublish, requestUnpublish } from "./api";

// 상태 확인 한 번에 서버가 GitHub API를 2~6번 부른다. 여러 글을 함께 게시하면 사용자 GitHub 한도(시간당 5,000)를
// 금방 다 쓰므로 간격을 넉넉히 둔다. 빌드·Pages 반영에 보통 1분 이상 걸려 10초 간격이면 충분하다.
const POLL_INTERVAL_MS = 10_000;
const MAX_POLLS = 36; // 약 6분

// 서버는 요청마다 기본 branch의 최신 commit 위에 새 commit을 쌓고 force 없이 ref를 옮긴다. 이 탭에서
// 게시·내리기 요청을 동시에 보내면 늦은 쪽이 conflict로 실패하므로 commit 요청만 한 번에 하나씩 보낸다.
// 다른 탭·기기와의 충돌은 막지 못한다.
const commitQueue = new TaskLimiter(1);

// 이 탭의 commit은 위 queue로 하나씩 쌓이므로 마지막 commit이 앞선 commit을 모두 포함한다. 그래서 기다리는 글이
// 여럿이어도 마지막 commit 하나만 조회하고, 다른 글이 내 대기 중에 받아 둔 결과가 있으면 그것을 쓴다(명세 §5 상태 조회).
let latestCommit: string | null = null;
let statusSequence = 0;
let lastStatus: { commitSha: string; sequence: number; status: Promise<PublishStatus> } | null = null;

/** `after` 이후에 시작한 같은 commit 조회가 있으면 그 결과를, 없으면 새로 조회한다. */
function sharedStatus(commitSha: string, githubLogin: string, after: number): Promise<PublishStatus> {
  if (lastStatus !== null && lastStatus.commitSha === commitSha && lastStatus.sequence > after) {
    return lastStatus.status;
  }
  statusSequence += 1;
  lastStatus = { commitSha, sequence: statusSequence, status: fetchPublishStatus(commitSha, githubLogin) };
  return lastStatus.status;
}

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
  const { commitSha, pageUrl } = await commitQueue.run(async () => {
    const result = await requestPublish(watch.connectionId, watch.providerPageId);
    latestCommit = result.commitSha;
    return result;
  });

  let after = statusSequence;
  for (let attempt = 0; attempt < MAX_POLLS; attempt += 1) {
    if (watch.isCancelled()) {
      return null;
    }
    const target = latestCommit ?? commitSha;
    let status = await sharedStatus(target, watch.githubLogin, after);
    if (status.state === "failed" && target !== commitSha) {
      // 마지막 commit 배포가 실패해도 내 commit은 이미 배포됐을 수 있다.
      status = await fetchPublishStatus(commitSha, watch.githubLogin);
    }
    if (status.actionsUrl !== null) {
      watch.onActionsUrl(status.actionsUrl);
    }
    if (status.state === "succeeded") {
      return pageUrl;
    }
    if (status.state === "failed") {
      throw new ApiError("deployment_failed");
    }
    after = statusSequence;
    await sleep(POLL_INTERVAL_MS);
  }
  throw new ApiError("deployment_timeout");
}
