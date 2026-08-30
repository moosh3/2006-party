import type { ReactNode } from 'react';
import './aim.css';

type AimWindowProps = {
  title: string;
  children: ReactNode;
  className?: string;
  menuItems?: string[];
  status?: ReactNode;
  live?: boolean;
};

export default function AimWindow({
  title,
  children,
  className = '',
  menuItems = [],
  status,
  live = false,
}: AimWindowProps) {
  return (
    <section className={`aim-window ${className}`.trim()}>
      <div className="aim-titlebar">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="aim-title-icon" src="/2006/art.png" alt="" />
        <span className="aim-title-text">{title}</span>
        <span className="aim-window-buttons" aria-hidden="true">
          <span className="aim-window-button">_</span>
          <span className="aim-window-button">□</span>
          <span className="aim-window-button aim-window-close">×</span>
        </span>
      </div>

      {menuItems.length > 0 && (
        <div className="aim-menubar" aria-hidden="true">
          {menuItems.map((item) => (
            <span key={item}>{item}</span>
          ))}
        </div>
      )}

      {children}

      {(status || live) && (
        <div className="aim-statusline">
          <span>{status}</span>
          <span>{live ? '● LIVE' : ''}</span>
        </div>
      )}
    </section>
  );
}

