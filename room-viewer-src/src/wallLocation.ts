// Mirrors @nitrots/nitro-renderer's own FurnitureWallDataParser.parse() (the "new format"
// branch, location.indexOf(':') === 0) — confirmed against real captures from this game:
// ":w=3,2 l=6,21 l" -> width=3 height=2 localX=6 localY=21 direction='l'.
export interface WallLocation {
  width: number;
  height: number;
  localX: number;
  localY: number;
  direction: 'l' | 'r';
}

export function parseWallLocation(location: string): WallLocation {
  if (location.indexOf(':') !== 0) {
    throw new Error(`unrecognized wall location format (old-format locations aren't supported): ${location}`);
  }

  const parts = location.split(' ');

  if (parts.length < 3) {
    throw new Error(`unrecognized wall location format: ${location}`);
  }

  const widthHeight = parts[0];
  const localXY = parts[1];
  const direction = parts[2];

  if (widthHeight.length <= 3 || localXY.length <= 2 || (direction !== 'l' && direction !== 'r')) {
    throw new Error(`unrecognized wall location format: ${location}`);
  }

  const whParts = widthHeight.substr(3).split(',');
  const xyParts = localXY.substr(2).split(',');

  if (whParts.length < 2 || xyParts.length < 2) {
    throw new Error(`unrecognized wall location format: ${location}`);
  }

  return {
    width: parseInt(whParts[0], 10),
    height: parseInt(whParts[1], 10),
    localX: parseInt(xyParts[0], 10),
    localY: parseInt(xyParts[1], 10),
    direction
  };
}
