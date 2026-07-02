// =============================================================================
// sniffFormat — detect the real container of an uploaded "bank export" file.
// =============================================================================
// The UniCredit Bulbank eBank export "report(N).xls" is an HTML <table> file
// misnamed .xls. Other uploads may be genuine BIFF .xls (OLE2 compound) or real
// OOXML .xlsx (a zip). NEVER trust the file extension — sniff the bytes.
//   - zip magic  "PK\x03\x04"      → xlsx
//   - OLE2 magic  D0 CF 11 E0      → binary_xls
//   - leading '<' (after BOM/ws)   → html_xls
// =============================================================================

export type SourceFormat = 'html_xls' | 'binary_xls' | 'xlsx';

function toBytes(input: ArrayBuffer | Uint8Array): Uint8Array {
  return input instanceof Uint8Array ? input : new Uint8Array(input);
}

export function sniffFormat(input: ArrayBuffer | Uint8Array | string): SourceFormat {
  if (typeof input === 'string') {
    return input.trimStart().startsWith('<') ? 'html_xls' : 'binary_xls';
  }

  const bytes = toBytes(input);

  // OOXML / any zip archive.
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) return 'xlsx';

  // OLE2 compound document (legacy BIFF .xls).
  if (bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0) {
    return 'binary_xls';
  }

  // Skip a UTF-8 BOM then any leading whitespace, then look for '<'.
  let i = 0;
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) i = 3;
  while (
    i < bytes.length &&
    (bytes[i] === 0x20 || bytes[i] === 0x09 || bytes[i] === 0x0a || bytes[i] === 0x0d)
  ) {
    i++;
  }
  if (bytes[i] === 0x3c /* '<' */) return 'html_xls';

  // Unknown — let SheetJS attempt a binary parse as a last resort.
  return 'binary_xls';
}
