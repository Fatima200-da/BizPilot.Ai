/**
 * Minimal ambient typing for `s3rver` (a real, protocol-compliant local
 * S3-API test server, dev-only) — no official `@types/s3rver` package
 * exists. Covers exactly the surface this project's Phase 32 test
 * tooling uses.
 */
declare module 's3rver' {
  export interface S3rverOptions {
    port?: number;
    address?: string;
    silent?: boolean;
    directory?: string;
    resetOnClose?: boolean;
    allowMismatchedSignatures?: boolean;
    vhostBuckets?: boolean;
    configureBuckets?: Array<{ name: string; configs?: Array<string | Buffer> }>;
  }

  export default class S3rver {
    constructor(options?: S3rverOptions);
    run(): Promise<{ address: string; port: number; family: string }>;
    close(): Promise<void>;
  }
}
