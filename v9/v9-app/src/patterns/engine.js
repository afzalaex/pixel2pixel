const GRID = 10;
const TOTAL = GRID * GRID;

function rgbToHex(r, g, b) {
  const toHex = (value) => value.toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase();
}

function hsvToRgb(h, s, v) {
  const sat = s / 100;
  const val = v / 100;
  const c = val * sat;
  const hp = h / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));

  let r1 = 0;
  let g1 = 0;
  let b1 = 0;

  if (hp >= 0 && hp < 1) {
    r1 = c;
    g1 = x;
  } else if (hp >= 1 && hp < 2) {
    r1 = x;
    g1 = c;
  } else if (hp >= 2 && hp < 3) {
    g1 = c;
    b1 = x;
  } else if (hp >= 3 && hp < 4) {
    g1 = x;
    b1 = c;
  } else if (hp >= 4 && hp < 5) {
    r1 = x;
    b1 = c;
  } else {
    r1 = c;
    b1 = x;
  }

  const m = val - c;
  return [
    Math.round((r1 + m) * 255),
    Math.round((g1 + m) * 255),
    Math.round((b1 + m) * 255)
  ];
}

function mapToBrandRange(channel) {
  const t = channel / 255;
  const shaped = Math.max(0, (t - 0.35) / 0.65);
  return 155 + Math.round(shaped * 100);
}

function buildBrandColors() {
  const colors = [];
  for (let hueBand = 0; hueBand < 10; hueBand += 1) {
    for (let tone = 0; tone < 10; tone += 1) {
      const hue = hueBand * 36;
      const saturation = 96 - tone * 2;
      const value = 74 + tone * 2.2;
      const [r, g, b] = hsvToRgb(hue, saturation, value);
      colors.push(
        rgbToHex(
          mapToBrandRange(r),
          mapToBrandRange(g),
          mapToBrandRange(b)
        )
      );
    }
  }
  return colors;
}

function allCoords() {
  const coords = [];
  for (let y = 0; y < GRID; y += 1) {
    for (let x = 0; x < GRID; x += 1) {
      coords.push({ x, y });
    }
  }
  return coords;
}

function pathRows() {
  return allCoords();
}

function pathColumns() {
  const coords = [];
  for (let x = 0; x < GRID; x += 1) {
    for (let y = 0; y < GRID; y += 1) {
      coords.push({ x, y });
    }
  }
  return coords;
}

function pathDiagonalBands() {
  const coords = [];
  for (let sum = 0; sum <= (GRID - 1) * 2; sum += 1) {
    const band = [];
    for (let x = 0; x < GRID; x += 1) {
      const y = sum - x;
      if (y >= 0 && y < GRID) {
        band.push({ x, y });
      }
    }
    if (sum % 2 === 1) {
      band.reverse();
    }
    coords.push(...band);
  }
  return coords;
}

function pathAntiDiagonalBands() {
  const coords = [];
  for (let diff = -(GRID - 1); diff <= GRID - 1; diff += 1) {
    const band = [];
    for (let x = 0; x < GRID; x += 1) {
      const y = x - diff;
      if (y >= 0 && y < GRID) {
        band.push({ x, y });
      }
    }
    if ((diff + GRID) % 2 === 1) {
      band.reverse();
    }
    coords.push(...band);
  }
  return coords;
}

function pathSpiralIn() {
  const coords = [];
  let left = 0;
  let right = GRID - 1;
  let top = 0;
  let bottom = GRID - 1;

  while (left <= right && top <= bottom) {
    for (let x = left; x <= right; x += 1) coords.push({ x, y: top });
    top += 1;

    for (let y = top; y <= bottom; y += 1) coords.push({ x: right, y });
    right -= 1;

    if (top <= bottom) {
      for (let x = right; x >= left; x -= 1) coords.push({ x, y: bottom });
      bottom -= 1;
    }

    if (left <= right) {
      for (let y = bottom; y >= top; y -= 1) coords.push({ x: left, y });
      left += 1;
    }
  }

  return coords;
}

function pathConcentricSquares() {
  const coords = [];
  for (let ring = 0; ring < GRID / 2; ring += 1) {
    const min = ring;
    const max = GRID - 1 - ring;

    for (let x = min; x <= max; x += 1) coords.push({ x, y: min });
    for (let y = min + 1; y <= max; y += 1) coords.push({ x: max, y });
    for (let x = max - 1; x >= min; x -= 1) coords.push({ x, y: max });
    for (let y = max - 1; y > min; y -= 1) coords.push({ x: min, y });
  }
  return coords;
}

function pathCheckerBlocks2x2() {
  const coords = [];
  for (let by = 0; by < GRID; by += 2) {
    for (let bx = 0; bx < GRID; bx += 2) {
      coords.push({ x: bx, y: by });
      coords.push({ x: bx + 1, y: by });
      coords.push({ x: bx + 1, y: by + 1 });
      coords.push({ x: bx, y: by + 1 });
    }
  }
  return coords;
}

