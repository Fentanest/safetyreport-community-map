import type { AuthSnapshot } from '../auth/mapAuth';
import type { AccessCode } from '../data/client';
import { ISSUES_URL } from './DataGuide';

interface Props {
  code: AccessCode;
  auth: AuthSnapshot;
  onSignIn: () => void;
  onSignOut: () => void;
  onRetry: () => void;
  /** threshold progress from the upload_required refusal (required 10, current N or null when unknown) */
  progress?: { required: number; current: number | null } | null;
}

/**
 * Contributor-only map (user decision 2026-09-28): until enough people join, only signed-in Kakao users who have
 * shared at least 10 reports (on the map, under an active share consent) can see it. The server enforces this for
 * every API route; this screen only explains it.
 */
export default function AccessGate({ code, auth, onSignIn, onSignOut, onRetry, progress }: Props) {
  const signedIn = auth.status === 'signed_in';
  const needLogin = !signedIn || code === 'auth_required' || code === 'session_expired';
  return (
    <main id="main" className="access-gate">
      <section className="cm-panel access-card" aria-labelledby="gate-title">
        <div className="overline">나만의 안전신문고 커뮤니티</div>
        <h1 id="gate-title">지금은 신고를 10건 이상 공유한 분만 볼 수 있어요</h1>
        <p>
          커뮤니티 신고 지도는 참여하는 분이 모일 때까지 <b>나만의 안전신문고 앱에서 신고 결과를 열 건 이상 공유한 분</b>께만
          먼저 열어 두었습니다. 참여하는 분이 늘면 누구나 볼 수 있게 열 예정입니다.
        </p>

        {needLogin ? (
          <>
            <p className="access-lead">
              {code === 'session_expired' ? '로그인이 만료되었습니다. 다시 로그인해 주세요.' : '앱에서 쓰는 카카오 계정으로 로그인해 주세요.'}
            </p>
            {auth.status === 'unconfigured' ? (
              <p className="cm-muted" role="note">{auth.message ?? '지금은 로그인 기능을 쓸 수 없습니다.'}</p>
            ) : (
              <button className="primary-button kakao-login" type="button" onClick={onSignIn} disabled={auth.status === 'loading'}>
                {auth.status === 'loading' ? '로그인 확인 중…' : '카카오로 로그인'}
              </button>
            )}
            {auth.status === 'error' && auth.message && <p className="field-error" role="alert">{auth.message}</p>}
          </>
        ) : code === 'kakao_required' ? (
          <>
            <p className="access-lead" role="alert">카카오 계정으로 로그인해야 볼 수 있습니다.</p>
            <button className="ghost-btn" type="button" onClick={onSignOut}>로그아웃하고 카카오로 다시 로그인</button>
          </>
        ) : code === 'upload_required' ? (
          <>
            <p className="access-lead" role="alert">
              {auth.displayName ? `${auth.displayName} 계정은` : '이 계정은'}{' '}
              {progress?.current != null
                ? `지도에 올라간 신고가 지금 ${progress.current}건이라 아직 볼 수 없습니다.`
                : '지도에 올라간 신고 건수를 확인할 수 없어 아직 볼 수 없습니다.'}
              {progress?.required != null ? ` ${progress.required}건 이상이면 볼 수 있습니다.` : ' 열 건 이상이면 볼 수 있습니다.'}
            </p>
            {progress?.current != null && progress?.required != null && (
              <p className="cm-muted" role="status">지금 {progress.current}건 / {progress.required}건 공유됨</p>
            )}
            <p>
              앱이 답변 완료된 신고를 수집하면 바로, 또는 신고 지도 탭의 ‘지금 업로드’, 매일 0시에 자동으로 올립니다.
              답변이 완료된 신고가 있는데도 이 화면이 보이면 앱에서 ‘지금 업로드’를 눌러 보세요.
            </p>
            <div className="access-actions">
              <button className="primary-button" type="button" onClick={onRetry}>다시 확인</button>
              <button className="ghost-btn" type="button" onClick={onSignOut}>다른 계정으로 로그인</button>
            </div>
          </>
        ) : (
          <>
            <p className="access-lead" role="alert">
              {auth.displayName ? `${auth.displayName} 계정은` : '이 계정은'} 아직 신고내용 공유에 동의하지 않았거나 동의를 철회한 상태입니다.
            </p>
            <ol className="access-steps">
              <li>나만의 안전신문고 앱(PC·Docker 또는 모바일)에서 같은 카카오 계정으로 로그인합니다.</li>
              <li>[필수] 신고 결과 공유 동의를 읽고 동의합니다.</li>
              <li>답변 완료된 신고가 열 건 이상 지도에 올라가면, 여기로 돌아와 ‘다시 확인’을 누릅니다.</li>
            </ol>
            <div className="access-actions">
              <button className="primary-button" type="button" onClick={onRetry}>다시 확인</button>
              <button className="ghost-btn" type="button" onClick={onSignOut}>다른 계정으로 로그인</button>
            </div>
          </>
        )}

        <p className="cm-muted access-foot">
          이 로그인은 지도를 보기 위한 것이고 앱의 자동 업로드와는 따로 동작합니다. 여기서 로그아웃해도 앱의 업로드는 그대로입니다.
          문의는 <a href={ISSUES_URL} target="_blank" rel="noopener noreferrer">문의 게시판(GitHub Issues)</a>에 남겨 주세요(공개 게시판이니 개인정보는 적지 마세요).
        </p>
      </section>
    </main>
  );
}
