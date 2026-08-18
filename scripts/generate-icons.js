import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

function createCrcTable() {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      if (c & 1) {
        c = 0xedb88320 ^ (c >>> 1);
      } else {
        c = c >>> 1;
      }
    }
    table[n] = c;
  }
  return table;
}

const crcTable = createCrcTable();

function calculateCrc(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function createChunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);

  const crcTarget = Buffer.concat([typeBuf, data]);
  const crc = calculateCrc(crcTarget);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc, 0);

  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function encodePng(width, height, rgbaBuffer) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData.writeUInt8(8, 8); // 8 bit depth
  ihdrData.writeUInt8(6, 9); // RGBA
  ihdrData.writeUInt8(0, 10); // Compression
  ihdrData.writeUInt8(0, 11); // Filter
  ihdrData.writeUInt8(0, 12); // Interlace
  const ihdrChunk = createChunk('IHDR', ihdrData);

  // Scanlines with filter byte 0 (None)
  const rowSize = width * 4;
  const scanlines = Buffer.alloc(height * (rowSize + 1));
  for (let y = 0; y < height; y++) {
    const scanlineOffset = y * (rowSize + 1);
    scanlines[scanlineOffset] = 0; // Filter: None
    rgbaBuffer.copy(
      scanlines,
      scanlineOffset + 1,
      y * rowSize,
      (y + 1) * rowSize,
    );
  }

  const compressedData = zlib.deflateSync(scanlines, { level: 9 });
  const idatChunk = createChunk('IDAT', compressedData);
  const iendChunk = createChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

// Color helper
function lerp(a, b, t) {
  return a + (b - a) * t;
}

function lerpColor(c1, c2, t) {
  return [
    Math.round(lerp(c1[0], c2[0], t)),
    Math.round(lerp(c1[1], c2[1], t)),
    Math.round(lerp(c1[2], c2[2], t)),
    Math.round(lerp(c1[3] ?? 255, c2[3] ?? 255, t)),
  ];
}

// Distance to rounded rectangle (squircle SDF)
function sdRoundedRect(px, py, rx, ry, rw, rh, radius) {
  const cx = rx + rw / 2;
  const cy = ry + rh / 2;
  const hx = rw / 2 - radius;
  const hy = rh / 2 - radius;

  const dx = Math.abs(px - cx) - hx;
  const dy = Math.abs(py - cy) - hy;

  const outX = Math.max(dx, 0);
  const outY = Math.max(dy, 0);
  const distOut = Math.sqrt(outX * outX + outY * outY);
  const distIn = Math.min(Math.max(dx, dy), 0);

  return distOut + distIn - radius;
}

function distToSegment(px, py, x1, y1, x2, y2) {
  const l2 = (x2 - x1) * (x2 - x1) + (y2 - y1) * (y2 - y1);
  if (l2 === 0) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * (x2 - x1) + (py - y1) * (y2 - y1)) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * (x2 - x1)), py - (y1 + t * (y2 - y1)));
}

// Alpha blend
function blendPixel(buf, width, x, y, r, g, b, a) {
  if (x < 0 || x >= width || y < 0) return;
  const idx = (y * width + x) * 4;
  const srcA = a / 255;
  const dstA = buf[idx + 3] / 255;

  const outA = srcA + dstA * (1 - srcA);
  if (outA <= 0) return;

  buf[idx] = Math.round((r * srcA + buf[idx] * dstA * (1 - srcA)) / outA);
  buf[idx + 1] = Math.round(
    (g * srcA + buf[idx + 1] * dstA * (1 - srcA)) / outA,
  );
  buf[idx + 2] = Math.round(
    (b * srcA + buf[idx + 2] * dstA * (1 - srcA)) / outA,
  );
  buf[idx + 3] = Math.round(outA * 255);
}

