import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase/client';
import axios from 'axios';

// 포트원 V2 API 설정
const PORTONE_API_URL = 'https://api.portone.io';
const PORTONE_API_SECRET = process.env.PORTONE_V2_API_SECRET || '';

// 타입 정의
interface PaymentWebhookRequest {
  payment_id: string;
  status: 'Paid' | 'Cancelled';
}

interface PortOnePayment {
  id: string;
  status: string;
  orderName: string;
  amount: {
    total: number;
    taxFree?: number;
    vat?: number;
  };
  currency: string;
  customer?: {
    id?: string;
    name?: string;
    email?: string;
  };
  billingKey?: string;
  paidAt?: string;
}

interface ChecklistItem {
  step: string;
  status: 'success' | 'failed' | 'skipped';
  message: string;
  data?: Record<string, unknown>;
}

// 유틸리티 함수: 한국 시간(KST)을 UTC로 변환
function kstToUtc(date: Date): Date {
  // KST는 UTC+9
  const utcDate = new Date(date.getTime() - 9 * 60 * 60 * 1000);
  return utcDate;
}

// 유틸리티 함수: 날짜 계산
function calculateDates(startDate: Date) {
  // end_at: start_at + 30일
  const endAt = new Date(startDate);
  endAt.setDate(endAt.getDate() + 30);

  // end_grace_at: end_at + 1일 밤 11:59:59 (KST) → UTC
  const endGraceAtKst = new Date(endAt);
  endGraceAtKst.setDate(endGraceAtKst.getDate() + 1);
  endGraceAtKst.setHours(23, 59, 59, 999);
  const endGraceAt = kstToUtc(endGraceAtKst);

  // next_schedule_at: end_at + 1일 오전 10시~11시 사이 랜덤 (KST) → UTC
  const nextScheduleAtKst = new Date(endAt);
  nextScheduleAtKst.setDate(nextScheduleAtKst.getDate() + 1);
  const randomHour = 10;
  const randomMinute = Math.floor(Math.random() * 60); // 0~59분 랜덤
  nextScheduleAtKst.setHours(randomHour, randomMinute, 0, 0);
  const nextScheduleAt = kstToUtc(nextScheduleAtKst);

  return { endAt, endGraceAt, nextScheduleAt };
}

