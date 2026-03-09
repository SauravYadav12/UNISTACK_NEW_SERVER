export function logMissingEnvVars(
  envVars: Record<string, unknown>,
  message = "Missing environment variables"
) {
  function findMissingVars(
    obj: Record<string, unknown>,
    prefix = ""
  ): [string, unknown][] {
    const missing: [string, unknown][] = [];

    for (const [key, value] of Object.entries(obj)) {
      const fullKey = prefix ? `${prefix}.${key}` : key;

      if (value && typeof value === "object" && !Array.isArray(value)) {
        missing.push(...findMissingVars(value as Record<string, unknown>, fullKey));
      } else if (!value && value !== false) {
        missing.push([fullKey, value]);
      }
    }

    return missing;
  }

  const missingVars = findMissingVars(envVars);

  if (missingVars.length > 0) {
    const varsToLog = Object.fromEntries(missingVars);
    console.error(varsToLog, message);
    return varsToLog;
  }

  return {};
}

const ENV_VARS = {
    NODE_ENV : process.env.NODE_ENV,
    PORT : process.env.PORT,
    ALLOWED_ORIGINS : process.env.ALLOWED_ORIGINS?.split(",").map(origin => origin.trim()),
    DATABASE : process.env.DATABASE,
    DATABASE_PASSWORD : process.env.DATABASE_PASSWORD,
    ARCHIVE_DATABASE : process.env.ARCHIVE_DATABASE,
    ARCHIVE_DATABASE_PASSWORD : process.env.ARCHIVE_DATABASE_PASSWORD,

    JWT_SECRET_KEY : process.env.JWT_SECRET_KEY,
    JWT_EXPIRES_IN : process.env.JWT_EXPIRES_IN,

    S3CLIENT_END_POINT : process.env.S3CLIENT_END_POINT,
    STORAGE_SECRET_ACCESS_KEY : process.env.STORAGE_SECRET_ACCESS_KEY,
    STORAGE_ACCESS_KEY_ID : process.env.STORAGE_ACCESS_KEY_ID,
    STORAGE_BUCKET : process.env.STORAGE_BUCKET,

    GCP_STORAGE_BUCKET : process.env.GCP_STORAGE_BUCKET,
    GOOGLE_APPLICATION_CREDENTIALS : process.env.GOOGLE_APPLICATION_CREDENTIALS,

    SMTP_HOST : process.env.SMTP_HOST,
    SMTP_PASS : process.env.SMTP_PASS,
    SMTP_USER : process.env.SMTP_USER,
    SMTP_PORT : process.env.SMTP_PORT,
}

logMissingEnvVars(ENV_VARS, "Missing environment variables in config.env");


export default ENV_VARS;