function renderAppIcon(size) {
  const buf = Buffer.alloc(size * size * 4, 0);
  const scale = size / 512;
  const radius = 108 * scale;
  const margin = 24 * scale;
  const boxSize = 464 * scale;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Subsampling 2x2 for smooth antialiasing
      let rSum = 0,
        gSum = 0,
        bSum = 0,
        aSum = 0;

      for (let sy = 0; sy < 2; sy++) {
        for (let sx = 0; sx < 2; sx++) {
          const px = x + (sx + 0.5) / 2;
          const py = y + (sy + 0.5) / 2;

          // 1. Squircle container SDF
          const dSquircle = sdRoundedRect(
            px,
            py,
            margin,
            margin,
            boxSize,
            boxSize,
            radius,
          );

          if (dSquircle > 0.5) {
            // Outside icon
            continue;
          }

          // Antialiasing edge factor
          const aa = Math.max(0, Math.min(1, 0.5 - dSquircle));

          // Background Gradient (Deep Navy -> Midnight Indigo -> Obsidian)
          const diagT = (px + py) / (size * 2);
          let bgCol = lerpColor([15, 23, 42, 255], [30, 27, 75, 255], diagT);
          if (diagT > 0.5) {
            bgCol = lerpColor(
              [30, 27, 75, 255],
              [9, 13, 22, 255],
              (diagT - 0.5) * 2,
            );
          }

          // Center Ambient Glow (Electric Cyan / Indigo)
          const cx = size * 0.5;
          const cy = size * 0.46;
          const glowDist = Math.hypot(px - cx, py - cy) / (size * 0.55);
          if (glowDist < 1.0) {
            const glowStrength = Math.pow(1.0 - glowDist, 1.8) * 0.45;
            bgCol = lerpColor(bgCol, [56, 189, 248, 255], glowStrength);
          }

          // Top Specular Curved Gloss
          const glossDist = Math.hypot(px - size * 0.5, py - size * 0.1) / (size * 0.6);
          if (glossDist < 0.7 && py < size * 0.48) {
            const glossT = Math.pow(1.0 - glossDist / 0.7, 2.0) * 0.22;
            bgCol = lerpColor(bgCol, [255, 255, 255, 255], glossT);
          }

          // Subtle Glowing Border
          if (Math.abs(dSquircle) < 2.5 * scale) {
            const borderAlpha = Math.max(
              0,
              1 - Math.abs(dSquircle) / (2.5 * scale),
            );
            const borderCol = lerpColor(
              [56, 189, 248, 255],
              [244, 63, 94, 255],
              (px + py) / (size * 2),
            );
            bgCol = lerpColor(bgCol, borderCol, borderAlpha * 0.6);
          }

          // 2. Render Glyphs: U-ribbon, E-ribbon, Soundwaves, Sparkle Star
          // Normalize coordinates to 0..512 space
          const nx = px / scale;
          const ny = py / scale;

          let glyphColor = null;
          let glyphAlpha = 0;

          // (A) U Ribbon (Cyan to Blue)
          // Left stem
          const dULeft = distToSegment(nx, ny, 162, 140, 162, 270) - 16;
          // Right stem
          const dURight = distToSegment(nx, ny, 390, 240, 390, 270) - 16;
          // Bottom Arc
          const arcDx = nx - 276;
          const arcDy = ny - 270;
          const arcR = Math.hypot(arcDx, arcDy);
          const inArcAngle = arcDy > 0;
          const dUArc = inArcAngle ? Math.abs(arcR - 114) - 16 : 999;

          const dU = Math.min(dULeft, dURight, dUArc);
          if (dU < 1.0) {
            const uA = Math.max(0, Math.min(1, 1.0 - dU));
            const uT = Math.min(1.0, Math.max(0, (ny - 120) / 280));
            const uCol = lerpColor([56, 189, 248, 255], [99, 102, 241, 255], uT);
            glyphColor = uCol;
            glyphAlpha = uA;
          }

          // (B) E Ribbon (Coral Flame to Amber Gold)
          // E Top Bar
          const dETop = distToSegment(nx, ny, 215, 206, 372, 206) - 14;
          // E Middle Bar
          const dEMid = distToSegment(nx, ny, 215, 264, 348, 264) - 14;
          // E Bottom Bar
          const dEBot = distToSegment(nx, ny, 215, 328, 372, 328) - 14;
          // E Spine
          const dESpine = distToSegment(nx, ny, 215, 206, 215, 328) - 14;

          const dE = Math.min(dETop, dEMid, dEBot, dESpine);
          if (dE < 1.0) {
            const eA = Math.max(0, Math.min(1, 1.0 - dE));
            const eT = Math.min(1.0, Math.max(0, (nx - 200) / 180));
            const eCol = lerpColor([251, 113, 133, 255], [251, 146, 60, 255], eT);

            if (!glyphColor || eA > glyphAlpha) {
              glyphColor = eCol;
              glyphAlpha = Math.max(glyphAlpha, eA);
            } else {
              glyphColor = lerpColor(glyphColor, eCol, eA);
            }
          }

          // (C) Soundwave Voice Bars inside the U
          const soundBars = [
            { x: 212, y: 154, w: 7, h: 22, col: [56, 189, 248, 220] },
            { x: 226, y: 142, w: 7, h: 44, col: [103, 232, 249, 255] },
            { x: 240, y: 148, w: 7, h: 32, col: [56, 189, 248, 240] },
            { x: 254, y: 156, w: 7, h: 16, col: [129, 140, 248, 200] },
          ];

          for (const sb of soundBars) {
            const dSb = sdRoundedRect(nx, ny, sb.x, sb.y, sb.w, sb.h, 3.5);
            if (dSb < 1.0) {
              const sbA = Math.max(0, Math.min(1, 1.0 - dSb));
              if (!glyphColor || sbA > glyphAlpha) {
                glyphColor = sb.col;
                glyphAlpha = Math.max(glyphAlpha, sbA);
              }
            }
          }

          // (D) Sparkling Star (✦) Top Right
          const starCx = 384;
          const starCy = 144;
          const starDx = Math.abs(nx - starCx);
          const starDy = Math.abs(ny - starCy);
          const starR = 30;
          const dStarCurve = Math.pow(starDx / starR, 0.5) + Math.pow(starDy / starR, 0.5) - 1.0;
          if (dStarCurve < 0.1 && starDx < starR && starDy < starR) {
            const starA = Math.max(0, Math.min(1, (0.1 - dStarCurve) * 8));
            const starCol = lerpColor([255, 255, 255, 255], [56, 189, 248, 255], Math.hypot(starDx, starDy) / starR);
            if (!glyphColor || starA > glyphAlpha) {
              glyphColor = starCol;
              glyphAlpha = Math.max(glyphAlpha, starA);
            }
          }

          // Combine Glyph onto Background
          let pixelColor = bgCol;
          if (glyphColor && glyphAlpha > 0) {
            pixelColor = lerpColor(pixelColor, glyphColor, glyphAlpha);
          }

          rSum += pixelColor[0] * aa;
          gSum += pixelColor[1] * aa;
          bSum += pixelColor[2] * aa;
          aSum += 255 * aa;
        }
      }

      const idx = (y * size + x) * 4;
      buf[idx] = Math.round(rSum / 4);
      buf[idx + 1] = Math.round(gSum / 4);
      buf[idx + 2] = Math.round(bSum / 4);
      buf[idx + 3] = Math.round(aSum / 4);
    }
  }

  return buf;
}

const iconsDir = path.resolve('public/icons');
fs.mkdirSync(iconsDir, { recursive: true });

const sizes = [128, 48, 16];
for (const s of sizes) {
  console.log(`Generating icon${s}.png...`);
  const rawRgba = renderAppIcon(s);
  const pngData = encodePng(s, s, rawRgba);
  fs.writeFileSync(path.join(iconsDir, `icon${s}.png`), pngData);
  console.log(`Saved icon${s}.png (${pngData.length} bytes)`);
}

console.log('All icons generated successfully!');
