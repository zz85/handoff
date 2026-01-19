// compression.ts - Shared compression utilities with CRIME/BREACH mitigations

// === Constants ===
const MIN_PADDING = 16;
const MAX_PADDING = 128;

// === Security: Random Padding (CRIME/BREACH mitigation) ===
// Each frame gets random padding to prevent size-based oracle attacks
function generateRandomPadding(): Uint8Array {
  const length = MIN_PADDING + Math.floor(Math.random() * (MAX_PADDING - MIN_PADDING));
  const padding = new Uint8Array(length);
  crypto.getRandomValues(padding);
  return padding;
}

// === Security: XOR Mask for Secrets ===
// Can be used to mask sensitive data before compression
export function xorMask(data: Uint8Array, mask: Uint8Array): Uint8Array {
  const result = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) {
    result[i] = data[i] ^ mask[i % mask.length];
  }
  return result;
}

export function generateMask(): Uint8Array {
  const mask = new Uint8Array(32);
  crypto.getRandomValues(mask);
  return mask;
}

// === Compression with Padding ===
// Frame format: [2-byte padding length (big endian)][padding bytes][compressed data]

export async function compressWithPadding(data: Uint8Array): Promise<Uint8Array> {
  const padding = generateRandomPadding();
  const paddingLengthBytes = new Uint8Array(2);
  new DataView(paddingLengthBytes.buffer).setUint16(0, padding.length, false);

  const stream = new CompressionStream("zstd");
  const writer = stream.writable.getWriter();
  await writer.write(data);
  await writer.close();
  const compressed = new Uint8Array(await new Response(stream.readable).arrayBuffer());

  const result = new Uint8Array(2 + padding.length + compressed.length);
  result.set(paddingLengthBytes, 0);
  result.set(padding, 2);
  result.set(compressed, 2 + padding.length);
  return result;
}

export async function decompressWithPadding(data: Uint8Array): Promise<Uint8Array> {
  const paddingLength = new DataView(data.buffer, data.byteOffset).getUint16(0, false);
  const compressedData = data.slice(2 + paddingLength);

  const stream = new DecompressionStream("zstd");
  const writer = stream.writable.getWriter();
  await writer.write(compressedData);
  await writer.close();
  return new Uint8Array(await new Response(stream.readable).arrayBuffer());
}

// === Stats Tracking ===
export interface CompressionStats {
  totalBytesIn: number;
  totalBytesOut: number;
  bytesInLast5s: number;
  bytesOutLast5s: number;
  totalFramesIn: number;
  totalFramesOut: number;
  framesInLast5s: number;
  framesOutLast5s: number;
  compressionRatio: number;
  avgCompressionRatio: number;
}

interface Sample {
  ts: number;
  bytesIn: number;
  bytesOut: number;
  framesIn: number;
  framesOut: number;
}

export function createStatsTracker() {
  let totalBytesIn = 0;
  let totalBytesOut = 0;
  let totalFramesIn = 0;
  let totalFramesOut = 0;
  let samples: Sample[] = [];

  function pruneOldSamples(now: number) {
    const cutoff = now - 5000;
    samples = samples.filter(s => s.ts > cutoff);
  }

  function recordInbound(bytes: number) {
    const now = Date.now();
    totalBytesIn += bytes;
    totalFramesIn += 1;
    samples.push({ ts: now, bytesIn: bytes, bytesOut: 0, framesIn: 1, framesOut: 0 });
    pruneOldSamples(now);
  }

  function recordOutbound(bytes: number) {
    const now = Date.now();
    totalBytesOut += bytes;
    totalFramesOut += 1;
    samples.push({ ts: now, bytesIn: 0, bytesOut: bytes, framesIn: 0, framesOut: 1 });
    pruneOldSamples(now);
  }

  function getSnapshot(): CompressionStats {
    const now = Date.now();
    pruneOldSamples(now);

    const bytesInLast5s = samples.reduce((sum, s) => sum + s.bytesIn, 0);
    const bytesOutLast5s = samples.reduce((sum, s) => sum + s.bytesOut, 0);
    const framesInLast5s = samples.reduce((sum, s) => sum + s.framesIn, 0);
    const framesOutLast5s = samples.reduce((sum, s) => sum + s.framesOut, 0);

    return {
      totalBytesIn,
      totalBytesOut,
      bytesInLast5s,
      bytesOutLast5s,
      totalFramesIn,
      totalFramesOut,
      framesInLast5s,
      framesOutLast5s,
      compressionRatio: bytesInLast5s > 0 ? bytesOutLast5s / bytesInLast5s : 0,
      avgCompressionRatio: totalBytesIn > 0 ? totalBytesOut / totalBytesIn : 0,
    };
  }

  return { recordInbound, recordOutbound, getSnapshot };
}

// === Utility: Format Bytes ===
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes.toFixed(0) + "B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + "KB";
  return (bytes / (1024 * 1024)).toFixed(2) + "MB";
}
