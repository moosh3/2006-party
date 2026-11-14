'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import './stage-scene.css';

/** Fit the entire composition on any projector without cropping or scrollbars. */
export default function StageScene({ children }: { children: ReactNode }) {
  const host = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      setScale(Math.min(entry.contentRect.width / 1280, entry.contentRect.height / 720));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return <div ref={host} className="stage-scene"><div className="stage-scene-art" style={{ transform: `translate(-50%, -50%) scale(${scale})` }}>{children}</div></div>;
}
