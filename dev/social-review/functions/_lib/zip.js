/* A minimal streaming ZIP writer.
 *
 * Everything here is already compressed (JPEG, PNG, MP4), so entries are
 * stored rather than deflated: no compression work, and the bytes go
 * straight from R2 to the client.
 *
 * Stored entries still need a CRC32 and a length in the header, neither of
 * which is known before the data has been read. Rather than buffer a file to
 * find out, each entry sets the data-descriptor flag and writes those three
 * numbers after its data, which is what the format provides for.
 *
 * No ZIP64, so a single archive is capped below 4GB. The caller checks.
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(chunk, crc) {
  let c = ~crc;
  for (let i = 0; i < chunk.length; i++) c = CRC_TABLE[(c ^ chunk[i]) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}

// MS-DOS packed date and time, which is what the format stores.
function dosTime(date) {
  const time = ((date.getHours() & 31) << 11) | ((date.getMinutes() & 63) << 5)
    | ((Math.floor(date.getSeconds() / 2)) & 31);
  const day = (((date.getFullYear() - 1980) & 127) << 9)
    | (((date.getMonth() + 1) & 15) << 5) | (date.getDate() & 31);
  return { time, day };
}

const SIG_LOCAL = 0x04034b50;
const SIG_DESCRIPTOR = 0x08074b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_END = 0x06054b50;
const FLAG_DESCRIPTOR = 0x08;
const FLAG_UTF8 = 0x800;

/**
 * @param entries  async iterable of { name, stream, size, modified }
 * @returns ReadableStream of the archive
 */
export function zipStream(entries) {
  const encoder = new TextEncoder();
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();

  (async () => {
    const central = [];
    let offset = 0;

    const put = async (bytes) => {
      await writer.write(bytes);
      offset += bytes.length;
    };

    try {
      for await (const entry of entries) {
        const name = encoder.encode(entry.name);
        const { time, day } = dosTime(entry.modified || new Date());

        const header = new Uint8Array(30 + name.length);
        const hv = new DataView(header.buffer);
        hv.setUint32(0, SIG_LOCAL, true);
        hv.setUint16(4, 20, true);                          // version needed
        hv.setUint16(6, FLAG_DESCRIPTOR | FLAG_UTF8, true);
        hv.setUint16(8, 0, true);                           // stored
        hv.setUint16(10, time, true);
        hv.setUint16(12, day, true);
        hv.setUint16(26, name.length, true);
        header.set(name, 30);

        const headerOffset = offset;
        await put(header);

        let crc = 0;
        let size = 0;
        const reader = entry.stream.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          crc = crc32(value, crc);
          size += value.length;
          await put(value);
        }

        const descriptor = new Uint8Array(16);
        const dv = new DataView(descriptor.buffer);
        dv.setUint32(0, SIG_DESCRIPTOR, true);
        dv.setUint32(4, crc, true);
        dv.setUint32(8, size, true);
        dv.setUint32(12, size, true);
        await put(descriptor);

        central.push({ name, crc, size, time, day, headerOffset });
      }

      const directoryStart = offset;
      for (const e of central) {
        const record = new Uint8Array(46 + e.name.length);
        const rv = new DataView(record.buffer);
        rv.setUint32(0, SIG_CENTRAL, true);
        rv.setUint16(4, 20, true);                            // version made by
        rv.setUint16(6, 20, true);                            // version needed
        rv.setUint16(8, FLAG_DESCRIPTOR | FLAG_UTF8, true);
        rv.setUint16(10, 0, true);                            // stored
        rv.setUint16(12, e.time, true);
        rv.setUint16(14, e.day, true);
        rv.setUint32(16, e.crc, true);
        rv.setUint32(20, e.size, true);
        rv.setUint32(24, e.size, true);
        rv.setUint16(28, e.name.length, true);
        rv.setUint32(42, e.headerOffset, true);
        record.set(e.name, 46);
        await put(record);
      }

      const end = new Uint8Array(22);
      const ev = new DataView(end.buffer);
      ev.setUint32(0, SIG_END, true);
      ev.setUint16(8, central.length, true);
      ev.setUint16(10, central.length, true);
      ev.setUint32(12, offset - directoryStart, true);
      ev.setUint32(16, directoryStart, true);
      await put(end);

      await writer.close();
    } catch (error) {
      await writer.abort(error);
    }
  })();

  return readable;
}
