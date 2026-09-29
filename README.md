# 마피아 게임 — Supabase 버전

정적 화면은 `docs/`, 서버 코드는 Supabase Edge Function과 Postgres migration에 있습니다. 기존 PHP 파일과 `data/`는 이 버전에서 사용하지 않습니다.

## 배포 준비

- Node.js 20 이상과 npm 필요. Supabase CLI는 `package.json`에 고정되어 있습니다.
- `docs/supabase-config.js`에는 브라우저 공개용 Project URL과 publishable key만 둡니다. 비밀키는 넣지 않습니다.
- 익명 로그인은 `supabase/config.toml`에서 활성화합니다. `supabase/.env.example`을 `supabase/.env`로 복사해 Edge 전용 `MAFIA_SERVICE_ROLE_KEY`, `MAFIA_MASTER_PASSWORD`, `MAFIA_ALLOWED_ORIGIN`을 설정합니다. 실제 값은 커밋하지 마세요.
- `MAFIA_MASTER_PASSWORD`는 현재 운영에서 쓰는 마스터 암호를 Supabase secret으로 지정합니다. 이 값과 service role key는 브라우저에 전달되지 않습니다.

프로젝트 루트(`supabase-version`)에서 순서대로 실행:

```sh
npm install
npx supabase login
npx supabase link --project-ref mtyljiedlrevttobfpqv
npx supabase config push
npx supabase db push
npx supabase secrets set --env-file supabase/.env
npx supabase functions deploy room
```

GitHub 공개 저장소의 Pages 소스를 `main` 브랜치 `/docs`로 설정하면 됩니다. 별도 빌드가 없는 정적 사이트이며 모든 자산 경로는 상대경로입니다.

## 단일 방 안내

모든 참가자가 같은 방을 사용합니다. Supabase 익명 계정은 브라우저 저장소에 유지되며, 저장공간을 지우면 같은 참가자로 복구할 수 없습니다. 1명의 진행자와 플레이어 3명 이상이 필요합니다. 현재 PHP 사이트와 저장 데이터에는 연결하지 않습니다.
