import mongoose from "mongoose";

const ARCHIVE_DB_URL =
  process.env.ARCHIVE_DATABASE?.replace(
    "<PASSWORD>",
    process.env.ARCHIVE_DATABASE_PASSWORD || ""
  ) || "";

const ARCHIVE_DB_INSTANCE = mongoose.createConnection(ARCHIVE_DB_URL, {
  useNewUrlParser: true,
  useCreateIndex: true,
  useFindAndModify: false,
  useUnifiedTopology: true,
});
ARCHIVE_DB_INSTANCE.on("connected", () => {
  console.log("Archive DB connection successful");
});
ARCHIVE_DB_INSTANCE.on("error", (err) => {
  console.error("Archive DB connection error:", err.message);
});

const archiveInterview = ARCHIVE_DB_INSTANCE.collection("interviews");
const archiveRequirement = ARCHIVE_DB_INSTANCE.collection("unibases");

export { ARCHIVE_DB_INSTANCE, archiveInterview, archiveRequirement };
