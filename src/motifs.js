/**
 * Procedural motif library.
 *
 * Every motif is drawn as polylines inside a normalised 0..1 box (x right,
 * y down), so the page composer can scale and place it without knowing what it
 * is. This is the first half of the canonical intermediate representation the
 * milestone review required: one geometry, consumed by both the SVG serialiser
 * and the PDF emitter, with no second drawing path.
 *
 * A motif polyline is:
 *   { points: [[x, y], ...], closed: boolean, fill: boolean, weight: number }
 *
 * `weight` is relative: 1 is a main outline, below 1 is interior detail. The
 * composer turns it into an absolute stroke width in points and clamps it to
 * the crayon-friendly floor.
 *
 * `closed` and `fill` are carried per polyline rather than inferred, because
 * SVG can hide an overlap with a white fill while a stroke-only PDF cannot.
 * The PDF emitter needs to know which shapes are filled to avoid "X-ray"
 * intersections where motifs cross.
 */

/** Relative stroke weight for main outlines. */
export const MAIN_WEIGHT = 1;

/** Relative stroke weight for interior detail. */
export const DETAIL_WEIGHT = 0.6;

/**
 * Build an open polyline.
 *
 * @param {Array<[number, number]>} points
 * @param {{ closed?: boolean, fill?: boolean, weight?: number }} [options]
 * @returns {{ points: Array<[number, number]>, closed: boolean, fill: boolean, weight: number }}
 */
export function stroke(points, options = {}) {
  return {
    points,
    closed: options.closed ?? false,
    fill: options.fill ?? false,
    weight: options.weight ?? MAIN_WEIGHT,
  };
}

/**
 * Build a closed polyline.
 *
 * @param {Array<[number, number]>} points
 * @param {{ fill?: boolean, weight?: number }} [options]
 */
export function polygon(points, options = {}) {
  return stroke(points, { ...options, closed: true });
}

/**
 * Circle as a closed polyline.
 *
 * @param {number} cx
 * @param {number} cy
 * @param {number} r
 * @param {number} [segments]
 * @param {{ fill?: boolean, weight?: number }} [options]
 */
export function circle(cx, cy, r, segments = 24, options = {}) {
  return polygon(ellipsePoints(cx, cy, r, r, segments), options);
}

/**
 * Ellipse as a closed polyline.
 *
 * @param {number} cx
 * @param {number} cy
 * @param {number} rx
 * @param {number} ry
 * @param {number} [segments]
 * @param {{ fill?: boolean, weight?: number }} [options]
 */
export function ellipse(cx, cy, rx, ry, segments = 24, options = {}) {
  return polygon(ellipsePoints(cx, cy, rx, ry, segments), options);
}

/**
 * Circular arc as an open polyline. Angles are degrees, clockwise from +x.
 *
 * @param {number} cx
 * @param {number} cy
 * @param {number} r
 * @param {number} startDeg
 * @param {number} endDeg
 * @param {number} [segments]
 */
export function arc(cx, cy, r, startDeg, endDeg, segments = 16) {
  const start = (startDeg * Math.PI) / 180;
  const end = (endDeg * Math.PI) / 180;
  const points = [];
  for (let i = 0; i <= segments; i += 1) {
    const angle = start + ((end - start) * i) / segments;
    points.push([cx + Math.cos(angle) * r, cy + Math.sin(angle) * r]);
  }
  return stroke(points);
}

function ellipsePoints(cx, cy, rx, ry, segments) {
  const points = [];
  for (let i = 0; i < segments; i += 1) {
    const angle = (i / segments) * Math.PI * 2;
    points.push([cx + Math.cos(angle) * rx, cy + Math.sin(angle) * ry]);
  }
  return points;
}

/**
 * Axis-aligned bounding box of a polyline set.
 *
 * @param {Array<{ points: Array<[number, number]> }>} polylines
 * @returns {{ x: number, y: number, w: number, h: number }}
 */
