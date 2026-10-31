// 로컬 개발용: 이 파일을 js/config.js 로 복사한 뒤 값을 채우세요.
// GitHub Pages 배포 시에는 GitHub Actions 가 저장소 Secrets 로 js/config.js 를 자동 생성합니다.
// anon(public) 키는 브라우저에 노출되어도 되는 키이며, 데이터 보호는 RLS 정책이 담당합니다.
// 절대 service_role 키를 넣지 마세요.
window.APP_CONFIG = {
  SUPABASE_URL: 'https://YOUR-PROJECT.supabase.co',
  SUPABASE_ANON_KEY: 'YOUR-ANON-KEY',
  // 기온 조회 위치 (기본: 경기도 수원시)
  LOCATION: { name: '수원시', latitude: 37.2636, longitude: 127.0286 },
  // 계량 단위 표시
  UNIT: 'L',
};
