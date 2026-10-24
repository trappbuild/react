// Consumers' bundlers replace this at build time; the SDK itself doesn't depend on Node.
declare const process: { env: { NODE_ENV?: string } };
