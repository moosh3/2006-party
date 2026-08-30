'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import AimWindow from '@/components/aim/AimWindow';
import { getViewerData } from '@/lib/viewer';

export default function LandingPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace(getViewerData() ? '/event' : '/login');
  }, [router]);

  return (
    <div className="aim-desktop show-loading-screen">
      <AimWindow title="2006 — Starting AIM" status="Please wait">
        <div className="show-loading-message">Connecting…</div>
      </AimWindow>
    </div>
  );
}
