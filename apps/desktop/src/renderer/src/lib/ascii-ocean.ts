type Vec3 = readonly [number, number, number];
type Sample = { position: Vec3; normal: Vec3; ink: number };
const TAU = Math.PI * 2;
const GLYPHS = ".,:;i!ltfx%S8@";

function normal([x, y, z]: Vec3): Vec3 {
  const length = Math.hypot(x, y, z) || 1;
  return [x / length, y / length, z / length];
}

// Original shark geometry. Rounded bodies and swept fins turn in 3D, then the
// visible surfaces are reduced to a grid of shaded characters.
function sharkSurface(): Sample[] {
  const samples: Sample[] = [];
  const rings = [
    [-1.35, .015], [-1.22, .13], [-1.02, .235], [-.75, .285],
    [-.4, .28], [0, .23], [.4, .14], [.8, .065], [1.1, .035],
  ];
  for (let ring = 0; ring < rings.length - 1; ring++) {
    const [x0, r0] = rings[ring];
    const [x1, r1] = rings[ring + 1];
    const steps = Math.ceil((x1 - x0) * 65);
    for (let step = 0; step < steps; step++) {
      const t = step / steps;
      const x = x0 + (x1 - x0) * t;
      const radius = r0 + (r1 - r0) * t;
      for (let a = 0; a < 84; a++) {
        const theta = a / 84 * TAU;
        const y = Math.cos(theta) * radius;
        const z = Math.sin(theta) * radius * .85;
        const gill = x > -.83 && x < -.45 && Math.sin(theta) > .65 && Math.cos(theta) < .6
          && Math.floor((x + .83) * 55) % 4 === 0;
        const mouth = x < -.98 && Math.abs(Math.cos(theta) + .38) < .075;
        samples.push({
          position: [x, y, z],
          normal: normal([-(r1 - r0) / (x1 - x0), Math.cos(theta), Math.sin(theta)]),
          ink: gill || mouth ? .95 : Math.cos(theta) < -.35 ? .22 : .6,
        });
      }
    }
  }
  const fin = (a: Vec3, b: Vec3, c: Vec3, ink: number) => {
    const ab = b.map((v, i) => v - a[i]);
    const ac = c.map((v, i) => v - a[i]);
    const n = normal([ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]]);
    for (let i = 0; i <= 48; i++) {
      for (let j = 0; j <= 48 - i; j++) {
        const u = i / 48, v = j / 48;
        samples.push({ position: [
          a[0] + ab[0] * u + ac[0] * v,
          a[1] + ab[1] * u + ac[1] * v,
          a[2] + ab[2] * u + ac[2] * v,
        ], normal: n, ink });
      }
    }
  };
  fin([-.5, .24, 0], [-.16, .91, .015], [.35, .19, 0], .64);
  fin([-.6, -.1, .19], [.38, -.33, .94], [.26, -.16, .13], .54);
  fin([-.6, -.1, -.19], [.38, -.33, -.94], [.26, -.16, -.13], .54);
  fin([.43, -.1, .09], [.82, -.29, .36], [.8, -.04, .06], .47);
  fin([.43, -.1, -.09], [.82, -.29, -.36], [.8, -.04, -.06], .47);
  fin([.92, 0, 0], [1.57, .79, .025], [1.29, -.025, 0], .65);
  fin([1.01, 0, 0], [1.47, -.48, .025], [1.29, .025, 0], .6);
  for (const side of [-1, 1]) {
    for (let i = 0; i < 24; i++) {
      const a = i / 24 * TAU;
      samples.push({ position: [-1.075 + Math.cos(a) * .027, .075 + Math.sin(a) * .027, side * .185], normal: [0, 0, side], ink: 1 });
    }
  }
  return samples;
}

let surface: Sample[] | undefined;

