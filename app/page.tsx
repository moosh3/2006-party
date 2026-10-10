'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import MacAudienceGate from '@/components/2006/MacAudienceGate';
import { getViewerData } from '@/lib/viewer';

export default function LandingPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace(getViewerData() ? '/event' : '/login');
  }, [router]);

  return <MacAudienceGate mode="connecting" />;
}
