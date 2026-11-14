'use client';
import { useEffect, useId, useState } from 'react';

/** One five-bay machine. Its camera and shutters follow the shared intro clock. */
export default function CountdownMachine({ rank, duration, remaining, receivedAt, roundTripMs = 0, paused, reducedMotion, active }: {
  rank: number; duration: number; remaining: number; receivedAt?: number; roundTripMs?: number;
  paused: boolean; reducedMotion: boolean; active: boolean;
}) {
  const id = useId().replace(/:/g, '');
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    if (!active) return;
    const origin = receivedAt ?? performance.now();
    let frame = 0;
    const update = () => {
      const age = paused ? 0 : Math.max(0, performance.now() - origin) + Math.min(2000, Math.max(0, roundTripMs)) / 2;
      setProgress(Math.min(1, Math.max(0, (duration - remaining + age / 1000) / Math.max(duration, 0.01))));
      if (!paused && !reducedMotion && duration - remaining + age / 1000 < duration) frame = requestAnimationFrame(update);
    };
    update();
    return () => cancelAnimationFrame(frame);
  }, [active, duration, remaining, receivedAt, roundTripMs, paused, reducedMotion]);
  const t = reducedMotion ? 0.8 : progress;
  const ease = (n: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, n)), 4);
  const travel = ease(t / 0.43);
  const open = ease((t - 0.34) / 0.23);
  const camera = -(5 - rank) * 1000 - (1 - travel) * 760;
  const gear = t * 150;
  const landing = ease(t / 0.55);
  const impact = Math.max(0, 1 - Math.abs(t - 0.57) / 0.035);
  const tilt = (1 - landing) * -5;
  const zoom = 1 + (1 - landing) * 0.16;
  return <svg className="countdown-machine" viewBox="0 0 1000 600" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
    <defs>
      <linearGradient id={`${id}-chrome`} x2="0.1" y2="1"><stop stopColor="#faf8ef"/><stop offset=".2" stopColor="#b7c5db"/><stop offset=".43" stopColor="#f5f4ed"/><stop offset=".46" stopColor="#eef1fc"/><stop offset=".48" stopColor="#354776"/><stop offset=".7" stopColor="#b1bedb"/><stop offset=".9" stopColor="#f6f2fa"/><stop offset="1" stopColor="#7281a5"/></linearGradient>
      <radialGradient id={`${id}-lamp`}><stop stopColor="#b9ff43" stopOpacity=".75"/><stop offset=".4" stopColor="#ef4ba6" stopOpacity=".25"/><stop offset="1" stopColor="#182344" stopOpacity="0"/></radialGradient>
      <pattern id={`${id}-hazard`} width="38" height="38" patternUnits="userSpaceOnUse" patternTransform="rotate(35)"><rect width="38" height="38" fill="#172440"/><rect width="17" height="38" fill="#adff39"/></pattern>
      <filter id={`${id}-wear`} x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".45" numOctaves="3" seed="6"/><feColorMatrix type="saturate" values="0"/></filter>
      <linearGradient id={`${id}-steel`} x2=".3" y2="1"><stop stopColor="#e6e8ee"/><stop offset=".15" stopColor="#8194bb"/><stop offset=".5" stopColor="#c3cad9"/><stop offset="1" stopColor="#354878"/></linearGradient>
      <pattern id={`${id}-grid`} width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0H0V40" fill="none" stroke="#b1a281" strokeOpacity=".14"/></pattern>
      <pattern id={`${id}-teeth`} width="28" height="20" patternUnits="userSpaceOnUse"><path d="M0 18V5H14V18" fill="none" stroke="#abae9f" strokeWidth="4"/></pattern>
      <clipPath id={`${id}-window`}><rect x="100" y="65" width="800" height="470" rx="8"/></clipPath>
    </defs>
    <rect width="1000" height="600" fill="#13182c"/>
    <g transform={`translate(500 300) rotate(${tilt}) scale(${zoom}) translate(-500 -300)`}>
    <rect width="1000" height="600" fill={`url(#${id}-steel)`}/>
    <image href="/2006/bg.jpg" width="1000" height="600" preserveAspectRatio="xMidYMid slice" opacity=".7"/>
    <rect width="1000" height="600" fill="#182344" opacity=".25"/>
    <path d="M0 0H1000V23H0zM0 577H1000V600H0z" fill="#213c91"/>
    <rect x="12" y="90" width="54" height="420" fill={`url(#${id}-hazard)`}/>
    <rect x="934" y="90" width="54" height="420" fill={`url(#${id}-hazard)`}/>
    <g clipPath={`url(#${id}-window)`}>
      <g transform={`translate(${camera} 0)`}>
        {[5,4,3,2,1].map((number, index) => <g key={number} transform={`translate(${index * 1000} 0)`}>
          <rect width="1000" height="600" fill="#18213b"/>
          <image href="/2006/bg.jpg" width="1000" height="600" preserveAspectRatio="xMidYMid slice" opacity=".3"/>
          <rect width="1000" height="600" fill={`url(#${id}-grid)`}/>
          <ellipse cx="500" cy="300" rx="470" ry="360" fill={`url(#${id}-lamp)`}/>
          <g transform={`rotate(${gear} 500 300)`}>
            <circle cx="500" cy="300" r="274" fill="none" stroke="#182440" strokeWidth="54"/>
            <circle cx="500" cy="300" r="274" fill="none" stroke="#e3e7f2" strokeWidth="40" strokeDasharray="12 14"/>
            <circle cx="500" cy="300" r="246" fill="none" stroke="#ed67ad" strokeWidth="5"/>
            {Array.from({length: 12}, (_, i) => <path key={i} d="M500 72L545 104 531 150 505 133z" fill={i % 3 === 0 ? '#ed53aa' : '#95b2e2'} stroke="#ecedf7" strokeWidth="1" transform={`rotate(${i * 30} 500 300)`}/>)}
          </g>
          <circle cx="500" cy="300" r="198" fill="#111a31" stroke="#b6ff42" strokeWidth="3"/>
          <circle cx="500" cy="300" r="184" fill="none" stroke="#5c719f" strokeWidth="1" strokeDasharray="3 9"/>
          <path d="M95 170H220M780 430H905" stroke="#ed4fa8" strokeWidth="14"/>
          {/* Stacked edges give the numeral real visual mass, not a neon outline. */}
          {Array.from({length: 12}, (_, i) => <text key={i} x={513-i*2} y={449-i*2} textAnchor="middle" fontFamily="Impact, Arial Black, sans-serif" fontSize="340" fill={i % 2 ? '#213267' : '#4164b6'} stroke="#18234b" strokeWidth="5">{number}</text>)}
          <text x="487" y="421" textAnchor="middle" fontFamily="Impact, Arial Black, sans-serif" fontSize="340" fill={`url(#${id}-chrome)`} stroke="#faf6ec" strokeWidth="9" paintOrder="stroke">{number}</text>
          <path d="M150 155l25-25M825 470l25-25" stroke="#b5ff45" strokeWidth="3"/>

        </g>)}
      </g>
      {/* Opaque opposing shutters conceal neighboring bays during travel. */}
      <g transform={`translate(${-open * 450} 0)`}>
        <rect x="90" y="50" width="412" height="500" fill={`url(#${id}-steel)`} stroke="#e5e9f4" strokeWidth="5"/>
        <path d="M470 60V540M450 60V540" stroke="#b5ff45" strokeWidth="7"/>
        <path d="M160 100L400 300 160 500" fill="none" stroke="#3557a2" strokeWidth="40"/>
      </g>
      <g transform={`translate(${open * 450} 0)`}>
        <rect x="500" y="50" width="410" height="500" fill={`url(#${id}-steel)`} stroke="#e5e9f4" strokeWidth="5"/>
        <path d="M530 60V540M550 60V540" stroke="#ef58ac" strokeWidth="7"/>
        <path d="M840 100L600 300 840 500" fill="none" stroke="#3557a2" strokeWidth="40"/>
      </g>
    </g>
    <rect x="98" y="63" width="804" height="474" rx="8" fill="none" stroke={`url(#${id}-chrome)`} strokeWidth="14"/>
    <rect x="98" y="63" width="804" height="474" rx="8" fill="none" stroke="#1d2d55" strokeWidth="3"/>
    {[30,550].map(y => <g key={y}><rect x="-1000" y={y} width="3000" height="20" transform={`translate(${camera % 28} 0)`} fill={`url(#${id}-teeth)`}/><path d={`M0 ${y+25}H1000`} stroke="#ec56a8" strokeWidth="3"/></g>)}
    {[55,945].map(x => [65,535].map(y => <g key={`${x}-${y}`} transform={`translate(${x} ${y}) rotate(${gear * (x === 55 ? 1 : -1)})`}><circle r="29" fill={`url(#${id}-steel)`} stroke="#eef0f5" strokeWidth="4"/><circle r="21" fill="none" stroke="#9eb5e1" strokeWidth="7" strokeDasharray="4 7"/><path d="M-9 0H9M0-9V9" stroke="#f1f2f8" strokeWidth="3"/></g>))}
    {/* Cut-paper stars tie the broadcast machine to the show's collage. */}
    {[{x:58,y:190,c:'#b6ff42',r:-14},{x:942,y:405,c:'#ed55ad',r:17}].map(star => <path key={star.x} d="M0-28L8-9 29-9 13 5 19 26 0 14-19 26-13 5-29-9-8-9Z" transform={`translate(${star.x} ${star.y}) rotate(${star.r})`} fill={star.c} stroke="#faf6ef" strokeWidth="4"/>)}
    <path d="M26 150V450M974 150V450" stroke="#b8ff42" strokeWidth="3"/>
    {[120,260,400,600,740,880].map(x => [14,586].map(y => <g key={`${x}-${y}`}><circle cx={x} cy={y} r="6" fill="#e5e8ef" stroke="#213259" strokeWidth="2"/><path d={`M${x-3} ${y}h6`} stroke="#4d6490" strokeWidth="2"/></g>))}
    <rect width="1000" height="600" filter={`url(#${id}-wear)`} opacity=".07" style={{mixBlendMode:'soft-light'}}/>
    <path d="M130 83l200 3M690 521l150-4M105 196l2 90M896 370l-3 74M210 40l120 2" stroke="#fff2fa" strokeOpacity=".3"/>
    <rect x="72" y="90" width="6" height="420" fill="#b6ff42" opacity={0.25 + impact * 0.55}/>
    <rect x="922" y="90" width="6" height="420" fill="#ed55ad" opacity={0.25 + impact * 0.55}/>
    </g>
  </svg>;
}
