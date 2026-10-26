// Just enough zip to fill in an .xlsx template: read the entries, replace a few, write it back.
// Entries that aren't replaced keep their compressed bytes as they are.
import * as zlib from 'node:zlib';

export interface ZipEntry {
  name: string;
  /** The name's bytes as stored, so names are written back exactly. */
  rawName: Buffer;
  method: number;
  crc: number;
  size: number;
  /** Compressed bytes, as stored in the file. */
  stored: Buffer;
  /** DOS time and date, kept so the output only changes when the content does. */
  time: number;
  date: number;
}

let table: Uint32Array | undefined;

/** Table CRC-32, for Node versions before zlib.crc32 (20.15). */
export function crc32Table(data: Uint8Array): number {
  table ??= Uint32Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  let c = 0xffffffff;
  for (const b of data) c = table[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function crc32(data: Uint8Array): number {
  return typeof zlib.crc32 === 'function' ? zlib.crc32(data) >>> 0 : crc32Table(data);
}

/** Reads the entries from the central directory (local headers may leave sizes to a data descriptor). */
export function readZip(buf: Buffer): ZipEntry[] {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('not a zip file');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const entries: ZipEntry[] = [];
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('broken zip directory');
    const flags = buf.readUInt16LE(p + 8);
    const csize = buf.readUInt32LE(p + 20);
    const size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const local = buf.readUInt32LE(p + 42);
    if (flags & 1) throw new Error('encrypted zip');
    if (csize === 0xffffffff || size === 0xffffffff || local === 0xffffffff) throw new Error('zip64 is not supported');
    const rawName = buf.subarray(p + 46, p + 46 + nameLen);
    if (buf.readUInt32LE(local) !== 0x04034b50) throw new Error('broken zip entry');
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    entries.push({
      name: rawName.toString(flags & 0x800 ? 'utf8' : 'latin1'),
      rawName: Buffer.from(rawName),
      method: buf.readUInt16LE(p + 10),
      time: buf.readUInt16LE(p + 12),
      date: buf.readUInt16LE(p + 14),
      crc: buf.readUInt32LE(p + 16),
      size,
      stored: buf.subarray(start, start + csize),
    });
    p += 46 + nameLen + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
  }
  return entries;
}

export function entryData(e: ZipEntry): Buffer {
  if (e.method === 0) return Buffer.from(e.stored);
  if (e.method === 8) return zlib.inflateRawSync(e.stored, { maxOutputLength: Math.max(e.size, 1) });
  throw new Error(`zip method ${e.method} is not supported`);
}

/** The same entry with new content, deflated. */
export function withData(e: ZipEntry, data: Buffer): ZipEntry {
  return { ...e, method: 8, crc: crc32(data), size: data.length, stored: zlib.deflateRawSync(data, { level: 9 }) };
}

export function writeZip(entries: ZipEntry[]): Buffer {
  const parts: Buffer[] = [];
  const dir: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    // Bit 11: the name is UTF-8. Sizes go in the header, so no data descriptor (bit 3).
    const flags = /[^\x00-\x7f]/.test(e.name) ? 0x800 : 0;
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0);
    head.writeUInt16LE(20, 4);
    head.writeUInt16LE(flags, 6);
    head.writeUInt16LE(e.method, 8);
    head.writeUInt16LE(e.time, 10);
    head.writeUInt16LE(e.date, 12);
    head.writeUInt32LE(e.crc, 14);
    head.writeUInt32LE(e.stored.length, 18);
    head.writeUInt32LE(e.size, 22);
    head.writeUInt16LE(e.rawName.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    head.copy(central, 8, 6, 28);
    central.writeUInt32LE(offset, 42);
    dir.push(central, e.rawName);
    parts.push(head, e.rawName, e.stored);
    offset += 30 + e.rawName.length + e.stored.length;
  }
  const dirSize = dir.reduce((sum, b) => sum + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(dirSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, ...dir, end]);
}
