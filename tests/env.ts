// Runs BEFORE any source module loads (via jest `setupFiles`). Pins test-only
// env vars so passport + our sign helper share the same JWT secret and the
// env.config warning chatter stays quiet.
process.env.JWT_SECRET_KEY = "test-jwt-secret";
process.env.JWT_EXPIRES_IN = "1h";
process.env.SMTP_HOST = "smtp.test.local";
process.env.SMTP_USER = "test@unicodez.com";
process.env.SMTP_PASS = "test";
process.env.SMTP_PORT = "465";
process.env.COMPANY_EMAIL = "test@unicodez.com";
process.env.NODE_ENV = "test";
