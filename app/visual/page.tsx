// @ts-nocheck
'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

/**
 * /visual 已迁移到 /orchestration。
 * 静态导出无法做服务端 301，这里用客户端跳转保底，同时留一个链接防止 JS 未执行。
 */
export default function VisualRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/orchestration');
  }, [router]);

  return (
    <main style={{ padding: 24 }}>
      <p>画布页已迁移，正在跳转到 <a href="/orchestration">/orchestration</a>…</p>
    </main>
  );
}
