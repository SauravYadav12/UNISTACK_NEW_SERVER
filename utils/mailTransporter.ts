import nodemailer from "nodemailer";
import dotenv from "dotenv";
import { MailOptions } from "nodemailer/lib/json-transport";
dotenv.config({ path: "./config.env" });

const pass = process.env.SMTP_PASS;
const user = process.env.SMTP_USER;
const host = process.env.SMTP_HOST;

export const otpExpiryInMs = 1000 * 60 * 10; // 10 minutes

if (!pass || !user || !host) {
  console.log("mail tranporter credentials error: missing credentials");
  console.log({ pass, user, host });
}

const mailTransporter = nodemailer.createTransport({
  host,
  port: Number(process.env.SMTP_PORT) || 465,
  secure: true,
  auth: {
    user,
    pass,
  },
});

mailTransporter.on("error", (err) => console.log(err));
mailTransporter.verify(function (error, success) {
  if (error) {
    console.log(error);
  } else {
    console.log("Mail Transporter Server is ready to take our messages");
  }
});

export async function sendMail(mailOptions: MailOptions) {
  return await mailTransporter.sendMail(mailOptions);
}

export function resetPasswordOtpTemplate(
  otp: string | number,
  expiry: string = otpExpiryInMs / (1000 * 60) + " minutes"
) {
  return baseOtpTemplate(otp, {
    title: "Your One-Time Password (OTP)",
    description: `Please use the OTP to reset your password. This OTP is valid for ${expiry}.`,
    note: "If you did not request this OTP, connect with your admin as soon as possible.",
  });
}

export function loginOtpTemplate(
  otp: string | number,
  expiry: string = otpExpiryInMs / (1000 * 60) + " minutes"
) {
  return baseOtpTemplate(otp, {
    title: "Your One-Time Password (OTP) for Login",
    description: `Please use this OTP to log in to your account. This OTP is valid for ${expiry}.`,
    note: "If you did not initiate this login, connect with your admin as soon as possible.",
  });
}

function baseOtpTemplate(
  otp: string | number,
  options: {
    title: string;
    description: string;
    note?: string;
  }
) {
  const { title, description, note } = options;
  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${title}</title>
      <style>
        body {
          font-family: Arial, sans-serif;
          background-color: #f4f4f4;
          margin: 0;
          padding: 20px;
        }
        .container {
          background-color: #fff;
          border-radius: 8px;
          box-shadow: 0 0 10px rgba(0, 0, 0, 0.1);
          padding: 30px;
          max-width: 600px;
          margin: 0 auto;
        }
        h2 {
          color: #333;
          text-align: center;
          margin-bottom: 20px;
        }
        .otp-box {
          background-color: #e9ecef;
          padding: 15px;
          border-radius: 6px;
          text-align: center;
          font-size: 24px;
          font-weight: bold;
          color: #007bff;
          margin-bottom: 20px;
        }
        p {
          color: #555;
          line-height: 1.6;
          margin-bottom: 15px;
        }
        .note {
          font-size: 14px;
          color: #777;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <h2>${title}</h2>
        <div class="otp-box"><strong>${otp}</strong></div>
        <p>${description}</p>
        ${note && `<p class="note">${note}</p>`}
        <p>Thank you,</p>
        <p>Team Unicodez</p>
      </div>
    </body>
    </html>
  `;
}

export { mailTransporter };
