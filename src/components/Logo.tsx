// Classeum's logo: the pixel colosseum drawn on a classroom chalkboard (Class + Colosseum).
const ROWS = [
  'wwwwwwwwwwwwwwwwwwwwwwwww',
  'wWWWWWWWFWWWWWWWWWWWWWWWw',
  'wWggggggFFgggggggggggggWw',
  'wWggggggkggggggggggggggWw',
  'wWggggLLLLLLLLLLgghhgggWw',
  'wWggggMMMMMMMMMMMMgggggWw',
  'wWggggMgMgMgMgMgMMgggggWw',
  'wWggggDDDDDDDDDDDDDggggWw',
  'wWggggLLLLLLLLLLLLLggggWw',
  'wWggggMMgMMMgMMMgMMggggWw',
  'wWggggMgggMgggMgggMggggWw',
  'wWggggDDDDDDDDDDDDDggggWw',
  'wWggggLLLLLLLLLLLLLggggWw',
  'wWggggMMgMMMgMMMgMMghhgWw',
  'wWghggMgggMgggMgggMggggWw',
  'wWggggMgggMgggMgggMggggWw',
  'wWggggDDDDDDDDDDDDDggggWw',
  'wWWWWWWWWWWWWWWWWWWWWWWWw',
  'wwwwcccwwwwwwwwwwwoowwwww',
  'wWWWWWWWWWWWWWWWWWWWWWWWw',
  '.wwwwwwwwwwwwwwwwwwwwwww.',
];

const PALETTE: Record<string, string> = {
  w: '#6E4526', // frame shade
  W: '#B98654', // frame
  g: '#2F6B4F', // board
  h: '#3E7E60', // chalk smudge
  c: '#F4F4EE', // white chalk
  o: '#FF8A5C', // orange chalk
  L: '#F6D88F', // colosseum light
  M: '#E3B252', // colosseum
  D: '#A8742F', // colosseum shade
  F: '#FF5B24', // flag
  k: '#C9CDD6', // flagpole
};

// One <path> per colour, built once.
const PATHS = Object.entries(PALETTE)
  .map(([ch, color]) => {
    let d = '';
    ROWS.forEach((row, y) => {
      for (let x = 0; x < row.length; ) {
        if (row[x] !== ch) {
          x++;
          continue;
        }
        let w = 1;
        while (row[x + w] === ch) w++;
        d += `M${x} ${y}h${w}v1h-${w}z`;
        x += w;
      }
    });
    return [color, d] as const;
  })
  .filter(([, d]) => d);

const W = ROWS[0].length;
const H = ROWS.length;

export function Logo({ width = 60 }: { width?: number }) {
  return (
    <svg width={width} height={(width * H) / W} viewBox={`0 0 ${W} ${H}`} shapeRendering="crispEdges" role="img" aria-label="Classeum 로고" style={{ display: 'block' }}>
      {PATHS.map(([color, d]) => (
        <path key={color} d={d} fill={color} />
      ))}
    </svg>
  );
}
