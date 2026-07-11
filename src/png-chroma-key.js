import { promises as fs } from "node:fs";
import zlib from "node:zlib";

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const crcTable = Array.from({ length: 256 }, (_, index) => {
  let c = index;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buffers) {
  let crc = 0xffffffff;
  for (const buffer of buffers) {
    for (const byte of buffer) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuffer = Buffer.from(type);
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  typeBuffer.copy(out, 4);
  data.copy(out, 8);
  out.writeUInt32BE(crc32([typeBuffer, data]), 8 + data.length);
  return out;
}

function parsePng(buffer) {
  if (!buffer.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error("PNG 파일이 아닙니다.");
  let offset = 8;
  let ihdr = null;
  const idat = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString("ascii");
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;
    if (type === "IHDR") ihdr = data;
    if (type === "IDAT") idat.push(data);
    if (type === "IEND") break;
  }
  if (!ihdr || idat.length === 0) throw new Error("PNG 필수 청크가 없습니다.");
  return {
    width: ihdr.readUInt32BE(0),
    height: ihdr.readUInt32BE(4),
    bitDepth: ihdr[8],
    colorType: ihdr[9],
    compression: ihdr[10],
    filter: ihdr[11],
    interlace: ihdr[12],
    data: Buffer.concat(idat)
  };
}

function unfilter(raw, width, height, channels) {
  const stride = width * channels;
  const out = Buffer.alloc(width * height * channels);
  let inputOffset = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[inputOffset];
    inputOffset += 1;
    const rowStart = y * stride;
    for (let x = 0; x < stride; x += 1) {
      const left = x >= channels ? out[rowStart + x - channels] : 0;
      const up = y > 0 ? out[rowStart + x - stride] : 0;
      const upLeft = y > 0 && x >= channels ? out[rowStart + x - stride - channels] : 0;
      const value = raw[inputOffset + x];
      let recon = value;
      if (filter === 1) recon = value + left;
      else if (filter === 2) recon = value + up;
      else if (filter === 3) recon = value + Math.floor((left + up) / 2);
      else if (filter === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        recon = value + (pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft);
      } else if (filter !== 0) {
        throw new Error(`지원하지 않는 PNG 필터입니다: ${filter}`);
      }
      out[rowStart + x] = recon & 0xff;
    }
    inputOffset += stride;
  }
  return out;
}

function rgbaRowsToPng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    PNG_SIGNATURE,
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

export async function chromaKeyPngFile(filePath, options = {}) {
  const parsed = parsePng(await fs.readFile(filePath));
  if (parsed.bitDepth !== 8 || parsed.compression !== 0 || parsed.filter !== 0 || parsed.interlace !== 0) {
    throw new Error("8-bit non-interlaced PNG만 지원합니다.");
  }
  if (![2, 6].includes(parsed.colorType)) return false;
  const channels = parsed.colorType === 6 ? 4 : 3;
  const pixels = unfilter(zlib.inflateSync(parsed.data), parsed.width, parsed.height, channels);
  const rgba = Buffer.alloc(parsed.width * parsed.height * 4);
  const [kr, kg, kb] = options.key || [0, 255, 0];
  const tolerance = Number(options.tolerance || 72);
  for (let source = 0, target = 0; source < pixels.length; source += channels, target += 4) {
    const r = pixels[source];
    const g = pixels[source + 1];
    const b = pixels[source + 2];
    const a = channels === 4 ? pixels[source + 3] : 255;
    const distance = Math.hypot(r - kr, g - kg, b - kb);
    rgba[target] = r;
    rgba[target + 1] = g;
    rgba[target + 2] = b;
    rgba[target + 3] = distance <= tolerance ? 0 : a;
  }
  await fs.writeFile(filePath, rgbaRowsToPng(parsed.width, parsed.height, rgba));
  return true;
}

export async function pngAlphaStats(filePath) {
  const parsed = parsePng(await fs.readFile(filePath));
  if (parsed.bitDepth !== 8 || ![2, 6].includes(parsed.colorType)) {
    return { width: parsed.width, height: parsed.height, alphaPixels: 0, opaquePixels: parsed.width * parsed.height };
  }
  const channels = parsed.colorType === 6 ? 4 : 3;
  const pixels = unfilter(zlib.inflateSync(parsed.data), parsed.width, parsed.height, channels);
  let alphaPixels = 0;
  let opaquePixels = 0;
  for (let source = 0; source < pixels.length; source += channels) {
    const alpha = channels === 4 ? pixels[source + 3] : 255;
    if (alpha === 0) alphaPixels += 1;
    if (alpha === 255) opaquePixels += 1;
  }
  return { width: parsed.width, height: parsed.height, alphaPixels, opaquePixels };
}
