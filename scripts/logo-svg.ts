// 14x10 bitmap, copied verbatim from core/packages/design/src/display/logo.tsx.
// X is filled, O is the eye cut-out.
export const CAPYBARA_BITMAP: readonly string[] = [
  "..........X...",
  ".........XXX..",
  "...XXXXXXXXXXX",
  "..XXXXXXXXXOXX",
  ".XXXXXXXXXXXXX",
  ".XXXXXXXXXXXXX",
  ".XXXXXXXXXXXX.",
  "..XXXXXXXXXX..",
  "..XX..X..XX...",
  "..XX..X..XX...",
];

const COLS = 14;
const ROWS = 10;

export function logoSvg(opts: { cell: number; fill: string }): string {
  const { cell, fill } = opts;
  const segments: string[] = [];
  CAPYBARA_BITMAP.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      if (row[x] === "X") segments.push(`M${x * cell} ${y * cell}h${cell}v${cell}h${-cell}z`);
    }
  });
  const w = COLS * cell;
  const h = ROWS * cell;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" shape-rendering="crispEdges" role="img" aria-label="Capybara"><path fill="${fill}" d="${segments.join("")}"/></svg>\n`;
}

if (import.meta.main) {
  process.stdout.write(logoSvg({ cell: 10, fill: "#FF6A13" }));
}
