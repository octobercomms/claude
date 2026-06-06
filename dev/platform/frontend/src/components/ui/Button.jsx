import React from 'react';

/**
 * Button — the canonical action for the redesigned surfaces.
 *
 * variant: 'primary' (ink) | 'accent' (yellow) | 'ghost'
 * size:    'md' (default) | 'sm'
 *
 * Yellow is reserved as the single electric accent + focus ring, so most
 * actions are ink and the accent stays meaningful.
 */
const base =
  'inline-flex items-center justify-center gap-2 font-sans font-bold tracking-[-0.01em] ' +
  'rounded cursor-pointer select-none whitespace-nowrap transition-[transform,background-color,color,box-shadow] duration-150 ' +
  'active:translate-y-px disabled:opacity-50 disabled:cursor-not-allowed ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow focus-visible:ring-offset-2 focus-visible:ring-offset-paper';

const variants = {
  primary: 'bg-ink text-surface hover:bg-yellow hover:text-yellow-ink',
  accent: 'bg-yellow text-yellow-ink hover:bg-yellow-bright',
  ghost: 'bg-transparent text-ink shadow-[inset_0_0_0_1.5px_var(--ink)] hover:bg-ink hover:text-surface',
};

const sizes = {
  md: 'text-sm px-[22px] py-3',
  sm: 'text-[13px] px-4 py-2',
};

export default function Button({
  variant = 'primary',
  size = 'md',
  className = '',
  type = 'button',
  ...props
}) {
  return (
    <button
      type={type}
      className={`${base} ${variants[variant] || variants.primary} ${sizes[size] || sizes.md} ${className}`}
      {...props}
    />
  );
}
