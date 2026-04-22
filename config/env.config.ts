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
    STORAGE_BUCKET_2 : process.env.STORAGE_BUCKET_2,


    SMTP_HOST : process.env.SMTP_HOST,
    SMTP_PASS : process.env.SMTP_PASS,
    SMTP_USER : process.env.SMTP_USER,
    SMTP_PORT : process.env.SMTP_PORT,


    COMPANY_EMAIL : process.env.COMPANY_EMAIL,
    LEAVE_NOTIFY_EMAILS : process.env.LEAVE_NOTIFY_EMAILS?.split(",").map(e => e.trim()).filter(Boolean),
    ACCOUNTS_NOTIFY_EMAILS : process.env.ACCOUNTS_NOTIFY_EMAILS?.split(",").map(e => e.trim()).filter(Boolean),
    INVOICE_DUE_CHECK_HOUR : process.env.INVOICE_DUE_CHECK_HOUR ? Number(process.env.INVOICE_DUE_CHECK_HOUR) : 9,

    FRONTEND_URL : process.env.FRONTEND_URL,
    CLAUDE_API_KEY : process.env.CLAUDE_API_KEY,
    CLAUDE_MODEL : process.env.CLAUDE_MODEL,
}

logMissingEnvVars(ENV_VARS, "Missing environment variables in .env");


export default ENV_VARS;