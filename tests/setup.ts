import mongoose from "mongoose";

// Connect once per test file (jest runs each test file in its own worker).
// After each test, truncate every collection so tests don't leak into each other.
beforeAll(async () => {
  const uri = process.env.__MONGO_URI__;
  if (!uri) throw new Error("Missing __MONGO_URI__ — globalSetup didn't run.");
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(uri, {
      // Mongoose 5 options — match app.ts
      useNewUrlParser: true,
      useCreateIndex: true,
      useFindAndModify: false,
      useUnifiedTopology: true,
    } as mongoose.ConnectionOptions);
  }
});

afterEach(async () => {
  const { collections } = mongoose.connection;
  await Promise.all(
    Object.values(collections).map((c) => c.deleteMany({}))
  );
});

afterAll(async () => {
  await mongoose.disconnect();
});

// The real mailer must never fire in tests — it talks to SMTP. Module-wide mock.
// Mirrors the real module's exports: named `mailTransporter` + `sendMail`.
jest.mock("../utils/mailTransporter", () => {
  const mockSendMail = jest.fn(async () => ({ accepted: ["test@example.com"] }));
  return {
    __esModule: true,
    mailTransporter: { sendMail: mockSendMail, on: jest.fn(), verify: jest.fn() },
    sendMail: mockSendMail,
    otpExpiryInMs: 1000 * 60 * 10,
    resetPasswordOtpTemplate: (otp: unknown) => `OTP:${otp}`,
    loginOtpTemplate: (otp: unknown) => `OTP:${otp}`,
  };
});
