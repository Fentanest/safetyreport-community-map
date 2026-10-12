/** Include date + seconds: midnight and independently timed snapshots must not look identical. */
export function snapshotTime(at: string): string {
  return new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(new Date(at));
}

/** Compare actual instants, independently of source-version comparability. */
export function snapshotBasis(publicAt: string, personalAt?: string): string {
  return personalAt && Date.parse(publicAt) !== Date.parse(personalAt)
    ? `전체 ${snapshotTime(publicAt)} · 내 신고 ${snapshotTime(personalAt)} 기준`
    : `${personalAt ? '전체 · 내 신고' : '전체'} ${snapshotTime(publicAt)} 기준`;
}
