import { useEffect, useRef, useState } from "react";

interface ClassificationBadgeProps {
  label: string;
  /** Current raw value. For toggle badges pass the boolean. */
  value: string;
  /** Select options. Omit for a free-text badge (e.g. model name). */
  options?: { value: string; label: string }[];
  /** When true the badge flips between the two options on click, no editor. */
  toggle?: boolean;
  onChange: (value: string) => void;
}

export function ClassificationBadge({
  label,
  value,
  options,
  toggle = false,
  onChange,
}: ClassificationBadgeProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const selectRef = useRef<HTMLSelectElement | null>(null);

  useEffect(() => setDraft(value), [value]);

  useEffect(() => {
    if (!editing) return;
    (options ? selectRef.current : inputRef.current)?.focus();
  }, [editing, options]);

  const display = options?.find((o) => o.value === value)?.label ?? value;

  if (toggle && options?.length === 2) {
    const next = options.find((o) => o.value !== value) ?? options[0];
    return (
      <button
        type="button"
        className={`badge badge-toggle${value === options[0].value ? " badge-on" : ""}`}
        aria-label={`${label}: ${display}. Click to set ${next.label}`}
        onClick={() => onChange(next.value)}
      >
        <span className="badge-label">{label}</span>
        <span className="badge-value">{display}</span>
      </button>
    );
  }

  if (editing) {
    const commit = (v: string) => {
      onChange(v);
      setEditing(false);
    };
    return (
      <span className="badge badge-editing">
        <span className="badge-label">{label}</span>
        {options ? (
          <select
            ref={selectRef}
            className="badge-input"
            value={draft}
            onChange={(e) => commit(e.target.value)}
            onBlur={() => setEditing(false)}
          >
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        ) : (
          <input
            ref={inputRef}
            className="badge-input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => commit(draft)}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing || e.keyCode === 229) return;
              if (e.key === "Enter") commit(draft);
              if (e.key === "Escape") {
                setDraft(value);
                setEditing(false);
              }
            }}
          />
        )}
      </span>
    );
  }

  return (
    <button
      type="button"
      className="badge badge-editable"
      aria-label={`${label}: ${display}. Click to edit`}
      onClick={() => setEditing(true)}
    >
      <span className="badge-label">{label}</span>
      <span className="badge-value">{display || "—"}</span>
    </button>
  );
}
