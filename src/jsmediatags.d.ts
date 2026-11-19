declare module 'jsmediatags' {
  export interface Tag {
    tags: {
      title?: string;
      artist?: string;
      album?: string;
      genre?: string;
      year?: string;
      track?: string;
      picture?: { format: string; data: number[] | Uint8Array };
    };
  }
  export function read(
    src: Blob | File | string,
    callbacks: { onSuccess: (tag: Tag) => void; onError: (error: { type: string; info: string }) => void }
  ): void;
  export const Reader: any;
  export const Config: any;
}

declare module 'jsmediatags/dist/jsmediatags.min.js' {
  export interface Tag {
    tags: {
      title?: string;
      artist?: string;
      album?: string;
      genre?: string;
      year?: string;
      track?: string;
      picture?: { format: string; data: number[] | Uint8Array };
    };
  }
  export function read(
    src: Blob | File | string,
    callbacks: { onSuccess: (tag: Tag) => void; onError: (error: { type: string; info: string }) => void }
  ): void;
  export const Reader: any;
  export const Config: any;
  const jsmediatags: any;
  export default jsmediatags;
}