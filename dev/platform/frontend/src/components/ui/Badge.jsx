import React from 'react';

/**
 * Badge — compact status / delta marker.
 * tone: 'up' (success) | 'down' (danger) | 'accent' | 'neutral'
 */
const tones = {
  up: 'bg-[#E7F2EB] text-success',
  down: 'bg-[#FBE9E5] text-danger',
  accent: 'bg-yellow text-yellow-ink',
  neutral: 'bg-gray-100 text-gray-700',
};

export default function Badge({ tone = 'neutral', className = '', children, ...props }) {
  return (
    <span
      className={`inline-flex items-center font-sans font-bold text-[10px] uppercase tracking-[0.12em] px-[9px] py-1 rounded-[3px] ${tones[tone] || tones.neutral} ${className}`}
      {...props}
    >
      {children}
    </span>
  );
}
