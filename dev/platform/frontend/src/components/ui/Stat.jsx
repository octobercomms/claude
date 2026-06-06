import React from 'react';
import Card, { Label } from './Card';
import Badge from './Badge';

/**
 * Stat — a KPI block. `feature` inverts it to ink (yellow value) so a
 * single headline metric can anchor a dashboard row.
 *
 * props: label, value, delta (string), deltaTone ('up'|'down'), foot
 */
export default function Stat({ label, value, delta, deltaTone = 'up', foot, feature = false, className = '' }) {
  return (
    <Card className={`${feature ? 'bg-ink border-ink' : ''} ${className}`}>
      <Label className={feature ? '!text-white/60' : ''}>{label}</Label>
      <div
        className={`font-sans font-extrabold text-[42px] leading-none tracking-tightest mt-2 ${
          feature ? 'text-yellow' : 'text-ink'
        }`}
      >
        {value}
      </div>
      {(delta || foot) && (
        <div className={`mt-3 flex items-center gap-2 text-xs ${feature ? 'text-white/60' : 'text-gray-500'}`}>
          {delta && <Badge tone={deltaTone}>{delta}</Badge>}
          {foot}
        </div>
      )}
    </Card>
  );
}
