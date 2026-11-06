# 수봉화실 로그인 유지 서버

기존 주소 `https://raphlow23.github.io/academy-note/`와 같은 Google OAuth 클라이언트를 유지합니다. 수강생·예약·납부·휴무 자료는 기존 Google Sheets에서 계속 처리합니다. 이 서버에는 시트 내용 읽기/쓰기 코드가 없습니다.

## 구성
- Cloudflare Workers Free + 새 전용 D1 `subong-academy-auth`.
- 기본 로그인은 Google Identity Services의 승인 코드 팝업 방식입니다. 서버가 코드를 교환하므로 기존 홈 화면 웹앱과 GitHub 주소를 유지합니다. 같은 OAuth 클라이언트/같은 drive.file 범위입니다. 리디렉션 예비 경로에는 서버 PKCE와 브라우저 바인딩을 적용합니다.
- Google Refresh Token과 짧은 Access Token은 AES-GCM으로 암호화해 D1에 저장합니다. 암호화 키와 클라이언트 비밀번호는 Worker Secrets입니다.
- 브라우저에는 Google Refresh Token을 보내지 않습니다. 256비트 무작위 앱 세션만 기존 사이트의 기기 저장소에 보관하고 D1에는 그 해시만 보관합니다. 다른 사이트 쿠키에 의존하지 않으므로 GitHub 주소와 기존 바로가기를 유지할 수 있습니다.
- 세션은 사용 시 갱신되며 180일 미사용 시 만료됩니다. Google이 권한을 취소하면 재연결이 필요합니다.
- 로그아웃은 해당 기기 세션만 삭제합니다. Google 권한/시트/다른 기기 세션은 지우지 않습니다.

## 배포와 비밀 정보
`wrangler.jsonc`에는 공개 설정과 D1 ID만 있습니다. `GOOGLE_CLIENT_SECRET`, `TOKEN_ENCRYPTION_KEY`는 `wrangler secret bulk`로 주입하며 코드/저장소/소스 ZIP에 넣지 않습니다. 새 비밀번호를 추가하되 기존 비밀번호는 유지합니다.

승인된 Google 반환 주소: `https://subong-academy-auth.raphlow.workers.dev/auth/callback`

## 안전 전환
1. 읽기 전용 사전 검증을 완료한 뒤 기본 앱의 `CONFIG.authEnabled=true`로 전환했습니다.
2. `?auth_preview=1`에서만 새 인증을 확인합니다. 이 모드는 Google Sheets의 조회·백업만 허용하고 저장/공유 변경/자동 완료/미전송 재처리를 모두 차단합니다.
3. 기존 시트 ID, 수강생/납부/예약/휴무 목록을 읽기 검증했습니다. 실제 Google 토큰을 만료 처리한 뒤 새로고침에서 자동 갱신·동일 자료 복원을 확인했습니다. 확인 과정에서 시트 쓰기는 수행하지 않았습니다.
4. 반환 주소/사용법/자료 형식/공유 권한은 유지합니다. 새 인증의 첫 연결에는 Google 계정 확인이 한 번 필요합니다.
5. 롤백은 authEnabled를 false로 되돌립니다. 서버 전환 자체가 원본 자료를 옮기거나 바꾸지 않으므로 데이터 롤백은 없습니다.

## 검증
`node --test academy-auth/tests/*.test.mjs` 및 `node --test academy-pages/tests/*.test.mjs`.
상태 재사용 방지, 브라우저 바인딩, 허용 원본, 토큰 암호화, 계정/기기 분리, 만료 자동 갱신, API 재시도, 기존 시트 재사용, 읽기 전용 확인 경로를 검사합니다.
