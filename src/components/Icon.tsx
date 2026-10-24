/** Small inline icons (bundled with the app — no icon font or CDN needed). */
const PATHS = {
  undo: 'M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11',
  redo: 'm15 14 5-5-5-5M20 9H9.5a5.5 5.5 0 0 0 0 11H13',
  rotateLeft: 'M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5',
  rotateRight: 'M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5',
  close: 'M18 6 6 18M6 6l12 12',
  edit: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z',
  trash: 'M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6',
  sun: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10ZM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4',
  moon: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z',
  monitor: 'M3 4h18v12H3zM8 20h8M12 16v4',
  folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z',
  plus: 'M12 5v14M5 12h14',
  floorPlan: 'M3 3h18v18H3zM3 13h7v8M10 3v6h11',
  cube: 'M12 2.5 3.5 7v10l8.5 4.5 8.5-4.5V7ZM3.5 7l8.5 4.5L20.5 7M12 11.5v10',
  minus: 'M5 12h14',
  fit: 'M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5',
  download: 'M12 3v12M7 10l5 5 5-5M5 21h14',
  upload: 'M12 21V9M7 14l5-5 5 5M5 3h14',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  warning: 'M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0ZM12 9v4M12 17h0',
  check: 'M20 6 9 17l-5-5',
  panelLeft: 'M3 4h18v16H3zM9 4v16',
  // Room features
  door: 'M4 21h16M6 21V3h9v18M12 12h0',
  window: 'M4 4h16v16H4zM12 4v16M4 12h16',
  vent: 'M3 6h18v12H3zM7 9v6M11 9v6M15 9v6M19 9v6',
  outlet: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM9 9v4M15 9v4M12 16h0',
  switch: 'M7 3h10v18H7zM10 8h4v8h-4z',
  light: 'M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7V16h8v-1.3A7 7 0 0 0 12 2Z',
  radiator: 'M4 6h16v12H4zM8 6v12M12 6v12M16 6v12M6 18v3M18 18v3',
  column: 'M6 3h12M6 21h12M8 3v18M16 3v18',
  // Structure
  wall: 'M3 6h18v12H3zM3 12h18M9 6v6M15 12v6',
  corner: 'M5 20V9a4 4 0 0 1 4-4h11',
  stairs: 'M3 20h5v-5h5v-5h5V5h3',
  drawRoom: 'M4 20V6h8v6h8v8ZM4 6h0M12 12h0',
  drawWall: 'M3 18 9 8l6 6 6-10',
  magnet: 'M6 3v8a6 6 0 0 0 12 0V3M6 7h4M14 7h4',
  // Planning
  lock: 'M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4',
  unlock: 'M5 11h14v10H5zM8 11V7a4 4 0 0 1 7.5-2',
  sparkle: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8ZM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8Z',
  shapes: 'M3 3h10v10H3zM17 11a5 5 0 1 1-5 5',
  sliders: 'M3 6h11M18 6h3M14 4v4M3 12h4M11 12h10M7 10v4M3 18h13M20 18h1M16 16v4',
  palette: 'M12 3a9 9 0 0 0 0 18c1.1 0 1.6-.8 1.6-1.6 0-.9-.7-1.3-.7-2.2 0-1 .8-1.7 1.8-1.7H17a4 4 0 0 0 4-4c0-4.7-4-8.5-9-8.5ZM7.5 11.5h0M10 7.5h0M14.5 7.5h0M17 11h0',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
