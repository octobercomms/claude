// Shared connector-label helpers — used by the Shopify multi-store rows on the
// connectors page and the multi-site Microsoft Clarity card, so both render a
// label the same way: a country flag inferred from the label + a coloured tag
// (yellow for B2B, green otherwise).

const COUNTRY_CODES = {
  UK: '🇬🇧', GB: '🇬🇧', US: '🇺🇸', USA: '🇺🇸', EU: '🇪🇺',
  AU: '🇦🇺', CA: '🇨🇦', DE: '🇩🇪', FR: '🇫🇷', IT: '🇮🇹',
  ES: '🇪🇸', NL: '🇳🇱', SE: '🇸🇪', PL: '🇵🇱', BE: '🇧🇪',
  IE: '🇮🇪', JP: '🇯🇵', MX: '🇲🇽', BR: '🇧🇷', IN: '🇮🇳',
  SG: '🇸🇬', AE: '🇦🇪', UAE: '🇦🇪', NZ: '🇳🇿', ZA: '🇿🇦',
  NO: '🇳🇴', DK: '🇩🇰', FI: '🇫🇮', CH: '🇨🇭', AT: '🇦🇹', PT: '🇵🇹',
};
const COUNTRY_KEYWORDS = [
  ['BRITAIN', '🇬🇧'],
  ['UNITED STATES', '🇺🇸'],
  ['EUROPE', '🇪🇺'],
  ['AUSTRALIA', '🇦🇺'],
  ['CANADA', '🇨🇦'],
  ['GERMANY', '🇩🇪'], ['DEUTSCH', '🇩🇪'],
  ['FRANCE', '🇫🇷'], ['FRENCH', '🇫🇷'],
  ['ITALY', '🇮🇹'], ['ITALIAN', '🇮🇹'],
  ['SPAIN', '🇪🇸'], ['SPANISH', '🇪🇸'],
  ['NETHERLAND', '🇳🇱'], ['DUTCH', '🇳🇱'],
  ['SWEDEN', '🇸🇪'], ['SWEDISH', '🇸🇪'],
  ['POLAND', '🇵🇱'], ['POLISH', '🇵🇱'],
  ['BELGIUM', '🇧🇪'], ['BELGIAN', '🇧🇪'],
  ['IRELAND', '🇮🇪'], ['IRISH', '🇮🇪'],
  ['JAPAN', '🇯🇵'], ['JAPANESE', '🇯🇵'],
  ['MEXICO', '🇲🇽'], ['MEXICAN', '🇲🇽'],
  ['BRAZIL', '🇧🇷'], ['BRAZILIAN', '🇧🇷'],
  ['INDIA', '🇮🇳'], ['INDIAN', '🇮🇳'],
  ['SINGAPORE', '🇸🇬'],
  ['EMIRATES', '🇦🇪'],
  ['NEW ZEALAND', '🇳🇿'],
  ['SOUTH AFRICA', '🇿🇦'],
  ['NORWAY', '🇳🇴'], ['NORWEGIAN', '🇳🇴'],
  ['DENMARK', '🇩🇰'], ['DANISH', '🇩🇰'],
  ['FINLAND', '🇫🇮'], ['FINNISH', '🇫🇮'],
  ['SWITZERLAND', '🇨🇭'], ['SWISS', '🇨🇭'],
  ['AUSTRIA', '🇦🇹'], ['AUSTRIAN', '🇦🇹'],
  ['PORTUGAL', '🇵🇹'], ['PORTUGUESE', '🇵🇹'],
];

export function getCountryFlag(label) {
  if (!label) return '';
  const u = label.toUpperCase();
  const tokens = u.split(/[^A-Z]+/).filter(Boolean);
  for (const t of tokens) {
    if (COUNTRY_CODES[t]) return COUNTRY_CODES[t];
  }
  for (const [keyword, flag] of COUNTRY_KEYWORDS) {
    if (u.includes(keyword)) return flag;
  }
  return '';
}

export function getLabelStyle(label) {
  const isB2B = label && label.toUpperCase().includes('B2B');
  return {
    fontSize: 11, fontWeight: 700, padding: '2px 8px',
    borderRadius: 'var(--r-md)',
    background: isB2B ? 'var(--accent)' : 'var(--positive)',
    color: 'var(--surface)',
    whiteSpace: 'nowrap',
  };
}
