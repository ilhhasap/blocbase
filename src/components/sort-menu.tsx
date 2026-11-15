import { useEffect, useRef, useState, type ReactNode } from "react";
import { SORTS, type SortMode } from "@/lib/sort-blocks";

const icon = (children: ReactNode) => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 20 20"
    fill="none"
    aria-hidden="true"
  >
    {children}
  </svg>
);

const ICONS: Record<SortMode, ReactNode> = {
  featured: icon(
    <path
      d="m10 3 2.1 4.4 4.9.6-3.6 3.3.9 4.8L10 13.7 5.7 16.1l.9-4.8L3 8l4.9-.6L10 3Z"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
    />,
  ),
  new: icon(
    <path
      d="M10 3v4M10 13v4M3 10h4M13 10h4M5.2 5.2l2.4 2.4M12.4 12.4l2.4 2.4M14.8 5.2l-2.4 2.4M7.6 12.4l-2.4 2.4"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
    />,
  ),
  popular: icon(
    <path
      d="M10 17c3 0 5-2 5-4.6 0-2-1.2-3.2-2.2-4.4-.3 1-.9 1.6-1.6 1.8.2-2.2-.6-4.2-2.7-5.8.1 2.3-1.5 3.7-2.7 5.2C5 10.4 5 11.4 5 12.4 5 15 7 17 10 17Z"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
    />,
  ),
  copied: icon(
    <>
      <rect
        x="7.5"
        y="7.5"
        width="9"
        height="9"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path
        d="M12.5 5.5v-.2a1.8 1.8 0 0 0-1.8-1.8H5.3a1.8 1.8 0 0 0-1.8 1.8v5.4a1.8 1.8 0 0 0 1.8 1.8h.2"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </>,
  ),
  name: icon(
    <path
      d="M4 15 7.5 5 11 15M5.2 12h4.6M14 6h3.5L14 11h3.5M14.5 15h3"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />,
  ),
};

/** "Sort by: Featured" with a menu of ways to order the library. */
export function SortMenu({
  value,
  onChange,
}: {
  value: SortMode;
  onChange: (mode: SortMode) => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const current = SORTS.find((sort) => sort.id === value) ?? SORTS[0]!;

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  return (
    <div
      className="sort"
      ref={root}
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          event.stopPropagation();
          setOpen(false);
        }
      }}
    >
      <span className="sort-label">Sort by:</span>
      <button
        type="button"
        className="sort-btn"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((on) => !on)}
      >
        {current.label}
        <svg
          className="sort-chev"
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="m3 4.5 3 3 3-3"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      {open ? (
        <ul className="sort-list" role="listbox" aria-label="Sort by">
          {SORTS.map((sort) => (
            <li key={sort.id} role="presentation">
              <button
                type="button"
                role="option"
                aria-selected={sort.id === value}
                title={sort.hint}
                onClick={() => {
                  onChange(sort.id);
                  setOpen(false);
                }}
              >
                {ICONS[sort.id]}
                {sort.label}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
