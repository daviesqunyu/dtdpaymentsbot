/* ============================================================
   MYSQL DATABASE CONFIG — BLANK PLACEHOLDER
   ============================================================
   Your friend will give you access later. When you get the
   credentials, either:

   A) Fill the .env file with:
        MYSQL_HOST=
        MYSQL_PORT=3306
        MYSQL_USER=
        MYSQL_PASSWORD=
        MYSQL_DATABASE=

   B) Or hardcode them below between the quotes.

   Until these are filled, /api/card-payment returns:
   "MySQL not configured yet."
   ============================================================ */

export function getDbConfig() {
  return {
    host: process.env.MYSQL_HOST || "", // <-- e.g. "sql123.example.com" or IP
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER || "", // <-- e.g. "dtdstore_user"
    password: process.env.MYSQL_PASSWORD || "", // <-- your password
    database: process.env.MYSQL_DATABASE || "" // <-- e.g. "dtd_payments"
  };
}

export function isDbConfigured(config) {
  return Boolean(config.host && config.user && config.database);
}
