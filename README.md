# FileFlicker
This is the code of FileFlicker Web version

## 읽기 전용 MCP 연결

- 서버 주소: `https://elbepqrahykhefjdlnqn.supabase.co/functions/v1/mcp`
- ChatGPT에서 사용자 지정 앱 또는 MCP 연결을 추가할 때 위 주소를 입력하고, FileFlicker 계정으로 로그인한 뒤 접근에 동의한다. 사용 가능한 메뉴와 연결 기능은 ChatGPT 환경에 따라 다를 수 있다.
- 로그인한 계정이 소유한 파일의 제목 검색, 메타데이터 조회, 다운로드 링크 발급이 가능하다. TXT와 Markdown 파일은 내용도 읽을 수 있다. PDF와 Office 파일의 본문 읽기 및 OCR은 아직 지원하지 않는다.
- 파일 수정, 업로드, 삭제는 MCP에서 제공하지 않는다. 다운로드 링크는 파일 내용에 접근할 수 있으므로 신뢰하는 앱에만 접근을 허용한다.
- 인증은 Supabase OAuth를 사용한다. 운영 사이트는 `https://fileflicker.pages.dev`, 동의 화면 경로는 `/oauth/consent`다. 비밀번호, API 키, 토큰은 이 문서에 기록하지 않는다.
- `main`에 푸시하면 GitHub Actions가 MCP 함수를 포함해 자동 배포한다. 워크플로 파일을 변경해 푸시할 때는 GitHub 토큰에 저장소 **Workflows: Read and write** 권한이 필요하다.

로컬에서 웹 앱을 실행하려면 `npm ci` 후 `npm run dev`를 실행하고 `http://localhost:5173`을 연다. 스타일을 수정한 뒤 이미 실행 중인 서버에 반영하려면 `npm run build:css`를 실행한다.

`npm run build`는 TypeScript 검사와 Tailwind CSS 생성을 거쳐 Vite로 `dist/`를 만든다. GitHub Actions도 같은 명령을 실행한다.

## 자동 배포

`main`에 푸시하면 [배포 워크플로](.github/workflows/deploy.yml)가 실행된다.
Supabase의 `files` 함수를 배포하고 운영 주소의 CORS 사전 요청이 통과하면 웹 자산을 Cloudflare Pages에 배포한다.

첫 배포에 필요한 설정

1. Cloudflare에서 프로덕션 브랜치가 `main`인 Pages Direct Upload 프로젝트를 생성한다.
2. GitHub 저장소의 **Settings → Secrets and variables → Actions**에 다음 값을 등록한다.

   | 유형 | 이름 | 값 |
   |---|---|---|
   | Secret | `SUPABASE_ACCESS_TOKEN` | FileFlicker 프로젝트로 제한한 Supabase 관리 토큰. Edge Functions와 Edge Function Secrets에 Read-write 권한이 필요하다. |
   | Secret | `CLOUDFLARE_PAGES_API_TOKEN` | Cloudflare 해당 계정의 Pages 편집 권한을 가진 배포용 토큰 |
   | Variable | `CLOUDFLARE_ACCOUNT_ID` | Pages 프로젝트의 Cloudflare 계정 ID |
   | Variable | `CLOUDFLARE_PAGES_PROJECT` | 실제 Pages 프로젝트 이름 |
   | Variable | `FILEFLICKER_APP_ORIGIN` | 실제 운영 주소의 origin. 예를 들어 `https://fileflicker.pages.dev` |

3. R2의 `fileflicker` 버킷 CORS에 실제 운영 origin을 추가한다. 기존 로컬 개발 주소와 허용 메서드·헤더를 유지한다.
4. `main`에 푸시한 뒤 GitHub Actions에서 배포 결과를 확인한다. 배포가 끝나면 운영 주소에서 로그인과 합성 파일 업로드·다운로드를 확인한다.

R2와 OpenAI 키는 Supabase Edge Function 비밀값에서 관리한다. GitHub Actions에는 배포용 토큰만 등록한다.