export function computeBounds(polylines) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const line of polylines) {
    for (const [x, y] of line.points) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (!Number.isFinite(minX)) {
    return { x: 0, y: 0, w: 0, h: 0 };
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/**
 * One generator per vocabulary motif. Each returns polylines in a 0..1 box.
 * `rng` is used only for small, deterministic variation.
 */
const MOTIF_GENERATORS = {
  star(rng) {
    const points = [];
    const rotation = -Math.PI / 2 + (rng() - 0.5) * 0.15;
    for (let i = 0; i < 10; i += 1) {
      const radius = i % 2 === 0 ? 0.48 : 0.2;
      const angle = rotation + (i * Math.PI) / 5;
      points.push([0.5 + Math.cos(angle) * radius, 0.5 + Math.sin(angle) * radius]);
    }
    return [polygon(points)];
  },

  planet(rng) {
    return [
      circle(0.5, 0.5, 0.3),
      ellipse(0.5, 0.5, 0.48, 0.13, 28),
      circle(0.4, 0.42, 0.06, 12),
      circle(0.6, 0.58, 0.045, 12),
      stroke([[0.3, 0.62], [0.42, 0.66]], { weight: DETAIL_WEIGHT }),
    ];
  },

  rocket(rng) {
    return [
      polygon([[0.5, 0.02], [0.68, 0.3], [0.68, 0.72], [0.32, 0.72], [0.32, 0.3]]),
      polygon([[0.32, 0.5], [0.14, 0.78], [0.32, 0.72]]),
      polygon([[0.68, 0.5], [0.86, 0.78], [0.68, 0.72]]),
      circle(0.5, 0.36, 0.09, 16, { fill: true }),
      stroke([[0.42, 0.78], [0.5, 0.94], [0.58, 0.78]]),
      stroke([[0.4, 0.86], [0.5, 0.99], [0.6, 0.86]], { weight: DETAIL_WEIGHT }),
    ];
  },

  moon(rng) {
    return [
      circle(0.5, 0.5, 0.4),
      circle(0.38, 0.4, 0.08, 14),
      circle(0.6, 0.56, 0.06, 14),
      circle(0.45, 0.66, 0.05, 14),
    ];
  },

  dinosaur(rng) {
    return [
      ellipse(0.45, 0.6, 0.28, 0.18, 20),
      stroke([[0.62, 0.5], [0.72, 0.3], [0.78, 0.22]]),
      ellipse(0.83, 0.2, 0.1, 0.08, 16),
      stroke([[0.2, 0.62], [0.06, 0.5], [0.02, 0.42]]),
      stroke([[0.35, 0.76], [0.33, 0.93]]),
      stroke([[0.55, 0.76], [0.57, 0.93]]),
      stroke([[0.3, 0.44], [0.34, 0.36], [0.38, 0.44]], { weight: DETAIL_WEIGHT }),
      stroke([[0.42, 0.42], [0.46, 0.34], [0.5, 0.42]], { weight: DETAIL_WEIGHT }),
      circle(0.86, 0.18, 0.015, 8),
    ];
  },

  fish(rng) {
    return [
      ellipse(0.45, 0.5, 0.3, 0.2, 22),
      polygon([[0.75, 0.5], [0.96, 0.32], [0.96, 0.68]]),
      circle(0.3, 0.44, 0.03, 10),
      stroke([[0.45, 0.3], [0.5, 0.18], [0.58, 0.3]], { weight: DETAIL_WEIGHT }),
      stroke([[0.4, 0.5], [0.55, 0.5]], { weight: DETAIL_WEIGHT }),
    ];
  },

  shell(rng) {
    const lines = [arc(0.5, 0.85, 0.42, 200, 340, 24)];
    for (let i = 0; i <= 6; i += 1) {
      const angle = 200 + (140 * i) / 6;
      const rad = (angle * Math.PI) / 180;
      lines.push(
        stroke([
          [0.5, 0.85],
          [0.5 + Math.cos(rad) * 0.42, 0.85 + Math.sin(rad) * 0.42],
        ], { weight: DETAIL_WEIGHT }),
      );
    }
    return lines;
  },

  wave(rng) {
    const lines = [];
    for (let row = 0; row < 3; row += 1) {
      const y = 0.3 + row * 0.22;
      const points = [];
      for (let i = 0; i <= 24; i += 1) {
        const x = i / 24;
        points.push([x, y + Math.sin(x * Math.PI * 4) * 0.06]);
      }
      lines.push(stroke(points));
    }
    return lines;
  },

  flower(rng) {
    const lines = [stroke([[0.5, 0.55], [0.5, 0.98]])];
    for (let i = 0; i < 6; i += 1) {
      const angle = (i / 6) * Math.PI * 2;
      lines.push(
        ellipse(0.5 + Math.cos(angle) * 0.18, 0.35 + Math.sin(angle) * 0.18, 0.12, 0.12, 16),
      );
    }
    lines.push(circle(0.5, 0.35, 0.08, 14));
    lines.push(stroke([[0.5, 0.72], [0.68, 0.64], [0.72, 0.76], [0.5, 0.8]], { weight: DETAIL_WEIGHT }));
    return lines;
  },

  tree(rng) {
    return [
      stroke([[0.44, 0.98], [0.44, 0.6]]),
      stroke([[0.56, 0.98], [0.56, 0.6]]),
      arc(0.5, 0.42, 0.34, 180, 360, 20),
      arc(0.32, 0.5, 0.18, 90, 270, 16),
      arc(0.68, 0.5, 0.18, 270, 450, 16),
      stroke([[0.32, 0.6], [0.68, 0.6]]),
    ];
  },

  butterfly(rng) {
    return [
      ellipse(0.5, 0.5, 0.05, 0.26, 14),
      ellipse(0.3, 0.36, 0.2, 0.16, 18),
      ellipse(0.7, 0.36, 0.2, 0.16, 18),
      ellipse(0.34, 0.66, 0.15, 0.13, 18),
      ellipse(0.66, 0.66, 0.15, 0.13, 18),
      stroke([[0.5, 0.26], [0.42, 0.1]], { weight: DETAIL_WEIGHT }),
      stroke([[0.5, 0.26], [0.58, 0.1]], { weight: DETAIL_WEIGHT }),
      circle(0.42, 0.08, 0.02, 8),
      circle(0.58, 0.08, 0.02, 8),
    ];
  },

  cloud(rng) {
    return [
      arc(0.32, 0.55, 0.18, 180, 360, 16),
      arc(0.5, 0.45, 0.24, 180, 360, 18),
      arc(0.7, 0.55, 0.18, 180, 360, 16),
      stroke([[0.14, 0.55], [0.88, 0.55]]),
    ];
  },

  sun(rng) {
    const lines = [circle(0.5, 0.5, 0.26, 22)];
    for (let i = 0; i < 8; i += 1) {
      const angle = (i / 8) * Math.PI * 2;
      lines.push(
        stroke([
          [0.5 + Math.cos(angle) * 0.34, 0.5 + Math.sin(angle) * 0.34],
          [0.5 + Math.cos(angle) * 0.48, 0.5 + Math.sin(angle) * 0.48],
        ]),
      );
    }
    return lines;
  },

  house(rng) {
    return [
      polygon([[0.16, 0.5], [0.16, 0.94], [0.84, 0.94], [0.84, 0.5]]),
      polygon([[0.08, 0.52], [0.5, 0.12], [0.92, 0.52]], { fill: true }),
      polygon([[0.42, 0.94], [0.42, 0.68], [0.58, 0.68], [0.58, 0.94]], { fill: true }),
      polygon([[0.22, 0.6], [0.34, 0.6], [0.34, 0.72], [0.22, 0.72]]),
      stroke([[0.66, 0.62], [0.78, 0.62]], { weight: DETAIL_WEIGHT }),
      stroke([[0.66, 0.7], [0.78, 0.7]], { weight: DETAIL_WEIGHT }),
    ];
  },

  balloon(rng) {
    return [
      ellipse(0.5, 0.36, 0.26, 0.32, 22),
      polygon([[0.44, 0.68], [0.56, 0.68], [0.5, 0.76]]),
      stroke([[0.5, 0.76], [0.46, 0.88], [0.54, 0.98]]),
      stroke([[0.38, 0.24], [0.44, 0.16]], { weight: DETAIL_WEIGHT }),
    ];
  },

  cat(rng) {
    return [
      circle(0.5, 0.55, 0.3, 22),
      polygon([[0.26, 0.36], [0.24, 0.1], [0.46, 0.28]]),
      polygon([[0.74, 0.36], [0.76, 0.1], [0.54, 0.28]]),
      circle(0.4, 0.5, 0.035, 10),
      circle(0.6, 0.5, 0.035, 10),
      polygon([[0.46, 0.62], [0.54, 0.62], [0.5, 0.68]]),
      stroke([[0.5, 0.68], [0.5, 0.74]], { weight: DETAIL_WEIGHT }),
      stroke([[0.3, 0.62], [0.12, 0.58]], { weight: DETAIL_WEIGHT }),
      stroke([[0.3, 0.68], [0.12, 0.7]], { weight: DETAIL_WEIGHT }),
      stroke([[0.7, 0.62], [0.88, 0.58]], { weight: DETAIL_WEIGHT }),
      stroke([[0.7, 0.68], [0.88, 0.7]], { weight: DETAIL_WEIGHT }),
    ];
  },

  dog(rng) {
    return [
      circle(0.5, 0.52, 0.3, 22),
      ellipse(0.24, 0.5, 0.1, 0.22, 16),
      ellipse(0.76, 0.5, 0.1, 0.22, 16),
      circle(0.4, 0.46, 0.035, 10),
      circle(0.6, 0.46, 0.035, 10),
      ellipse(0.5, 0.66, 0.12, 0.09, 16),
      circle(0.5, 0.62, 0.04, 10),
      stroke([[0.5, 0.66], [0.5, 0.72]], { weight: DETAIL_WEIGHT }),
      stroke([[0.44, 0.74], [0.5, 0.78], [0.56, 0.74]], { weight: DETAIL_WEIGHT }),
    ];
  },

  car(rng) {
    return [
      polygon([[0.06, 0.66], [0.06, 0.5], [0.24, 0.5], [0.34, 0.3], [0.66, 0.3], [0.76, 0.5], [0.94, 0.5], [0.94, 0.66]]),
      circle(0.28, 0.68, 0.1, 16, { fill: true }),
      circle(0.72, 0.68, 0.1, 16, { fill: true }),
      stroke([[0.38, 0.34], [0.38, 0.48]], { weight: DETAIL_WEIGHT }),
      stroke([[0.62, 0.34], [0.62, 0.48]], { weight: DETAIL_WEIGHT }),
      stroke([[0.06, 0.56], [0.94, 0.56]], { weight: DETAIL_WEIGHT }),
    ];
  },

  mountain(rng) {
    return [
      polygon([[0.02, 0.92], [0.34, 0.24], [0.66, 0.92]]),
      polygon([[0.42, 0.92], [0.7, 0.4], [0.98, 0.92]]),
      stroke([[0.24, 0.46], [0.34, 0.36], [0.44, 0.46]], { weight: DETAIL_WEIGHT }),
      stroke([[0.62, 0.58], [0.7, 0.5], [0.78, 0.58]], { weight: DETAIL_WEIGHT }),
    ];
  },

  rainbow(rng) {
    const lines = [];
    for (let i = 0; i < 4; i += 1) {
      lines.push(arc(0.5, 0.86, 0.44 - i * 0.09, 180, 360, 24));
    }
    return lines;
  },

  bird(rng) {
    return [
      ellipse(0.46, 0.52, 0.26, 0.18, 20),
      circle(0.74, 0.38, 0.12, 16),
      polygon([[0.86, 0.38], [0.98, 0.44], [0.86, 0.48]]),
      circle(0.78, 0.34, 0.025, 8),
      stroke([[0.4, 0.44], [0.3, 0.26], [0.52, 0.36]], { weight: DETAIL_WEIGHT }),
      polygon([[0.24, 0.56], [0.04, 0.46], [0.06, 0.62]]),
      stroke([[0.44, 0.68], [0.42, 0.82]], { weight: DETAIL_WEIGHT }),
      stroke([[0.54, 0.68], [0.56, 0.82]], { weight: DETAIL_WEIGHT }),
    ];
  },

  boat(rng) {
    return [
      polygon([[0.08, 0.66], [0.92, 0.66], [0.78, 0.86], [0.22, 0.86]]),
      stroke([[0.5, 0.66], [0.5, 0.1]]),
      polygon([[0.54, 0.14], [0.54, 0.6], [0.86, 0.6]]),
      polygon([[0.46, 0.2], [0.46, 0.6], [0.2, 0.6]]),
      stroke([[0.02, 0.92], [0.98, 0.92]], { weight: DETAIL_WEIGHT }),
    ];
  },

  robot(rng) {
    return [
      polygon([[0.3, 0.16], [0.7, 0.16], [0.7, 0.42], [0.3, 0.42]]),
      circle(0.4, 0.28, 0.04, 10),
      circle(0.6, 0.28, 0.04, 10),
      stroke([[0.42, 0.36], [0.58, 0.36]], { weight: DETAIL_WEIGHT }),
      stroke([[0.5, 0.16], [0.5, 0.06]]),
      circle(0.5, 0.04, 0.03, 8),
      polygon([[0.34, 0.46], [0.66, 0.46], [0.66, 0.78], [0.34, 0.78]]),
      stroke([[0.34, 0.54], [0.16, 0.62]]),
      stroke([[0.66, 0.54], [0.84, 0.62]]),
      stroke([[0.42, 0.78], [0.42, 0.94]]),
      stroke([[0.58, 0.78], [0.58, 0.94]]),
    ];
  },

  cupcake(rng) {
    const lines = [
      polygon([[0.24, 0.5], [0.76, 0.5], [0.68, 0.94], [0.32, 0.94]]),
      arc(0.5, 0.5, 0.26, 180, 360, 18),
      arc(0.36, 0.42, 0.14, 180, 360, 14),
      arc(0.64, 0.42, 0.14, 180, 360, 14),
      circle(0.5, 0.16, 0.07, 12),
    ];
    for (let i = 1; i < 4; i += 1) {
      const x = 0.24 + (0.52 * i) / 4;
      lines.push(stroke([[x, 0.54], [x + 0.02, 0.9]], { weight: DETAIL_WEIGHT }));
    }
    return lines;
  },

  snowflake(rng) {
    const lines = [];
    for (let i = 0; i < 6; i += 1) {
      const angle = (i / 6) * Math.PI * 2;
      const dx = Math.cos(angle);
      const dy = Math.sin(angle);
      lines.push(stroke([[0.5, 0.5], [0.5 + dx * 0.46, 0.5 + dy * 0.46]]));
      for (const t of [0.24, 0.36]) {
        const bx = 0.5 + dx * t;
        const by = 0.5 + dy * t;
        const spread = 0.1;
        lines.push(
          stroke([
            [bx + Math.cos(angle + 0.9) * spread, by + Math.sin(angle + 0.9) * spread],
            [bx, by],
            [bx + Math.cos(angle - 0.9) * spread, by + Math.sin(angle - 0.9) * spread],
          ], { weight: DETAIL_WEIGHT }),
        );
      }
    }
    return lines;
  },
};

/** Every motif this module can draw, in vocabulary order. */
export const MOTIF_NAMES = Object.freeze(Object.keys(MOTIF_GENERATORS));

/**
 * Draw one motif.
 *
 * @param {string} name
 * @param {() => number} rng
 * @returns {{ name: string, polylines: Array<object>, bounds: { x: number, y: number, w: number, h: number } }}
 */
export function drawMotif(name, rng) {
  const generator = MOTIF_GENERATORS[name];
  if (!generator) {
    throw new Error(`unknown motif: ${name}`);
  }
  const polylines = generator(rng);
  return { name, polylines, bounds: computeBounds(polylines) };
}