// UUID 생성 함수
function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// 포트원 API: 결제 정보 조회
async function getPaymentInfo(paymentId: string): Promise<PortOnePayment> {
  const response = await fetch(`${PORTONE_API_URL}/payments/${paymentId}`, {
    method: 'GET',
    headers: {
      'Authorization': `PortOne ${PORTONE_API_SECRET}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`결제 정보 조회 실패: ${response.status} - ${errorText}`);
  }

  return await response.json();
}

interface SchedulePaymentResponse {
  id: string;
  paymentId: string;
  timeToPay: string;
}

// 포트원 API: 결제 예약
async function schedulePayment(
  scheduleId: string,
  billingKey: string,
  orderName: string,
  customerId: string,
  amount: number,
  timeToPay: Date
): Promise<SchedulePaymentResponse> {
  const response = await fetch(`${PORTONE_API_URL}/payments/${scheduleId}/schedule`, {
    method: 'POST',
    headers: {
      'Authorization': `PortOne ${PORTONE_API_SECRET}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      payment: {
        billingKey,
        orderName,
        customer: {
          id: customerId
        },
        amount: {
          total: amount
        },
        currency: 'KRW'
      },
      timeToPay: timeToPay.toISOString()
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`결제 예약 실패: ${response.status} - ${errorText}`);
  }

  return await response.json();
}

interface PaymentScheduleItem {
  id: string;
  paymentId: string;
  billingKey: string;
  timeToPay: string;
}

interface PaymentSchedulesResponse {
  items: PaymentScheduleItem[];
}

// 포트원 API: 예약된 결제정보 조회 (GET with body using axios)
async function getPaymentSchedules(billingKey: string, from: Date, until: Date): Promise<PaymentSchedulesResponse> {
  try {
    const response = await axios.get(`${PORTONE_API_URL}/payment-schedules`, {
      headers: {
        'Authorization': `PortOne ${PORTONE_API_SECRET}`,
        'Content-Type': 'application/json',
      },
      data: {
        filter: {
          billingKey,
          from: from.toISOString(),
          until: until.toISOString()
        }
      }
    });

    return response.data;
  } catch (error) {
    const message = error instanceof Error ? error.message : '알 수 없는 오류';
    throw new Error(`예약된 결제정보 조회 실패: ${message}`);
  }
}

interface CancelSchedulesResponse {
  canceledScheduleIds: string[];
}

// 포트원 API: 예약 취소
async function cancelPaymentSchedules(scheduleIds: string[]): Promise<CancelSchedulesResponse> {
  const response = await fetch(`${PORTONE_API_URL}/payment-schedules`, {
    method: 'DELETE',
    headers: {
      'Authorization': `PortOne ${PORTONE_API_SECRET}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      scheduleIds
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`예약 취소 실패: ${response.status} - ${errorText}`);
  }

  return await response.json();
}

// POST /api/portone
export async function POST(request: NextRequest) {
  const checklist: ChecklistItem[] = [];

  try {
    // 1. 요청 데이터 파싱
    const body: PaymentWebhookRequest = await request.json();
    checklist.push({
      step: '1. 요청 데이터 파싱',
      status: 'success',
      message: '요청 데이터를 성공적으로 파싱했습니다.',
      data: body as unknown as Record<string, unknown>
    });

    const { payment_id, status } = body;

    if (!payment_id || !status) {
      checklist.push({
        step: '2. 요청 데이터 검증',
        status: 'failed',
        message: 'payment_id와 status는 필수 항목입니다.'
      });
      return NextResponse.json({ success: false, checklist }, { status: 400 });
    }

    checklist.push({
      step: '2. 요청 데이터 검증',
      status: 'success',
      message: '요청 데이터 검증 완료'
    });

    // Paid 상태 처리
    if (status === 'Paid') {
      // 2-1. 결제 정보 조회
      let paymentInfo: PortOnePayment;
      try {
        paymentInfo = await getPaymentInfo(payment_id);
        checklist.push({
          step: '3. 결제 정보 조회',
          status: 'success',
          message: `결제 정보를 성공적으로 조회했습니다. (paymentId: ${paymentInfo.id})`,
          data: {
            paymentId: paymentInfo.id,
            orderName: paymentInfo.orderName,
            amount: paymentInfo.amount.total,
            billingKey: paymentInfo.billingKey
          }
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : '알 수 없는 오류';
        checklist.push({
          step: '3. 결제 정보 조회',
          status: 'failed',
          message: `결제 정보 조회 실패: ${message}`
        });
        return NextResponse.json({ success: false, checklist }, { status: 500 });
      }

      // 2-2. Supabase에 payment 데이터 저장
      const startAt = new Date();
      const { endAt, endGraceAt, nextScheduleAt } = calculateDates(startAt);
      const nextScheduleId = generateUUID();

      const paymentData = {
        transaction_key: paymentInfo.id,
        amount: paymentInfo.amount.total,
        status: 'Paid',
        start_at: startAt.toISOString(),
        end_at: endAt.toISOString(),
        end_grace_at: endGraceAt.toISOString(),
        next_schedule_at: nextScheduleAt.toISOString(),
        next_schedule_id: nextScheduleId,
      };

      try {
        const { error } = await supabase
          .from('payment')
          .insert([paymentData])
          .select();

        if (error) {
          throw new Error(error.message);
        }

        checklist.push({
          step: '4. Supabase payment 테이블 저장',
          status: 'success',
          message: 'payment 데이터를 성공적으로 저장했습니다.',
          data: paymentData
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : '알 수 없는 오류';
        checklist.push({
          step: '4. Supabase payment 테이블 저장',
          status: 'failed',
          message: `Supabase 저장 실패: ${message}`
        });
        return NextResponse.json({ success: false, checklist }, { status: 500 });
      }

      // 2-3. 다음달 구독 예약
      if (!paymentInfo.billingKey) {
        checklist.push({
          step: '5. 다음달 구독 예약',
          status: 'skipped',
          message: 'billingKey가 없어 구독 예약을 건너뜁니다.'
        });
      } else {
        try {
          await schedulePayment(
            nextScheduleId,
            paymentInfo.billingKey,
            paymentInfo.orderName,
            paymentInfo.customer?.id || 'unknown',
            paymentInfo.amount.total,
            nextScheduleAt
          );

          checklist.push({
            step: '5. 다음달 구독 예약',
            status: 'success',
            message: '다음달 구독을 성공적으로 예약했습니다.',
            data: {
              scheduleId: nextScheduleId,
              timeToPay: nextScheduleAt.toISOString()
            }
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : '알 수 없는 오류';
          checklist.push({
            step: '5. 다음달 구독 예약',
            status: 'failed',
            message: `구독 예약 실패: ${message}`
          });
          // 구독 예약 실패는 전체 프로세스 실패로 간주
          return NextResponse.json({ success: false, checklist }, { status: 500 });
        }
      }

      return NextResponse.json({ success: true, checklist }, { status: 200 });
    }

    // Cancelled 상태 처리
    if (status === 'Cancelled') {
      // 3-1-1. Supabase에서 기존 결제 정보 조회
      interface OriginalPayment {
        transaction_key: string;
        amount: number;
        start_at: string;
        end_at: string;
        end_grace_at: string;
        next_schedule_at: string;
        next_schedule_id: string;
      }
      
      let originalPayment: OriginalPayment;
      try {
        const { data, error } = await supabase
          .from('payment')
          .select('*')
          .eq('transaction_key', payment_id)
          .single();

        if (error || !data) {
          throw new Error(error?.message || '결제 정보를 찾을 수 없습니다.');
        }

        originalPayment = data;
        checklist.push({
          step: '3. Supabase에서 기존 결제 정보 조회',
          status: 'success',
          message: `기존 결제 정보를 조회했습니다. (transaction_key: ${originalPayment.transaction_key})`,
          data: originalPayment as unknown as Record<string, unknown>
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : '알 수 없는 오류';
        checklist.push({
          step: '3. Supabase에서 기존 결제 정보 조회',
          status: 'failed',
          message: `결제 정보 조회 실패: ${message}`
        });
        return NextResponse.json({ success: false, checklist }, { status: 500 });
      }

      // 3-1-2. Supabase에 취소 정보 등록
      const cancelData = {
        transaction_key: originalPayment.transaction_key,
        amount: -originalPayment.amount, // 음수로 저장
        status: 'Cancel',
        start_at: originalPayment.start_at,
        end_at: originalPayment.end_at,
        end_grace_at: originalPayment.end_grace_at,
        next_schedule_at: originalPayment.next_schedule_at,
        next_schedule_id: originalPayment.next_schedule_id,
      };

      try {
        const { error } = await supabase
          .from('payment')
          .insert([cancelData]);

        if (error) {
          throw new Error(error.message);
        }

        checklist.push({
          step: '4. Supabase에 취소 정보 등록',
          status: 'success',
          message: '취소 정보를 성공적으로 등록했습니다.',
          data: cancelData
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : '알 수 없는 오류';
        checklist.push({
          step: '4. Supabase에 취소 정보 등록',
          status: 'failed',
          message: `취소 정보 등록 실패: ${message}`
        });
        return NextResponse.json({ success: false, checklist }, { status: 500 });
      }

      // 3-2-1. 포트원에서 결제정보 조회
      let paymentInfo: PortOnePayment;
      try {
        paymentInfo = await getPaymentInfo(payment_id);
        checklist.push({
          step: '5. 포트원 결제정보 조회',
          status: 'success',
          message: `결제 정보를 조회했습니다. (paymentId: ${paymentInfo.id})`,
          data: {
            paymentId: paymentInfo.id,
            billingKey: paymentInfo.billingKey
          }
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : '알 수 없는 오류';
        checklist.push({
          step: '5. 포트원 결제정보 조회',
          status: 'failed',
          message: `결제 정보 조회 실패: ${message}`
        });
        return NextResponse.json({ success: false, checklist }, { status: 500 });
      }

      // 3-2-2. 예약된 결제정보 조회
      if (!paymentInfo.billingKey) {
        checklist.push({
          step: '6. 예약된 결제정보 조회',
          status: 'skipped',
          message: 'billingKey가 없어 예약 취소를 건너뜁니다.'
        });
        return NextResponse.json({ success: true, checklist }, { status: 200 });
      }

      let scheduleItems: PaymentScheduleItem[];
      try {
        // next_schedule_at 기준으로 1일 전후 조회
        const nextScheduleAt = new Date(originalPayment.next_schedule_at);
        const from = new Date(nextScheduleAt);
        from.setDate(from.getDate() - 1);
        const until = new Date(nextScheduleAt);
        until.setDate(until.getDate() + 1);

        const scheduleResponse = await getPaymentSchedules(
          paymentInfo.billingKey,
          from,
          until
        );

        scheduleItems = scheduleResponse.items || [];
        checklist.push({
          step: '6. 예약된 결제정보 조회',
          status: 'success',
          message: `${scheduleItems.length}개의 예약 정보를 조회했습니다.`,
          data: {
            count: scheduleItems.length,
            from: from.toISOString(),
            until: until.toISOString()
          }
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : '알 수 없는 오류';
        checklist.push({
          step: '6. 예약된 결제정보 조회',
          status: 'failed',
          message: `예약 정보 조회 실패: ${message}`
        });
        return NextResponse.json({ success: false, checklist }, { status: 500 });
      }

      // 3-2-3. next_schedule_id와 일치하는 항목 추출
      const targetSchedule = scheduleItems.find(
        item => item.paymentId === originalPayment.next_schedule_id
      );

      if (!targetSchedule) {
        checklist.push({
          step: '7. next_schedule_id와 일치하는 예약 추출',
          status: 'failed',
          message: `일치하는 예약을 찾을 수 없습니다. (next_schedule_id: ${originalPayment.next_schedule_id})`
        });
        return NextResponse.json({ success: false, checklist }, { status: 404 });
      }

      checklist.push({
        step: '7. next_schedule_id와 일치하는 예약 추출',
        status: 'success',
        message: '일치하는 예약을 찾았습니다.',
        data: {
          scheduleId: targetSchedule.id,
          paymentId: targetSchedule.paymentId
        }
      });

      // 3-2-4. 예약 취소
      try {
        await cancelPaymentSchedules([targetSchedule.id]);
        checklist.push({
          step: '8. 포트원 예약 취소',
          status: 'success',
          message: '예약을 성공적으로 취소했습니다.',
          data: {
            canceledScheduleId: targetSchedule.id
          }
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : '알 수 없는 오류';
        checklist.push({
          step: '8. 포트원 예약 취소',
          status: 'failed',
          message: `예약 취소 실패: ${message}`
        });
        return NextResponse.json({ success: false, checklist }, { status: 500 });
      }

      return NextResponse.json({ success: true, checklist }, { status: 200 });
    }

    return NextResponse.json({ success: false, checklist }, { status: 400 });

  } catch (error) {
    const message = error instanceof Error ? error.message : '알 수 없는 오류';
    checklist.push({
      step: '예외 처리',
      status: 'failed',
      message: `예기치 않은 오류: ${message}`
    });
    return NextResponse.json({ success: false, checklist }, { status: 500 });
  }
}


