import React from 'react';

/**
 * Input — text field with an optional label. Yellow focus ring matches
 * the rest of the system; passes a real visible focus state (a gap today).
 */
const field =
  'w-full font-sans text-sm bg-surface text-ink border-[1.5px] border-gray-300 rounded px-[13px] py-[11px] ' +
  'placeholder:text-gray-400 transition-[border-color,box-shadow] duration-150 ' +
  'focus:outline-none focus:border-ink focus:shadow-[0_0_0_3px_var(--ring)]';

const Input = React.forwardRef(function Input({ label, id, className = '', ...props }, ref) {
  const input = <input ref={ref} id={id} className={`${field} ${className}`} {...props} />;
  if (!label) return input;
  return (
    <label htmlFor={id} className="block">
      <span className="block font-sans font-bold text-[11px] uppercase tracking-label text-gray-500 mb-[6px]">
        {label}
      </span>
      {input}
    </label>
  );
});

export default Input;
