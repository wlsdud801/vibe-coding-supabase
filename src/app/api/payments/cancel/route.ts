import { NextRequest, NextResponse } from 'next/server';

// PortOne V2 결제 취소 API
export async function POST(request: NextRequest) {
  try {
    // 1. 요청 데이터 파싱
    const body = await request.json();
    const { transactionKey } = body;

    // 2. 필수 필드 검증
    if (!transactionKey) {
      return NextResponse.json(
        { success: false, error: 'transactionKey가 누락되었습니다.' },
        { status: 400 }
      );
    }

    // 3. PortOne API 키 가져오기
    const portoneApiSecret = process.env.PORTONE_API_SECRET;
    
    if (!portoneApiSecret) {
      return NextResponse.json(
        { success: false, error: 'PortOne API 키가 설정되지 않았습니다.' },
        { status: 500 }
      );
    }

    // 4. PortOne에 결제 취소 요청
    const portoneResponse = await fetch(
      `https://api.portone.io/payments/${encodeURIComponent(transactionKey)}/cancel`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `PortOne ${portoneApiSecret}`,
        },
        body: JSON.stringify({
          reason: '취소 사유 없음',
        }),
      }
    );

    // 5. PortOne 응답 처리
    const portoneData = await portoneResponse.json();

    if (!portoneResponse.ok) {
      console.error('PortOne 결제 취소 실패:', portoneData);
      return NextResponse.json(
        { 
          success: false, 
          error: portoneData.message || '결제 취소 처리 중 오류가 발생했습니다.',
          details: portoneData,
        },
        { status: portoneResponse.status }
      );
    }

    // 6. 성공 응답 반환 (DB에 저장하지 않음)
    return NextResponse.json({
      success: true,
    });

  } catch (error) {
    console.error('결제 취소 API 오류:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다.',
      },
      { status: 500 }
    );
  }
}
