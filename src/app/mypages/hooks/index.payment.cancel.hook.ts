'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

interface CancelSubscriptionParams {
  transactionKey: string;
}

interface CancelSubscriptionHookResult {
  isLoading: boolean;
  error: string | null;
  handleCancelSubscription: (params: CancelSubscriptionParams) => Promise<void>;
}

export const useCancelSubscription = (): CancelSubscriptionHookResult => {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCancelSubscription = async ({ transactionKey }: CancelSubscriptionParams) => {
    try {
      setIsLoading(true);
      setError(null);

      // 1. 구독 취소 API 호출
      const response = await fetch('/api/payments/cancel', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          transactionKey,
        }),
      });

      const result = await response.json();

      // 2. 구독 취소 실패 처리
      if (!result.success) {
        throw new Error(result.error || '구독 취소에 실패했습니다.');
      }

      // 3. 구독 취소 성공 처리
      alert('구독이 취소되었습니다.');
      router.push('/magazines');
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : '알 수 없는 오류가 발생했습니다.';
      setError(errorMessage);
      alert(errorMessage);
      throw err; // 에러를 다시 던져서 호출하는 곳에서도 처리 가능하도록 함
    } finally {
      setIsLoading(false);
    }
  };

  return {
    isLoading,
    error,
    handleCancelSubscription,
  };
};
