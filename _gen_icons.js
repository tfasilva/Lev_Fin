const fs = require("fs");
const zlib = require("zlib");
const path = require("path");

const CRC_TABLE = (() => {
  const t = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}
function encodePNG(width, height, rgb) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const raw = Buffer.alloc((width * 3 + 1) * height);
  let p = 0;
  for (let y = 0; y < height; y++) {
    raw[p++] = 0;
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3;
      raw[p++] = rgb[i];
      raw[p++] = rgb[i + 1];
      raw[p++] = rgb[i + 2];
    }
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

function makeIcon(size, maskable) {
  const rgb = Buffer.alloc(size * size * 3);
  const set = (x, y, r, g, b) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 3;
    rgb[i] = r; rgb[i + 1] = g; rgb[i + 2] = b;
  };
  // fundo gradiente verde da marca
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const t = y / size;
      const r = Math.round(16 + (31 - 16) * t);
      const g = Math.round(42 + (111 - 42) * t);
      const b = Math.round(36 + (84 - 36) * t);
      set(x, y, r, g, b);
    }
  }
  // area de desenho (com padding maior para maskable)
  const pad = maskable ? 0.22 : 0.12;
  const area = size * (1 - pad * 2);
  const ox = size * pad;
  const oy = size * pad;
  const unit = area / 10; // 10 unidades de largura para "LF"
  const white = [245, 248, 246];
  const rect = (gx, gy, gw, gh) => {
    const x0 = Math.round(ox + gx * unit);
    const y0 = Math.round(oy + gy * unit);
    const x1 = Math.round(ox + (gx + gw) * unit);
    const y1 = Math.round(oy + (gy + gh) * unit);
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) set(x, y, white[0], white[1], white[2]);
  };
  // Letra L (col 0..3)
  rect(0, 0, 1.6, 8); // haste
  rect(0, 6.4, 4, 1.6); // base
  // Letra F (col 5..9)
  rect(5, 0, 1.6, 8); // haste
  rect(5, 0, 4.2, 1.6); // topo
  rect(5, 3.2, 3.2, 1.6); // meio
  return encodePNG(size, size, rgb);
}

const outDir = path.join(__dirname, "icons");
fs.writeFileSync(path.join(outDir, "icon-192.png"), makeIcon(192, false));
fs.writeFileSync(path.join(outDir, "icon-512.png"), makeIcon(512, false));
fs.writeFileSync(path.join(outDir, "icon-maskable-512.png"), makeIcon(512, true));
fs.writeFileSync(path.join(outDir, "apple-touch-icon.png"), makeIcon(180, false));
console.log("icons gerados");