function pathCenterOut() {
  const center = (GRID - 1) / 2;
  const coords = allCoords();
  coords.sort((a, b) => {
    const da = Math.abs(a.x - center) + Math.abs(a.y - center);
    const db = Math.abs(b.x - center) + Math.abs(b.y - center);
    if (da !== db) {
      return da - db;
    }

    const aa = Math.atan2(a.y - center, a.x - center);
    const ab = Math.atan2(b.y - center, b.x - center);
    if (aa !== ab) {
      return aa - ab;
    }

    return a.y - b.y || a.x - b.x;
  });
  return coords;
}

function validatePath(path, name) {
  if (!Array.isArray(path) || path.length !== TOTAL) {
    throw new Error(`Invalid path length for ${name}`);
  }

  const seen = new Set();
  for (const cell of path) {
    if (
      !cell ||
      !Number.isInteger(cell.x) ||
      !Number.isInteger(cell.y) ||
      cell.x < 0 ||
      cell.x >= GRID ||
      cell.y < 0 ||
      cell.y >= GRID
    ) {
      throw new Error(`Invalid cell in ${name}`);
    }

    const key = `${cell.x},${cell.y}`;
    if (seen.has(key)) {
      throw new Error(`Duplicate cell in ${name}: ${key}`);
    }
    seen.add(key);
  }
}

function transformCell(cell, rotationSteps, mirrorX, mirrorY) {
  let x = cell.x;
  let y = cell.y;

  for (let step = 0; step < rotationSteps; step += 1) {
    const nx = GRID - 1 - y;
    const ny = x;
    x = nx;
    y = ny;
  }

  if (mirrorX) {
    x = GRID - 1 - x;
  }
  if (mirrorY) {
    y = GRID - 1 - y;
  }

  return { x, y };
}

function shiftPath(path, phase) {
  const normalizedPhase = ((phase % TOTAL) + TOTAL) % TOTAL;
  if (normalizedPhase === 0) {
    return path.slice();
  }
  return path.slice(normalizedPhase).concat(path.slice(0, normalizedPhase));
}

export const PALETTE_NAME = "BRAND_ORDERED_155_255_V3";
export const BRAND_COLORS = buildBrandColors();

export const PATTERNS = Object.freeze({
  rows: { label: "Rows (horizontal bands)", path: pathRows(), phaseStep: 10 },
  columns: { label: "Columns (vertical bands)", path: pathColumns(), phaseStep: 10 },
  diagonal: { label: "Diagonal bands", path: pathDiagonalBands(), phaseStep: 2 },
  antiDiagonal: {
    label: "Anti-diagonal bands",
    path: pathAntiDiagonalBands(),
    phaseStep: 2
  },
  spiral: { label: "Spiral in", path: pathSpiralIn(), phaseStep: 4 },
  rings: { label: "Concentric squares", path: pathConcentricSquares(), phaseStep: 4 },
  checker2: { label: "2x2 checker blocks", path: pathCheckerBlocks2x2(), phaseStep: 4 },
  centerOut: { label: "Center-out", path: pathCenterOut(), phaseStep: 1 }
});

for (const [key, definition] of Object.entries(PATTERNS)) {
  validatePath(definition.path, key);
}

export function effectivePhase(patternKey, phaseInput) {
  const definition = PATTERNS[patternKey] || PATTERNS.rows;
  const step = definition.phaseStep || 1;
  return ((phaseInput * step) % TOTAL + TOTAL) % TOTAL;
}

export function buildTransformedPath(patternConfig) {
  const key = patternConfig?.key || "rows";
  const definition = PATTERNS[key] || PATTERNS.rows;

  const rotation = Number(patternConfig?.rotation || 0) % 4;
  const mirrorX = Boolean(patternConfig?.mirrorX);
  const mirrorY = Boolean(patternConfig?.mirrorY);
  const phaseIndex = Number(patternConfig?.phase || 0);
  const phaseShift = effectivePhase(key, phaseIndex);

  const transformed = definition.path.map((cell) =>
    transformCell(cell, rotation, mirrorX, mirrorY)
  );

  return shiftPath(transformed, phaseShift);
}

export function buildPatternCellOrder(patternConfig) {
  const path = buildTransformedPath(patternConfig);
  return path.map((cell) => cell.y * GRID + cell.x);
}

export function patternLabel(patternKey) {
  return (PATTERNS[patternKey] || PATTERNS.rows).label;
}

export function patternPhaseStep(patternKey) {
  return (PATTERNS[patternKey] || PATTERNS.rows).phaseStep || 1;
}

export { GRID, TOTAL };
