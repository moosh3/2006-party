import { notFound } from 'next/navigation';
import CountdownPreview from '@/components/CountdownPreview';
export default function Page() {
  if (process.env.NODE_ENV === 'production') notFound();
  return <CountdownPreview />;
}
