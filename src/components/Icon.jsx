/* eslint-disable react/prop-types */
export function Icon({ name, size = 20 }) {
  const paths = { home: 'M3 10.5 12 3l9 7.5M5.5 9v10h13V9M9 19v-6h6v6', inbox: 'M4 4h16v16H4zM4 13h4l1.5 2h5L16 13h4', review: 'M5 4h14v16H5zM8 8h8M8 12h8M8 16h5', archive: 'M4 7h16v13H4zM3 4h18v3H3zM9 12h6', chart: 'M5 19V9M12 19V5M19 19v-7', menu: 'M4 7h16M4 12h16M4 17h16', close: 'm6 6 12 12M18 6 6 18', file: 'M6 3h8l4 4v14H6zM14 3v5h5' }
  return <svg aria-hidden="true" fill="none" height={size} viewBox="0 0 24 24" width={size}><path d={paths[name]} stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" /></svg>
}
