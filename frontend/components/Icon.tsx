const PATHS = {
  search: 'M10.5 3a7.5 7.5 0 1 0 4.6 13.4L20 21.3l1.3-1.3-4.9-4.9A7.5 7.5 0 0 0 10.5 3Zm0 2a5.5 5.5 0 1 1 0 11 5.5 5.5 0 0 1 0-11Z',
  plus: 'M11 4h2v7h7v2h-7v7h-2v-7H4v-2h7V4Z',
  minus: 'M4 11h16v2H4v-2Z',
  close: 'M5.4 4 12 10.6 18.6 4 20 5.4 13.4 12l6.6 6.6-1.4 1.4-6.6-6.6L5.4 20 4 18.6l6.6-6.6L4 5.4 5.4 4Z',
  copy: 'M8 3h12v14h-4v4H4V7h4V3Zm2 4h6v8h2V5h-8v2ZM6 9v10h8V9H6Z',
  parts: 'M3 3h8v8H3V3Zm2 2v4h4V5H5Zm8-2h8v8h-8V3Zm2 2v4h4V5h-4ZM3 13h8v8H3v-8Zm2 2v4h4v-4H5Zm8-2h8v8h-8v-8Zm2 2v4h4v-4h-4Z',
  box: 'M3 4h18v5h-1v11H4V9H3V4Zm2 2v1h14V6H5Zm1 3v9h12V9H6Zm3 2h6v2H9v-2Z',
  activity: 'M4 5h16v2H4V5Zm0 6h10v2H4v-2Zm0 6h13v2H4v-2Z',
  upload: 'M12 3 6.5 8.5l1.4 1.4L11 6.8V16h2V6.8l3.1 3.1 1.4-1.4L12 3ZM4 19h16v2H4v-2Z',
  download: 'M11 3h2v9.2l3.1-3.1 1.4 1.4L12 16l-5.5-5.5 1.4-1.4 3.1 3.1V3ZM4 19h16v2H4v-2Z',
  print: 'M7 3h10v5h4v10h-4v3H7v-3H3V8h4V3Zm2 2v3h6V5H9ZM5 10v6h2v-2h10v2h2v-6H5Zm4 6v3h6v-3H9Z',
  logout: 'M4 4h9v2H6v12h7v2H4V4Zm12.6 3.6L21 12l-4.4 4.4-1.4-1.4 2-2H10v-2h7.2l-2-2 1.4-1.4Z',
  edit: 'M16.5 3 21 7.5 8.5 20H4v-4.5L16.5 3Zm0 2.8L6 16.3V18h1.7L18.2 7.5l-1.7-1.7Z',
  github:
    'M12 2a10 10 0 0 0-3.2 19.5c.5.1.7-.2.7-.5v-1.8c-2.8.6-3.4-1.3-3.4-1.3-.4-1.2-1.1-1.5-1.1-1.5-.9-.6.1-.6.1-.6 1 .1 1.5 1 1.5 1 .9 1.5 2.3 1.1 2.9.8.1-.6.3-1.1.6-1.3-2.2-.3-4.5-1.1-4.5-5a3.9 3.9 0 0 1 1-2.7c-.1-.3-.4-1.3.1-2.6 0 0 .8-.3 2.7 1a9.4 9.4 0 0 1 5 0c1.9-1.3 2.7-1 2.7-1 .5 1.3.2 2.3.1 2.6a3.9 3.9 0 0 1 1 2.7c0 3.9-2.3 4.7-4.5 5 .4.3.7.9.7 1.9V21c0 .3.2.6.7.5A10 10 0 0 0 12 2Z',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path fillRule="evenodd" d={PATHS[name]} />
    </svg>
  );
}
