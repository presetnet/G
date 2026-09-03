/** Compact SF-style line icons (24 viewBox). */
export const icons = {
  activity: `<path d="M3 12h4l2.5-7 5 14L17 12h4"/>`,
  server: `<rect x="3" y="4" width="18" height="6" rx="1.5"/><rect x="3" y="14" width="18" height="6" rx="1.5"/><circle cx="7" cy="7" r="1"/><circle cx="7" cy="17" r="1"/>`,
  cpu: `<rect x="5" y="5" width="14" height="14" rx="2"/><path d="M9 1v3M15 1v3M9 20v3M15 20v3M1 9h3M1 15h3M20 9h3M20 15h3"/><rect x="9" y="9" width="6" height="6" rx="1"/>`,
  memory: `<rect x="2" y="7" width="20" height="10" rx="2"/><path d="M6 7V5M10 7V5M14 7V5M18 7V5M6 19v-2M10 19v-2M14 19v-2M18 19v-2"/>`,
  rocket: `<path d="M5 15c2-1 4-5 5-9 3 1 7 5 8 8-4 1-8 3-9 5l-4-4z"/><path d="M9 15l-3 5M10 14l-5 3"/><circle cx="14.5" cy="9.5" r="1.2"/>`,
  brain: `<path d="M8 8a3.5 3.5 0 0 1 4-3.4A3.5 3.5 0 0 1 18 8c0 4-2.5 5.5-4 8-1.5-2.5-4-4-4-8z"/><path d="M8 12c-2 .5-3.5 2-3.5 4S7 20 9.5 20H12M16 12c2 .5 3.5 2 3.5 4S17 20 14.5 20H12"/><path d="M12 8v12"/>`,
  blocks: `<rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="3" width="8" height="8" rx="1.5"/><rect x="3" y="13" width="8" height="8" rx="1.5"/><rect x="13" y="13" width="8" height="8" rx="1.5"/>`,
  spark: `<path d="M12 2l1.4 6.1L19 8l-4.4 3.4L16 18l-4-3.2L8 18l1.4-6.6L5 8l5.6-.9L12 2z"/>`,
  network: `<circle cx="12" cy="5" r="2.2"/><circle cx="5" cy="18" r="2.2"/><circle cx="19" cy="18" r="2.2"/><path d="M12 7.2v4.3M12 11.5 6.5 16.2M12 11.5l5.5 4.7"/>`,
  app: `<rect x="4" y="4" width="16" height="16" rx="3.5"/><path d="M8 10h8M8 14h5"/>`,
  tools: `<path d="M14.5 5.5a3.5 3.5 0 0 0-4.9 4.9L4 16v4h4l5.6-5.6a3.5 3.5 0 0 0 4.9-4.9l-2.5 2.5-2.5-2.5 2.5-2.5z"/>`,
  chat: `<path d="M5 6.5A2.5 2.5 0 0 1 7.5 4h9A2.5 2.5 0 0 1 19 6.5v6A2.5 2.5 0 0 1 16.5 15H11l-4 3v-3H7.5A2.5 2.5 0 0 1 5 12.5v-6z"/>`,
  image: `<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M3 16l5-4 4 3 3-2 6 4"/>`,
  music: `<path d="M9 18V6l10-2v12"/><circle cx="7" cy="18" r="2.4"/><circle cx="17" cy="16" r="2.4"/>`,
  code: `<path d="M8 8 4 12l4 4M16 8l4 4-4 4M13 5l-2 14"/>`,
  chip: `<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3"/>`,
  book: `<path d="M5 4.5A2.5 2.5 0 0 1 7.5 2H20v18H7.5A2.5 2.5 0 0 0 5 22.5"/><path d="M5 4.5v18"/><path d="M9 7h7M9 11h7"/>`,
  bolt: `<path d="M13 2 5 13h6l-1 9 8-11h-6l1-9z"/>`,
  refresh: `<path d="M20 12a8 8 0 1 1-2.2-5.4"/><path d="M20 4v5h-5"/>`,
  pulse: `<path d="M3 12h3l2-5 3 10 2-5h6"/>`,
  layers: `<path d="M12 3 3 8l9 5 9-5-9-5z"/><path d="M3 12l9 5 9-5M3 16l9 5 9-5"/>`,
  plug: `<path d="M9 7V3M15 7V3M8 7h8v4a4 4 0 0 1-4 4h0a4 4 0 0 1-4-4V7z"/><path d="M12 15v6"/>`,
  tag: `<path d="M20.5 13.5 12 22l-9-9V4h9l8.5 9.5z"/><circle cx="7.5" cy="7.5" r="1.3"/>`,
  trophy: `<path d="M7 4h10l-.5 8a4.5 4.5 0 0 1-9 0L7 4z"/><path d="M7 5H4v1a3 3 0 0 0 3 3M17 5h3v1a3 3 0 0 1-3 3M9 15.5V19h6v-3.5M10 19h4v2h-4z"/>`,
};

export function icon(name, className = "ico") {
  const body = icons[name] || icons.spark;
  return `<svg class="${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}