export function createAsciiOcean(canvas: HTMLCanvasElement, clock: { time: number }, paused: boolean, dark: boolean) {
  const context = canvas.getContext("2d", { alpha: true });
  if (!context) return () => {};
  const ctx = context;
  const mesh = surface ??= sharkSurface();
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const cellWidth = 7, cellHeight = 9;
  let width = 0, height = 0, columns = 0, rows = 0;
  let frame = 0, previous = 0, disposed = false;
  let depths = new Float32Array(0), shades = new Float32Array(0), tints = new Uint8Array(0);

  const draw = () => {
    if (!width || !height) return;
    ctx.clearRect(0, 0, width, height);
    depths.fill(-Infinity);
    shades.fill(0);
    const t = clock.time;
    // x, y, length, rotation, yaw, tint. Offsets compose the first frame.
    const sharks = [
      [.16, .2, .29, -.6, .6, 1],
      [.9, .12, .28, 2.2, -.5, 0],
      [.6, .56, .46, 1.12, .7, 0],
      [.09, .87, .37, -1.1, -.45, 0],
      [.72, 1.02, .3, -.72, .6, 1],
      [.49, -.07, .21, 1.5, -.55, 1],
    ];
    for (let fish = 0; fish < (width < 700 ? 3 : sharks.length); fish++) {
      const [x, y, length, angle, yaw, tint] = sharks[fish];
      const phase = fish * 1.93;
      const travelX = -Math.cos(angle) * t * .0015;
      const travelY = Math.sin(angle) * t * .0015;
      const px = (((x + travelX + .45) % 1.9 + 1.9) % 1.9 - .45) * width;
      const py = ((((y + travelY + .45) % 1.9 + 1.9) % 1.9 - .45) + Math.sin(t * .045 + phase) * .035) * height;
      const scale = Math.min(width, height * 1.5) * length / 3;
      const roll = angle + Math.sin(t * .065 + phase) * .16;
      const turn = yaw + Math.sin(t * .09 + phase) * .38;
      const cr = Math.cos(roll), sr = Math.sin(roll), cy = Math.cos(turn), sy = Math.sin(turn);
      const pitch = .32 + Math.sin(t * .07 + phase) * .2;
      const cp = Math.cos(pitch), sp = Math.sin(pitch);
      const rotate = (x: number, y: number, z: number): Vec3 => {
        const xx = x * cy + z * sy, zz = z * cy - x * sy;
        const yy = y * cp - zz * sp, zzz = y * sp + zz * cp;
        return [xx * cr - yy * sr, xx * sr + yy * cr, zzz];
      };
      for (const sample of mesh) {
        const [sx, sy0, sz] = sample.position;
        const tail = Math.max(0, (sx + .5) / 2);
        const wave = Math.sin(sx * 3 - t * 1.75 + phase) * .17 * tail * tail;
        const [rx, ry, rz] = rotate(sx, sy0, sz + wave);
        const gx = Math.floor((px + rx * scale) / cellWidth);
        const gy = Math.floor((py - ry * scale) / cellHeight);
        if (gx < 0 || gx >= columns || gy < 0 || gy >= rows) continue;
        const index = gy * columns + gx;
        if (rz < depths[index]) continue;
        depths[index] = rz;
        const [nx, ny, nz] = rotate(...sample.normal);
        const light = Math.abs(nx * -.3 + ny * .55 + nz * .78);
        shades[index] = Math.min(1, sample.ink * .7 + light * .3);
        tints[index] = tint;
      }
    }
    // Sparse plankton; deterministic positions avoid random per-frame flicker.
    ctx.font = '8px "Consolas", "Courier New", monospace';
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (let i = 0; i < Math.round(width * height / 5700); i++) {
      const x = ((i * 61.8034) % 100) / 100 * width;
      const y = (((i * 37.719 + t * .035) % 100) / 100) * height;
      ctx.fillStyle = `rgba(${dark ? "149, 164, 139" : "115, 122, 116"}, ${.12 + i % 4 * .045})`;
      ctx.fillText(i % 7 === 0 ? "+" : i % 3 === 0 ? ":" : ".", x, y);
    }
    ctx.font = '9px "Consolas", "Courier New", monospace';
    for (let i = 0; i < shades.length; i++) {
      const shade = shades[i];
      if (!shade) continue;
      const x = (i % columns) * cellWidth, y = Math.floor(i / columns) * cellHeight;
      const ink = tints[i] === 1
        ? dark ? "180, 168, 133" : "120, 113, 90"
        : dark ? "138, 169, 178" : "100, 119, 129";
      const grain = (i * 17 + Math.floor(i / columns) * 13) % 11;
      if (grain < 5 && shade > .4) {
        ctx.fillStyle = `rgba(${ink}, ${.12 + shade * .28})`;
        ctx.fillRect(x + .5, y + .5, cellWidth - 1, cellHeight - 1);
      }
      ctx.fillStyle = `rgba(${ink}, ${.24 + shade * .44})`;
      const glyph = GLYPHS[Math.min(GLYPHS.length - 1, Math.floor(shade * (GLYPHS.length - 1) + (grain % 3 - 1)))];
      ctx.fillText(glyph, x + cellWidth / 2, y + cellHeight / 2);
    }
  };
  const resize = () => {
    const bounds = canvas.getBoundingClientRect();
    width = bounds.width; height = bounds.height;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    columns = Math.ceil(width / cellWidth); rows = Math.ceil(height / cellHeight);
    depths = new Float32Array(columns * rows);
    shades = new Float32Array(columns * rows);
    tints = new Uint8Array(columns * rows);
    draw();
  };
  const tick = (now: number) => {
    if (disposed) return;
    if (!previous || now - previous >= 80) {
      clock.time += previous ? Math.min((now - previous) / 1000, .2) : 0;
      previous = now;
      draw();
    }
    frame = requestAnimationFrame(tick);
  };
  const sync = () => {
    cancelAnimationFrame(frame);
    previous = 0;
    if (!paused && !reduced.matches && !document.hidden && !disposed) frame = requestAnimationFrame(tick);
    else draw();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  reduced.addEventListener("change", sync);
  document.addEventListener("visibilitychange", sync);
  resize(); sync();
  return () => {
    disposed = true;
    cancelAnimationFrame(frame);
    observer.disconnect();
    reduced.removeEventListener("change", sync);
    document.removeEventListener("visibilitychange", sync);
  };
}
