export function concatBytes(parts: Uint8Array[]): Uint8Array {
  let len = 0;
  for (const part of parts) len += part.length;
  const out = new Uint8Array(len);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

export function ascii(bytes: Uint8Array, offset: number, length: number): string {
  let text = '';
  const end = Math.min(bytes.length, offset + length);
  for (let i = offset; i < end; i++) text += String.fromCharCode(bytes[i]);
  return text;
}

export function u16be(bytes: Uint8Array, offset: number): number {
  return bytes[offset] * 256 + bytes[offset + 1];
}

export function u32be(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset] * 16777216 +
    bytes[offset + 1] * 65536 +
    bytes[offset + 2] * 256 +
    bytes[offset + 3]
  );
}

export function toBase64(bytes: Uint8Array): string {
  const chunk = 0x2000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunk) {
    const slice = bytes.subarray(i, i + chunk);
    let part = '';
    for (let j = 0; j < slice.length; j++) part += String.fromCharCode(slice[j]);
    binary += part;
  }
  if (typeof btoa !== 'function') {
    throw new Error('btoa is not available');
  }
  return btoa(binary);
}

export function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}

export function encodeUtf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

export function mimeFromName(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  switch (ext) {
    case 'png':
      return 'image/png';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'gif':
      return 'image/gif';
    case 'webp':
      return 'image/webp';
    case 'svg':
      return 'image/svg+xml';
    case 'css':
      return 'text/css';
    case 'pdf':
      return 'application/pdf';
    case 'epub':
      return 'application/epub+zip';
    case 'azw3':
      return 'application/vnd.amazon.mobi8-ebook';
    default:
      return 'application/octet-stream';
  }
}

export function sniffFormat(fileName: string, bytes: Uint8Array): 'pdf' | 'epub' | 'azw3' | null {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  if (bytes.length >= 5 && ascii(bytes, 0, 5) === '%PDF-') return 'pdf';
  if (bytes.length >= 2 && bytes[0] === 0x50 && bytes[1] === 0x4b) {
    if (ext === 'azw3') return 'azw3';
    return 'epub';
  }
  if (ext === 'pdf') return 'pdf';
  if (ext === 'epub') return 'epub';
  if (ext === 'azw3' || ext === 'kf8' || ext === 'mobi' || ext === 'azw' || ext === 'prc') return 'azw3';
  if (bytes.length > 68 && ascii(bytes, 60, 8) === 'BOOKMOBI') return 'azw3';
  return null;
}
