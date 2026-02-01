declare module 'qrcode' {
  export interface QRCodeToDataURLOptions {
    width?: number;
    margin?: number;
  }

  export function toDataURL(
    text: string,
    options?: QRCodeToDataURLOptions
  ): Promise<string>;
}
