import { useEffect, useRef, useState } from "react";
import { blockToHtml, blockToReact } from "@/lib/block-code";

/** Puts text on the clipboard; falls back to a hidden textarea where the async API is refused. */
async function writeText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    /* try the older way */
  }
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.cssText = "position:fixed;top:0;left:0;opacity:0";
  document.body.appendChild(area);
  area.select();
  const done = document.execCommand("copy");
  area.remove();
  if (!done) throw new Error("copy refused");
}

const HtmlIcon = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 16 16"
    fill="none"
    aria-hidden="true"
  >
    <path d="M2.5 1.5h11l-1 11.2L8 14.5l-4.5-1.8-1-11.2Z" fill="#E34F26" />
    <path d="M8 13.3l3.6-1.2.9-9.6H8v10.8Z" fill="#EF652A" />
    <path
      d="M10.7 4.6H5.9l.2 2.3h4.2l-.3 3.3L8 10.9l-2-.7-.1-1.3"
      stroke="#fff"
      strokeWidth="1.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const ReactIcon = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 16 16"
    fill="none"
    aria-hidden="true"
  >
    <g stroke="#149ECA" strokeWidth="0.95">
      <ellipse cx="8" cy="8" rx="6.9" ry="2.7" />
      <ellipse cx="8" cy="8" rx="6.9" ry="2.7" transform="rotate(60 8 8)" />
      <ellipse cx="8" cy="8" rx="6.9" ry="2.7" transform="rotate(120 8 8)" />
    </g>
    <circle cx="8" cy="8" r="1.3" fill="#149ECA" />
  </svg>
);

/** The two ways to copy a block as code: a name and a logo each. */
function CodeList({
  className,
  onPick,
}: {
  className: string;
  onPick: (kind: "HTML" | "React") => void;
}) {
  return (
    <ul className={`mimic-menu-list code-list ${className}`} role="menu">
      <li role="presentation">
        <button type="button" role="menuitem" onClick={() => onPick("HTML")}>
          <HtmlIcon />
          HTML
        </button>
      </li>
      <li role="presentation">
        <button type="button" role="menuitem" onClick={() => onPick("React")}>
          <ReactIcon />
          React
        </button>
      </li>
    </ul>
  );
}

/**
 * "Code" button with a small menu: copy the block as HTML or as a React component.
 * `source` is the block's HTML, or a function that reads it when the menu is used (a live block on the page).
 */
export function CodeMenu({
  source,
  name,
  variant,
  onNotify,
}: {
  source: string | (() => string | null);
  name: string;
  /** Shows a message in the page's toast; without it the button shows the message itself. */
  onNotify?: (message: string) => void;
  /** pill: small outlined action; card: glass pill on a block card. */
  variant: "pill" | "card";
}) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const say = (message: string) =>
    onNotify ? onNotify(message) : setNote(message);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  useEffect(() => {
    if (!note) return;
    const timer = window.setTimeout(() => setNote(null), 1600);
    return () => window.clearTimeout(timer);
  }, [note]);

  async function copy(kind: "HTML" | "React") {
    setOpen(false);
    try {
      const html = typeof source === "function" ? source() : source;
      const text = html
        ? kind === "HTML"
          ? blockToHtml(html)
          : blockToReact(html, name)
        : null;
      if (!text) throw new Error("empty");
      await writeText(text);
      say(onNotify ? `${kind} copied` : `Copied ${kind}`);
    } catch {
      say("Couldn’t copy");
    }
  }

  const button =
    variant === "pill"
      ? "mimic-link"
      : variant === "card"
        ? "copy code-btn"
        : "bench-code";

  return (
    <div
      className={`code-menu code-menu-${variant}`}
      ref={root}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          event.stopPropagation();
          setOpen(false);
        }
      }}
    >
      <button
        type="button"
        className={button}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Copy ${name} as code`}
        onClick={() => setOpen((on) => !on)}
      >
        {variant === "card" ? (
          <svg
            width="14"
            height="14"
            viewBox="0 0 16 16"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="m5.5 4.5-3.5 3.5 3.5 3.5M10.5 4.5 14 8l-3.5 3.5"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ) : null}
        {note ?? "Code"}
        {variant === "card" ? null : (
          <svg
            width="12"
            height="12"
            viewBox="0 0 12 12"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="m3 4.5 3 3 3-3"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </button>
      {open ? (
        <CodeList
          className="code-menu-list"
          onPick={(kind) => void copy(kind)}
        />
      ) : null}
    </div>
  );
}

/**
 * The editor's "Code" button: hovering (or focusing, or clicking) it opens a small menu to copy the
 * block as HTML or React.
 */
export function CodeHover({
  source,
  name,
  onNotify,
}: {
  source: () => string | null;
  name: string;
  onNotify?: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const say = (message: string) =>
    onNotify ? onNotify(message) : setNote(message);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!note) return;
    const timer = window.setTimeout(() => setNote(null), 1600);
    return () => window.clearTimeout(timer);
  }, [note]);

  async function copy(kind: "HTML" | "React") {
    setOpen(false);
    try {
      const html = source();
      const text = html
        ? kind === "HTML"
          ? blockToHtml(html)
          : blockToReact(html, name)
        : null;
      if (!text) throw new Error("empty");
      await writeText(text);
      say(onNotify ? `${kind} copied` : `Copied ${kind}`);
    } catch {
      say("Couldn’t copy");
    }
  }

  return (
    <div
      className="code-hover"
      ref={root}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={(event) => {
        if (!root.current?.contains(event.relatedTarget as Node | null))
          setOpen(false);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          event.stopPropagation();
          setOpen(false);
        }
      }}
    >
      <button
        type="button"
        className="bench-code"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Copy ${name} as code`}
        onClick={() => setOpen((on) => !on)}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 16 16"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="m5.5 4.5-3.5 3.5 3.5 3.5M10.5 4.5 14 8l-3.5 3.5"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        {note ?? "Copy code"}
      </button>
      {open ? (
        <div className="split-pop">
          <CodeList className="split-list" onPick={(kind) => void copy(kind)} />
        </div>
      ) : null}
    </div>
  );
}
