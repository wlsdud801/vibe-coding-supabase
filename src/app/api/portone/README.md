# 포트원 V2 구독 결제 API

## 개요
포트원 V2를 연동하여 구독 결제 웹훅을 처리하는 API 엔드포인트입니다.

## API 경로
- **경로**: `/api/portone`
- **메서드**: `POST`

## 요청 형식

### Request Body
```json
{
  "payment_id": "string",
  "status": "Paid" | "Cancelled"
}
```

### Response
```json
{
  "success": boolean,
  "checklist": [
    {
      "step": "string",
      "status": "success" | "failed" | "skipped",
      "message": "string",
      "data": {}
    }
  ]
}
```

## 구현 기능

### 1. Paid 시나리오 (구독 결제 완료)

#### 1-1. 결제 정보 조회
- **API**: `GET https://api.portone.io/payments/{payment_id}`
- **인증**: `Authorization: PortOne {API_SECRET}`
- 포트원에서 결제 정보를 조회합니다.

#### 1-2. Supabase payment 테이블 저장
다음 정보를 `payment` 테이블에 저장합니다:
- `transaction_key`: 결제 ID (paymentId)
- `amount`: 결제 금액 (amount.total)
- `status`: "Paid"
- `start_at`: 현재 시각 (UTC)
- `end_at`: 현재 시각 + 30일
- `end_grace_at`: end_at + 1일 밤 11:59:59 (KST → UTC 변환)
- `next_schedule_at`: end_at + 1일 오전 10시~11시 사이 임의 시각 (KST → UTC 변환)
- `next_schedule_id`: 자동 생성된 UUID

#### 1-3. 다음달 구독 예약
- **API**: `POST https://api.portone.io/payments/{next_schedule_id}/schedule`
- **Body**:
  ```json
  {
    "payment": {
      "billingKey": "결제정보의 빌링키",
      "orderName": "결제정보의 주문명",
      "customer": {
        "id": "결제정보의 고객 ID"
      },
      "amount": {
        "total": 결제금액
      },
      "currency": "KRW"
    },
    "timeToPay": "next_schedule_at (ISO 8601 형식)"
  }
  ```

### 2. Cancelled 시나리오
현재는 스킵 처리되며, 향후 구현 예정입니다.

## 환경 변수 설정

다음 환경 변수를 `.env.local` 파일에 설정해야 합니다:

```env
# Supabase Configuration
NEXT_PUBLIC_SUPABASE_URL=your-supabase-url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-supabase-anon-key

# PortOne V2 Configuration
PORTONE_V2_API_SECRET=your-portone-v2-api-secret
```

## Supabase 테이블 스키마

`payment` 테이블은 다음과 같은 구조를 가져야 합니다:

```sql
CREATE TABLE payment (
  id BIGSERIAL PRIMARY KEY,
  transaction_key TEXT NOT NULL,
  amount INTEGER NOT NULL,
  status TEXT NOT NULL,
  start_at TIMESTAMPTZ NOT NULL,
  end_at TIMESTAMPTZ NOT NULL,
  end_grace_at TIMESTAMPTZ NOT NULL,
  next_schedule_at TIMESTAMPTZ NOT NULL,
  next_schedule_id UUID NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

## 체크리스트 응답 예시

### 성공 케이스
```json
{
  "success": true,
  "checklist": [
    {
      "step": "1. 요청 데이터 파싱",
      "status": "success",
      "message": "요청 데이터를 성공적으로 파싱했습니다.",
      "data": {
        "payment_id": "pay_123456",
        "status": "Paid"
      }
    },
    {
      "step": "2. 요청 데이터 검증",
      "status": "success",
      "message": "요청 데이터 검증 완료"
    },
    {
      "step": "3. 결제 정보 조회",
      "status": "success",
      "message": "결제 정보를 성공적으로 조회했습니다.",
      "data": {
        "paymentId": "pay_123456",
        "orderName": "월간 구독",
        "amount": 10000,
        "billingKey": "billing_key_123"
      }
    },
    {
      "step": "4. Supabase payment 테이블 저장",
      "status": "success",
      "message": "payment 데이터를 성공적으로 저장했습니다.",
      "data": {
        "transaction_key": "pay_123456",
        "amount": 10000,
        "status": "Paid",
        "start_at": "2024-01-01T00:00:00.000Z",
        "end_at": "2024-01-31T00:00:00.000Z",
        "end_grace_at": "2024-02-01T14:59:59.000Z",
        "next_schedule_at": "2024-02-01T01:30:00.000Z",
        "next_schedule_id": "uuid-string"
      }
    },
    {
      "step": "5. 다음달 구독 예약",
      "status": "success",
      "message": "다음달 구독을 성공적으로 예약했습니다.",
      "data": {
        "scheduleId": "uuid-string",
        "timeToPay": "2024-02-01T01:30:00.000Z"
      }
    }
  ]
}
```

## 시간대 변환 로직

### KST → UTC 변환
- 한국 시간(KST)은 UTC+9입니다.
- 예: KST 2024-01-01 23:59:59 → UTC 2024-01-01 14:59:59

### 날짜 계산
1. **end_at**: start_at + 30일
2. **end_grace_at**: end_at + 1일의 23:59:59 (KST) → UTC로 변환
3. **next_schedule_at**: end_at + 1일의 10:00~10:59 사이 임의 시각 (KST) → UTC로 변환

## 에러 처리

API는 다음과 같은 에러 상황을 처리합니다:

1. **요청 데이터 누락** (400)
   - payment_id 또는 status가 누락된 경우

2. **결제 정보 조회 실패** (500)
   - 포트원 API 호출 실패
   - 잘못된 payment_id

3. **Supabase 저장 실패** (500)
   - 데이터베이스 연결 오류
   - 스키마 불일치

4. **구독 예약 실패** (500)
   - 포트원 예약 API 호출 실패
   - billingKey 누락 (이 경우 스킵 처리)

## 테스트 방법

```bash
curl -X POST http://localhost:3000/api/portone \
  -H "Content-Type: application/json" \
  -d '{
    "payment_id": "your-payment-id",
    "status": "Paid"
  }'
```

## 참고사항

- 모든 시간은 UTC로 저장됩니다.
- 한국 시간(KST)과의 변환이 필요한 경우 자동으로 처리됩니다.
- 체크리스트 응답을 통해 각 단계의 성공/실패 여부를 확인할 수 있습니다.
- billingKey가 없는 경우 구독 예약은 스킵됩니다.


