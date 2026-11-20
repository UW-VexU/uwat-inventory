'use client';

import type { ReactNode } from 'react';
import { ArrivalToasts } from '@/components/ArrivalToasts';
import { Shell } from '@/components/Shell';
import { ToastProvider } from '@/components/Toast';
import { InventoryProvider } from '@/lib/inventory';

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <InventoryProvider>
      <ToastProvider>
        <ArrivalToasts />
        <Shell>{children}</Shell>
      </ToastProvider>
    </InventoryProvider>
  );
}
