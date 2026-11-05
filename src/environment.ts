/** Verification environments. Selecting one does not provision organisation access. */
export const Environment = Object.freeze({
  SIMULATOR: 'simulator',
  SANDBOX: 'sandbox',
  PRODUCTION: 'production',
} as const);
export type Environment = typeof Environment[keyof typeof Environment];

/** Validate untrusted configuration such as an environment variable. */
export function parseEnvironment(value: unknown): Environment {
  if (value === Environment.SIMULATOR || value === Environment.SANDBOX || value === Environment.PRODUCTION) return value;
  throw new TypeError('Invalid environment: expected simulator, sandbox or production');
}
