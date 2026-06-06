import React from 'react';

/**
 * Card — a surface panel. The base container for content blocks on
 * redesigned pages. Use `as` to change the element (e.g. 'section').
 */
export default function Card({ as: Tag = 'div', className = '', children, ...props }) {
  return (
    <Tag
      className={`bg-surface border border-line rounded-lg p-[22px] ${className}`}
      {...props}
    >
      {children}
    </Tag>
  );
}

/** Small uppercase, tracked label — Brockmann standing in for a mono. */
export function Label({ className = '', children, ...props }) {
  return (
    <div
      className={`font-sans font-medium text-[11px] uppercase tracking-label text-gray-500 ${className}`}
      {...props}
    >
      {children}
    </div>
  );
}
