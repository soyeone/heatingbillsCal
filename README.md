# 🔥 온기 · 우리집 난방비 대시보드

지역난방(열량계) 계량기 값을 매일 기록하면, 월별 단가를 곱해 **예상 난방비**를 계산하고
**수원시 일 최고/최저 기온**과 함께 사용량 추이를 보여주는 대시보드입니다.

- 정적 사이트(HTML/CSS/JS): GitHub Pages로 배포
- 데이터 저장: Supabase (로그인 + RLS로 본인 데이터만 접근 가능)
- 기온: [Open-Meteo](https://open-meteo.com/) (API 키 없이 사용, 최근 데이터는 forecast API, 오래된 데이터는 archive API)

## 주요 기능

| 기능 | 설명 |
| --- | --- |
| 검침 입력 | 날짜와 계량기 값 입력 → 직전 검침과 비교한 사용량과 요금 미리보기 |
| 월별 단가 | 달마다 `1L당 단가`와 기본요금(선택)을 입력. 입력 안 한 달은 직전 달 단가로 추정 |
| KPI | 이번 달 사용량, 지금까지 난방비, 월말 예상 난방비, 일평균 사용량, 평균기온, 전월 같은 기간 대비 증감 |
| 일별 차트 | 사용량 막대 + 수원 최고/최저 기온 선 |
| 월별 추이 | 최근 12개월 난방비와 사용량 |
| 기온 vs 사용량 | 최근 3개월 산점도, 추세선, 상관계수 |
| CSV | 가져오기(`날짜,계량기값[,메모]`), 내보내기(엑셀 호환) |

> 검침을 하루 이상 거르면 다음 검침 때 늘어난 사용량을 그 기간 동안 하루씩 똑같이 나눠 계산합니다.

## 설정 방법

### 1. Supabase
1. [supabase.com](https://supabase.com)에서 무료 프로젝트를 만듭니다.
2. **SQL Editor**에서 [`supabase/schema.sql`](supabase/schema.sql) 내용을 붙여넣고 실행합니다.
3. URL과 키를 복사합니다.
   - **Project URL**: **Project Settings → Data API** 상단 (또는 상단 `Connect` 버튼, 형식: `https://<project-id>.supabase.co`)
   - **키**: **Project Settings → API Keys**의 `sb_publishable_...` 키, 또는 *Legacy API Keys* 탭의 `anon` `public` 키
   ⚠️ `service_role` / `sb_secret_...` 키는 절대 사용하지 마세요.
4. (권장) 대시보드에서 내 계정으로 가입한 뒤, **Authentication → Sign In / Providers**에서 *Allow new users to sign up*을 끄면 다른 사람이 가입할 수 없습니다.
   이메일 인증을 생략하려면 *Confirm email*을 끄세요.

### 2. GitHub Pages 배포
1. 저장소에서 **Settings → Secrets and variables → Actions**로 들어가 아래 두 Secret을 추가합니다.
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
2. **Settings → Pages → Build and deployment → Source**를 **GitHub Actions**로 바꿉니다.
3. `main` 브랜치에 push하면 자동으로 배포됩니다.
   배포 주소: `https://soyeone.github.io/heatingbillsCal/`
4. Supabase **Authentication → URL Configuration**의 *Site URL*에 위 배포 주소를 넣습니다.

### 3. 로컬에서 실행
```powershell
copy js\config.example.js js\config.js   # 값 채우기
npx -y serve .                            # 또는 python -m http.server
```
`config.js` 없이 열면 **데모 모드**(샘플 데이터 + 실제 수원 기온)로 미리 볼 수 있습니다.

## 기존 스프레드시트 데이터 옮기기
Google 스프레드시트에서 `날짜, 계량기값` 두 열만 남긴 뒤 **파일 → 다운로드 → CSV**로 저장하고,
대시보드의 **CSV 가져오기**를 누르면 됩니다. 날짜는 `2025-11-01`, `2025.11.01`, `2025/11/01` 형식을 모두 인식합니다.
월별 단가는 각 달로 이동해 입력해 주세요.

## 위치 및 단위 변경
`js/config.js`(배포 시에는 `.github/workflows/deploy.yml`)의 `LOCATION`과 `UNIT` 값을 바꾸면 됩니다.