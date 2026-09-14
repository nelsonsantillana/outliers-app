declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    ASSEMBLED_API_KEY?: string;
    ASSEMBLED_AUX_STATE_ALIASES?: string;
  }
}
