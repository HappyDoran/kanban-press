import { ALLOWED_CATEGORIES } from '../config.js';

const rules: Record<(typeof ALLOWED_CATEGORIES)[number], string[]> = {
  Frontend: ['frontend', 'html', 'css', 'javascript', 'typescript', 'browser', 'electron', '웹'],
  React: ['react', 'next.js', 'nextjs', 'jsx', 'useeffect', 'usestate', 'usecallback', 'react native'],
  CS: ['운영체제', '네트워크', '메모리', '프로세스', '스레드', '데이터베이스', '컴퓨터 구조', 'event loop'],
  Algorithm: ['알고리즘', 'bfs', 'dfs', 'dp', '다익스트라', '이분탐색', '백트래킹', '플로이드', 'c++'],
  iOS: ['ios', 'xcode', 'storekit', 'testflight', 'app store', 'fastlane'],
  Swift: ['swift', 'actor', 'asyncstream', 'protocol', '옵셔널'],
  SwiftUI: ['swiftui', '@state', '@binding', 'navigationstack', 'viewbuilder'],
  DevOps: ['github actions', 'ci/cd', 'docker', '배포', 'pipeline', 'devops'],
  Troubleshooting: ['에러', '오류', '해결', '트러블슈팅', 'debug', 'warning', 'failed'],
  Etc: [],
};

export function classify(title: string, plainText: string) {
  const haystack = `${title}\n${plainText}`.toLowerCase();
  const scores = Object.entries(rules).map(([category, keywords]) => ({
    category,
    matches: keywords.filter(keyword => haystack.includes(keyword.toLowerCase())),
  })).sort((a, b) => b.matches.length - a.matches.length);
  const winner = scores[0];
  const category = winner.matches.length ? winner.category : 'Etc';
  const tags = [...new Set(winner.matches)].slice(0, 5);
  return { category, tags, confidence: Math.min(95, 55 + winner.matches.length * 10) };
}
