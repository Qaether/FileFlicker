# FileFlicker 작업 지침

- 구현에 착수하기 전에 `implemenation.md`와 `completed.md`를 읽고, 진행 중인 단계와 남은 검증을 확인한다. 계획이 변경되면 `implemenation.md`에 반영한다.
- 구현과 검증을 마친 항목은 `completed.md`에 결과와 검증 근거를 기록한다. 부분 검증만 했다면 확인한 범위와 남은 작업을 구분한다.
- 정적 웹 클라이언트, Supabase Auth·Postgres·Edge Functions, 비공개 Cloudflare R2 구성을 기준으로 개발한다. 파일 접근과 서명 URL 발급 시 로그인과 소유권을 확인한다.
- 비밀값은 로컬 `.env.local` 또는 배포 환경의 비밀값 저장소에서 관리한다. 코드, Git, 로그, 브라우저 공개 자산에 포함하지 않는다.
- 가급적 합성 파일로 업로드·중복 확인·다운로드를 검증한다. 기존 클라우드 자원에 손대기 전에 작업 대상이 FileFlicker인지 확인한다.
