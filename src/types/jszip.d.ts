declare module 'jszip' {
  type JSZipFileData = string | ArrayBuffer | Uint8Array;

  class JSZip {
    file(
      name: string,
      data: JSZipFileData,
      options?: { base64?: boolean }
    ): JSZip;
    generateAsync(options: { type: 'blob' }): Promise<Blob>;
  }

  export default JSZip;
}
