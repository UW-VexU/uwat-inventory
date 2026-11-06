'use client';

import { boxQrPayload, type BoxSummary } from '@uwat/shared';
import Link from 'next/link';
import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { Icon } from '@/components/Icon';
import { useInventory } from '@/lib/inventory';

function BoxLabel({ box }: { box: BoxSummary }) {
  const [qr, setQr] = useState('');

  useEffect(() => {
    let live = true;
    void QRCode.toString(boxQrPayload(box.code), { type: 'svg', margin: 0, errorCorrectionLevel: 'M' }).then((svg) => {
      if (live) setQr(svg);
    });
    return () => {
      live = false;
    };
  }, [box.code]);

  return (
    <article className="print-label">
      <div className="print-label-text">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/uwat-logo-black.svg" alt="UWAT" width={100} height={23} />
        <strong>{box.code}</strong>
        <span>{box.label ?? ' '}</span>
      </div>
      <div className="print-label-qr" dangerouslySetInnerHTML={{ __html: qr }} />
    </article>
  );
}

export default function BoxLabelsPage() {
  const { snapshot } = useInventory();
  const boxes = [...(snapshot?.boxes ?? [])].sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));

  return (
    <div className="page labels-page">
      <header className="page-head no-print">
        <div>
          <h1>Box labels</h1>
          <p className="muted">Print these, then stick each one on its box. The phone app scans the QR code.</p>
        </div>
        <div className="page-actions">
          <Link className="button" href="/boxes">
            Back to boxes
          </Link>
          <button type="button" className="button button-primary" disabled={boxes.length === 0} onClick={() => window.print()}>
            <Icon name="print" />
            Print
          </button>
        </div>
      </header>
      <section className="print-sheet">
        {boxes.map((box) => (
          <BoxLabel key={box.id} box={box} />
        ))}
      </section>
    </div>
  );
}
