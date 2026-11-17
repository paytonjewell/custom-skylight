// SHA-256, for device tokens (worker/auth.ts) and news story ids (worker/news/news.ts)

const enc = new TextEncoder();

export const sha256 = (s: string): Promise<ArrayBuffer> => crypto.subtle.digest('SHA-256', enc.encode(s));

export const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');

export const sha256Hex = async (s: string) => hex(await sha256(s));
