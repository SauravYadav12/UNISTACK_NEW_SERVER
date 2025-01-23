import { Schema, model } from "mongoose";
import { ContactMessage } from "../interface/contactMessage";
const contactMessageSchema = new Schema<ContactMessage>(
  {
    firstName: {
      type: String,
      default:""
    },
    lastName: {
      type: String,
      default:""
    },
    email: {
      type: String,
      lowercase: true,
      required: true,
    },
    phone: {
      type: String,
      default:""
    },
    country: {
      type: String,
      default:""
    },
    city: {
      type: String,
      default:""
    },
    message: {
      type: String,
      required: true,
    },
  },
  { timestamps: true }
);

export const ContactMessageModel = model<ContactMessage>("ContactMessage", contactMessageSchema);
