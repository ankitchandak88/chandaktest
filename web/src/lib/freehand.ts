// Standard helper from perfect-freehand's own examples: getStroke() returns
// an outline polygon (array of [x,y] points); this turns it into a smooth
// SVG path by averaging each pair of points into a quadratic curve control
// point, rather than connecting the raw polygon with straight segments
// (which would look faceted, not hand-drawn).
export function getSvgPathFromStroke(stroke: number[][]): string {
  if (!stroke.length) return ''

  const d = stroke.reduce(
    (acc, [x0, y0], i, arr) => {
      const [x1, y1] = arr[(i + 1) % arr.length]
      acc.push(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2)
      return acc
    },
    ['M', ...stroke[0], 'Q'] as (string | number)[],
  )

  d.push('Z')
  return d.join(' ')
}
