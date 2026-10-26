declare module '*.readerhtml' {
  const value: number;
  export default value;
}

declare module '*.pdfjs' {
  const value: number;
  export default value;
}

declare module '*.epub' {
  const value: number;
  export default value;
}

declare module '*.azw3' {
  const value: number;
  export default value;
}

declare module '*.pdf' {
  const value: number;
  export default value;
}

declare module '*.txt' {
  const value: number;
  export default value;
}

declare module 'qrcode' {
  export function create(
    text: string,
    options?: { errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H' },
  ): { modules: { size: number; data: Uint8Array } };
}
