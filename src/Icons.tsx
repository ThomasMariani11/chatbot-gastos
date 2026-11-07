import type { CSSProperties } from 'react';

const paths = {
  home: ['M3 10 12 3l9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z'],
  movements: ['M7 4v16M3 8l4-4 4 4M17 20V4m-4 12 4 4 4-4'],
  card: ['M4 5h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2ZM2 10h20'],
  settings: ['M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z', 'M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1Z'],
  shield: ['M12 3 3 7v5c0 5 9 9 9 9s9-4 9-9V7ZM9 12l2 2 4-4'],
  smartphone: ['M8 2h8a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2ZM11 18h2'],
  message: ['M21 11a9 9 0 0 1-9 9H3l2-5a9 9 0 1 1 16-4Z'],
  bell: ['M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9ZM10 21h4'],
  arrowUpRight: ['M6 18 18 6M6 6h12v12'],
  arrowDownRight: ['M6 6 18 18M6 18h12V6'],
  wallet: ['M20 7H5a2 2 0 0 1 0-4h13v4M4 7v12a2 2 0 0 0 2 2h14V7ZM20 12h-6v5h6'],
  chevronRight: ['m9 5 7 7-7 7'],
  chevronDown: ['m5 9 7 7 7-7'],
  close: ['m6 6 12 12M6 18 18 6'],
  plus: ['M12 5v14M5 12h14'],
  check: ['m5 12 4 4L19 6'],
  alert: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM12 7v6M12 17h.01'],
  refresh: ['M20 7a8 8 0 0 0-14-2L3 8m0-5v5h5M4 17a8 8 0 0 0 14 2l3-3m0 5v-5h-5'],
  save: ['M4 3h13l4 4v14H3V3ZM7 3v6h9V3M7 21v-7h10v7'],
  edit: ['m16 3 5 5L9 20l-6 1 1-6ZM13 6l5 5'],
  trash: ['M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7'],
  logOut: ['M9 3H4v18h5M10 12h11m-5-5 5 5-5 5'],
  key: ['M8 3a5 5 0 1 0 0 10 5 5 0 0 0 0-10ZM12 12l9 9m-4-4 3-3m-6 0 3-3'],
  clock: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM12 7v5l3 2'],
  externalLink: ['M14 3h7v7m0-7L10 14M10 3H3v18h18v-7'],
  share: ['M12 15V2m-4 4 4-4 4 4M5 10H3v11h18V10h-2'],
  bag: ['M5 7h14l2 14H3ZM9 8V6a3 3 0 0 1 6 0v2'],
  cart: ['M3 3h2l3 12h10l3-9H6M9 20h.01M18 20h.01'],
  utensils: ['M5 3v7m4-7v7m-6-7v5a4 4 0 0 0 8 0V3M7 12v9M18 3c-3 3-3 8 0 9h2V3ZM20 12v9'],
  car: ['m5 6 2-3h10l2 3 2 5v8h-3v-3H6v3H3v-8ZM3 11h18M7 13h.01M17 13h.01'],
  heart: ['M20 5a5 5 0 0 0-8 1 5 5 0 0 0-8-1c-5 5 2 10 8 15 6-5 13-10 8-15Z'],
  graduation: ['m2 9 10-5 10 5-10 5ZM6 11v6c4 3 8 3 12 0v-6M22 9v8'],
  briefcase: ['M8 6V3h8v3M3 6h18v15H3ZM3 12c6 4 12 4 18 0M12 12v4'],
  receipt: ['M4 3v18l4-2 4 2 4-2 4 2V3l-4 2-4-2-4 2ZM8 9h8M8 13h6'],
  bolt: ['m13 2-9 12h7l-1 8 10-12h-8Z'],
  music: ['M9 18V5l11-2v13M9 17a3 3 0 1 0 0 4 3 3 0 0 0 0-4ZM20 15a3 3 0 1 0 0 4 3 3 0 0 0 0-4Z'],
  repeat: ['M17 2l4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4M21 13v2a3 3 0 0 1-3 3H3'],
  wrench: ['M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z'],
  laptop: ['M4 5h16v11H4ZM2 20h20'],
  sparkles: ['M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8ZM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8Z'],
  dumbbell: ['M6 7v10M3 9v6M18 7v10M21 9v6M6 12h12'],
  paw: ['M12 13c-3 0-5 2.5-5 4.5 0 1.5 1.5 2.5 3 2.5 1 0 1.5-.5 2-.5s1 .5 2 .5c1.5 0 3-1 3-2.5 0-2-2-4.5-5-4.5Z', 'M5.5 10h.01', 'M9.5 6h.01', 'M14.5 6h.01', 'M18.5 10h.01'],
  smile: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01'],
  plane: ['M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z'],
  gift: ['M3 8h18v4H3ZM5 12v9h14v-9M12 8v13M12 8C9 8 7 6 8.5 4.5S12 5 12 8ZM12 8c3 0 5-2 3.5-3.5S12 5 12 8Z'],
  search: ['M11 3a8 8 0 1 0 0 16 8 8 0 0 0 0-16Z', 'm21 21-4.35-4.35'],
  moreHorizontal: ['M5 12h.01', 'M12 12h.01', 'M19 12h.01'],
  filter: ['M4 6h16', 'M7 12h10', 'M10 18h4'],
  copy: ['M9 9h11v11H9Z', 'M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1'],
  whatsapp: [
    'M3 21l1.65-3.8a9 9 0 1 1 3.4 2.9L3 21',
    'M9 10a.5.5 0 0 0 1 0V9a.5.5 0 0 0-1 0v1a5 5 0 0 0 5 5h1a.5.5 0 0 0 0-1h-1a.5.5 0 0 0 0 1',
  ],
} as const;
export type IconName = keyof typeof paths;
export function Icon({
  name,
  size = 20,
  className = 'ui-icon',
  style,
}: {
  name: IconName;
  size?: number;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      style={style}
    >
      {paths[name].map((d, index) => (
        <path key={index} d={d} />
      ))}
    </svg>
  );
}
