import type { Writable } from 'node:stream';

import pc from 'picocolors';

const DEPTH_STEPS = 42;
const SHADE_COLORS = [24, 30, 36, 37, 43, 44, 50, 80, 116, 153, 195] as const;

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function lerp(start: number, end: number, amount: number): number {
  return start + (end - start) * amount;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function ellipsoid(
  x: number,
  y: number,
  z: number,
  cx: number,
  cy: number,
  cz: number,
  rx: number,
  ry: number,
  rz: number,
): number {
  return 1
    - ((x - cx) / rx) ** 2
    - ((y - cy) / ry) ** 2
    - ((z - cz) / rz) ** 2;
}

function brainField(x: number, y: number, z: number): number {
  const cerebrum = Math.max(
    ellipsoid(x, y, z, -0.05, 0.23, 0.00, 1.12, 0.83, 0.70),
    ellipsoid(x, y, z, 0.78, 0.22, -0.01, 0.73, 0.70, 0.61),
    ellipsoid(x, y, z, 0.48, 0.66, 0.00, 0.72, 0.50, 0.61),
    ellipsoid(x, y, z, -0.18, 0.72, 0.00, 0.85, 0.48, 0.64),
    ellipsoid(x, y, z, -0.94, 0.20, -0.02, 0.58, 0.66, 0.57),
    ellipsoid(x, y, z, 0.10, -0.34, 0.02, 0.87, 0.47, 0.57),
    ellipsoid(x, y, z, 0.68, -0.18, 0.01, 0.58, 0.45, 0.52),
  )
    + 0.033 * Math.sin(10.0 * x + 2.5 * Math.sin(4.2 * y) + 1.5 * z)
    + 0.024 * Math.sin(13.0 * y - 2.3 * Math.sin(3.7 * x) + 1.2 * z)
    + 0.012 * Math.sin(18.0 * x + 9.0 * y);

  const cerebellum = Math.max(
    ellipsoid(x, y, z, -0.82, -0.63, -0.03, 0.57, 0.40, 0.48),
    ellipsoid(x, y, z, -1.04, -0.57, -0.02, 0.39, 0.34, 0.42),
    ellipsoid(x, y, z, -0.60, -0.68, -0.02, 0.41, 0.34, 0.42),
  ) + 0.025 * Math.sin(24.0 * y + 2.2 * Math.sin(5.0 * x));

  const brainstem = Math.max(
    ellipsoid(x, y, z, -0.32, -0.72, 0.00, 0.30, 0.34, 0.30),
    ellipsoid(x, y, z, -0.28, -1.02, 0.00, 0.20, 0.40, 0.23),
    ellipsoid(x, y, z, -0.24, -1.30, 0.00, 0.13, 0.31, 0.17),
  );

  return Math.max(cerebrum, cerebellum, brainstem);
}

function rotateY(x: number, z: number, angle: number): { x: number; z: number } {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { x: x * c + z * s, z: -x * s + z * c };
}

function binaryBit(x: number, y: number, z: number, frame: number): string {
  const noise = Math.sin(x * 93.31 + y * 131.17 + z * 71.91 + frame * 0.61)
    + 0.5 * Math.sin(x * 173.21 - y * 71.37 + z * 37.11 - frame * 0.37);
  return noise > 0 ? '1' : '0';
}

function grooveStrength(x: number, y: number, z: number): number {
  const gyri = Math.sin(8.5 * x + 2.8 * Math.sin(4.1 * y) + z * 1.7)
    + 0.74 * Math.sin(10.5 * y - 2.2 * Math.sin(3.8 * x) - z)
    + 0.37 * Math.sin(6.2 * x + 8.0 * y + 1.9 * Math.sin(4.0 * x));
  const folded = Math.exp(-((gyri / 0.22) ** 2));
  const sylvianY = -0.07 + 0.17 * (x + 0.25) - 0.065 * Math.sin(3.5 * x);
  const sylvian = x > -0.55 && x < 0.90 ? Math.exp(-(((y - sylvianY) / 0.05) ** 2)) : 0;
  const centralX = 0.20 - 0.16 * Math.sin((y - 0.15) * 2.2);
  const central = y > 0.05 && y < 0.88 ? Math.exp(-(((x - centralX) / 0.045) ** 2)) : 0;
  return clamp(Math.max(folded * 0.60, sylvian * 0.85, central * 0.72), 0, 1);
}

function colorizeBit(bit: string, shade: number, groove: number): string {
  if (process.env.NO_COLOR) return bit;
  const index = clamp(Math.round(shade * (SHADE_COLORS.length - 1)), 0, SHADE_COLORS.length - 1);
  const color = SHADE_COLORS[index]!;
  const dim = groove > 0.52 ? '2;' : '';
  const bold = shade > 0.82 && groove < 0.45 ? '1;' : '';
  return `\x1b[${bold}${dim}38;5;${color}m${bit}\x1b[0m`;
}

function frameSize(output: Writable & { columns?: number }): { width: number; height: number } {
  const columns = output.columns ?? 80;
  const width = clamp(columns - 8, 34, 54);
  return { width, height: clamp(Math.round(width * 0.38), 13, 20) };
}

export function renderMegaBrainLogoFrame(frame = 0, size: { width?: number; height?: number } = {}): string {
  const width = size.width ?? 46;
  const height = size.height ?? 17;
  const angle = (frame / 24) * Math.PI * 2;
  const rows: string[] = [];

  for (let row = 0; row < height; row += 1) {
    const y = lerp(1.14, -1.48, row / Math.max(1, height - 1));
    let line = '';
    for (let column = 0; column < width; column += 1) {
      const x = lerp(-1.58, 1.58, column / Math.max(1, width - 1));
      let hit: { x: number; y: number; z: number; depth: number } | null = null;
      for (let step = 0; step < DEPTH_STEPS; step += 1) {
        const z = lerp(1.12, -1.10, step / (DEPTH_STEPS - 1));
        const rotated = rotateY(x, z, angle);
        if (brainField(rotated.x, y, rotated.z) > 0) {
          hit = { x: rotated.x, y, z: rotated.z, depth: step / (DEPTH_STEPS - 1) };
          break;
        }
      }
      if (!hit) {
        line += ' ';
        continue;
      }
      const groove = grooveStrength(hit.x, hit.y, hit.z);
      const rim = Math.min(Math.abs(column / Math.max(1, width - 1) - 0.5) * 1.4, 0.28);
      const light = 0.18 + (1 - hit.depth) * 0.58 + (1 - Math.abs(y - 0.05) / 1.85) * 0.22 + rim;
      const shade = clamp(light * (1 - groove * 0.55), 0.05, 1);
      line += colorizeBit(binaryBit(hit.x, hit.y, hit.z, frame), shade, groove);
    }
    rows.push(line.trimEnd());
  }

  return `${rows.join('\n')}\n${pc.bold(pc.cyan('Mega Brain'))}\n${pc.dim('MCP knowledge control plane')}`;
}

export async function playMegaBrainLogo(
  output: Writable & { isTTY?: boolean; columns?: number },
  options: { frames?: number; intervalMs?: number; environment?: NodeJS.ProcessEnv } = {},
): Promise<void> {
  const frames = options.frames ?? 24;
  const intervalMs = options.intervalMs ?? 95;
  const environment = options.environment ?? process.env;
  const size = frameSize(output);
  const logoHeight = size.height + 2;
  if (!output.isTTY || /^(?:1|true|yes|on)$/iu.test(environment.MEGA_BRAIN_NO_ANIMATION ?? '')) {
    output.write(`${renderMegaBrainLogoFrame(0, size)}\n\n`);
    return;
  }

  output.write(`${renderMegaBrainLogoFrame(0, size)}\n`);
  for (let index = 1; index < frames; index += 1) {
    await sleep(intervalMs);
    output.write(`\x1b[${logoHeight}F\x1b[J${renderMegaBrainLogoFrame(index, size)}\n`);
  }
  output.write('\n');
}
