# 나라장터 입찰 알림

나라장터 용역 공고 중 키워드에 맞는 건을 모아 보여주고, 담당자 휴대폰(ntfy)으로 알림을 보내는 사이트입니다.

## 구성
- 사이트: Next.js (Vercel 배포)
- 저장소: Supabase (규칙·공고·수집 기록)
- 자동 수집: cron-job.org 가 10분마다 `/api/collect` 호출
- 알림: ntfy

## 설치 순서
1. **API 키**: data.go.kr 에서 `조달청_나라장터 입찰공고정보서비스` 활용신청 → 일반 인증키(Decoding) 복사
2. **Supabase**: 새 프로젝트 → SQL Editor 에 `supabase/schema.sql` 붙여넣고 Run → Project Settings > API 에서 URL, service_role(secret) 키 복사
3. **GitHub**: 이 폴더를 새 저장소로 올리기 (GitHub Desktop)
4. **Vercel**: 저장소 Import → Environment Variables 에 `.env.example` 항목 입력 → Deploy
5. **자동 수집**: cron-job.org 가입 → 새 작업
   - URL: `https://g2b-sand.vercel.app/api/collect?key=CRON_SECRET값`
   - 실행 간격: 10분
6. **구독**: 사이트 > 알림 규칙에서 채널 이름 확인 → 담당자가 ntfy 앱에서 그 이름으로 구독 → 테스트 알림 보내기

## 환경변수
| 이름 | 설명 |
|---|---|
| G2B_API_KEY | 공공데이터포털 인증키(Decoding) |
| G2B_API_URL | 요청주소. 활용신청 화면과 다를 때만 수정 |
| SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY | Supabase 접속 정보 (외부 노출 금지) |
| CRON_SECRET | 자동 수집 호출용 비밀값 |
| SITE_URL | 알림에 '알림판' 버튼을 붙일 사이트 주소 (선택) |
| LOOKBACK_HOURS | 한 번에 거슬러 조회할 시간, 기본 6 (선택) |
| NTFY_SERVER / NTFY_TOKEN | 자체 ntfy 서버나 유료 예약 토픽 사용 시 (선택) |
