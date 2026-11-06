'use client';

import { Suspense } from 'react';
import { InventoryView } from '@/components/InventoryView';

export default function InventoryPage() {
  return (
    <Suspense>
      <InventoryView />
    </Suspense>
  );
}
