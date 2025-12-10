'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

// PortOne V2 SDK 타입 정의
declare global {
  interface Window {
    PortOne?: {
      requestIssueBillingKey: (options: {
        storeId: string;
        channelKey: string;
        billingKeyMethod: string;
        customer?: {
          id: string;
          name?: {
            full?: string;
          };
        };
        customData?: Record<string, unknown>;
      }) => Promise<{
        code?: string;
        message?: string;
        billingKey?: string;
      }>;
    };
  }
}

interface PaymentHookResult {
  isLoading: boolean;
  error: string | null;
  handleSubscribe: () => Promise<void>;
}

export const usePayment = (): PaymentHookResult => {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubscribe = async () => {
    try {
      setIsLoading(true);
      setError(null);

      // 1. PortOne SDK 로드 확인
      if (!window.PortOne) {
        throw new Error('PortOne SDK가 로드되지 않았습니다.');
      }

      // 2. 빌링키 발급 요청
      const billingKeyResponse = await window.PortOne.requestIssueBillingKey({
        storeId: process.env.NEXT_PUBLIC_PORTONE_STORE_ID || '',
        channelKey: process.env.NEXT_PUBLIC_PORTONE_CHANNEL_KEY || '',
        billingKeyMethod: 'CARD',
        customer: {
          id: `customer_${Date.now()}`,
          name: {
            full: '테스트 고객',
          },
        },
        customData: {
          subscription: 'monthly',
        },
      });

      // 3. 빌링키 발급 실패 처리
      if (billingKeyResponse.code) {
        throw new Error(billingKeyResponse.message || '빌링키 발급에 실패했습니다.');
      }

      if (!billingKeyResponse.billingKey) {
        throw new Error('빌링키가 발급되지 않았습니다.');
      }

      // 4. 빌링키로 결제 API 요청
      const paymentResponse = await fetch('/api/payments', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          billingKey: billingKeyResponse.billingKey,
          orderName: 'IT 매거진 월간 구독',
          amount: 9900,
          customer: {
            id: `customer_${Date.now()}`,
          },
        }),
      });

      const paymentResult = await paymentResponse.json();

      // 5. 결제 실패 처리
      if (!paymentResult.success) {
        throw new Error(paymentResult.error || '결제에 실패했습니다.');
      }

      // 6. 결제 성공 처리
      alert('구독에 성공하였습니다.');
      router.push('/magazines');
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : '알 수 없는 오류가 발생했습니다.';
      setError(errorMessage);
      alert(errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  return {
    isLoading,
    error,
    handleSubscribe,
  };
};

