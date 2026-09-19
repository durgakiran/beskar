/** Collision-checked, injectable record identifier generation. */

export type IdTokenFactory = () => string;

function defaultTokenFactory(): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID();
  if (cryptoApi?.getRandomValues) {
    const bytes = new Uint8Array(16);
    cryptoApi.getRandomValues(bytes);
    bytes[6] = (bytes[6]! & 0x0f) | 0x40;
    bytes[8] = (bytes[8]! & 0x3f) | 0x80;
    const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  throw new Error('Secure random identifier generation is unavailable');
}

function normalizePrefix(prefix: string): string {
  const normalized = prefix.trim().replace(/[^a-zA-Z0-9:_-]+/g, '-');
  return normalized.length > 0 ? normalized : 'record';
}

export class RecordIdService {
  private readonly issued = new Set<string>();

  constructor(private readonly tokenFactory: IdTokenFactory = defaultTokenFactory) {}

  create(prefix: string, isTaken: (id: string) => boolean = () => false): string {
    const normalizedPrefix = normalizePrefix(prefix);
    for (let attempt = 0; attempt < 128; attempt++) {
      const token = this.tokenFactory();
      if (typeof token !== 'string' || token.length === 0) {
        throw new Error('Identifier token factory must return a non-empty string');
      }
      const id = `${normalizedPrefix}:${token}`;
      if (!this.issued.has(id) && !isTaken(id)) {
        this.issued.add(id);
        return id;
      }
    }
    throw new Error(`Unable to allocate a unique "${normalizedPrefix}" identifier after 128 attempts`);
  }
}
