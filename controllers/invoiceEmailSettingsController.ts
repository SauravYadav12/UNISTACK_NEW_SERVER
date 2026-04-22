import { Request, Response } from "express";
import {
  InvoiceEmailSettingsModel,
  getInvoiceEmailSettings,
} from "../models/invoiceEmailSettingsModel";
import { IEmailTemplateBlock } from "../interface/modelInterfaces";
import { getErrorMessage } from "../utils/utils";

export const getSettings = async (_req: Request, res: Response) => {
  try {
    const settings = await getInvoiceEmailSettings();
    res.status(200).json({ status: "success", data: settings });
  } catch (error) {
    res.status(400).json({ status: "failed", error: getErrorMessage(error) });
  }
};

function validBlock(b: unknown): b is Partial<IEmailTemplateBlock> {
  if (!b || typeof b !== "object") return false;
  const keys: (keyof IEmailTemplateBlock)[] = [
    "subject",
    "heading",
    "bodyLead",
    "bodyDetails",
    "signOff",
  ];
  for (const k of keys) {
    const v = (b as Record<string, unknown>)[k];
    if (v !== undefined && typeof v !== "string") return false;
  }
  return true;
}

export const updateSettings = async (req: Request, res: Response) => {
  try {
    // Load (creates default on first call)
    const settings = await getInvoiceEmailSettings();

    const body = req.body as {
      timesheetApprovalRequest?: Partial<IEmailTemplateBlock>;
      raised?: Partial<IEmailTemplateBlock>;
      due?: Partial<IEmailTemplateBlock>;
    };

    for (const key of ["timesheetApprovalRequest", "raised", "due"] as const) {
      const incoming = body[key];
      if (incoming === undefined) continue;
      if (!validBlock(incoming)) {
        res.status(400).json({
          status: "failed",
          message: `Invalid shape for ${key}`,
        });
        return;
      }
      Object.assign(settings[key], incoming);
    }

    const user = req.user as { _id?: import("mongoose").Types.ObjectId } | undefined;
    if (user?._id) settings.updatedBy = user._id;
    await settings.save();

    res.status(200).json({ status: "success", data: settings });
  } catch (error) {
    res.status(400).json({ status: "failed", error: getErrorMessage(error) });
  }
};
