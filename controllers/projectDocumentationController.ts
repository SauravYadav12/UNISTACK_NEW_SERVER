import { Request, Response } from "express";
import { ProjectModel } from "../models/projectModel";
import { getErrorMessage } from "../utils/utils";

type DocStepKey =
  | "bgc"
  | "contractSigned"
  | "paymentTermsAccepted"
  | "onboarding";

const STEP_KEYS: DocStepKey[] = [
  "bgc",
  "contractSigned",
  "paymentTermsAccepted",
  "onboarding",
];

interface IncomingStep {
  status?: "Pending" | "Done";
  completedOn?: string | Date;
  notes?: string;
  attachmentUrl?: string;
}

/**
 * Surgical patch of project documentation. Accepts:
 *   { bgc?: IncomingStep, contractSigned?: IncomingStep, ...,
 *     extraNotes?: string }
 * Each provided step is merged field-by-field using dot-path $set so other
 * steps and unrelated fields stay untouched.
 */
export const patchProjectDocumentation = async (req: Request, res: Response) => {
  try {
    const body = req.body as {
      bgc?: IncomingStep;
      contractSigned?: IncomingStep;
      paymentTermsAccepted?: IncomingStep;
      onboarding?: IncomingStep;
      extraNotes?: string;
    };

    const set: Record<string, unknown> = {};
    for (const step of STEP_KEYS) {
      const incoming = body[step];
      if (!incoming) continue;
      if (incoming.status !== undefined) {
        if (!["Pending", "Done"].includes(incoming.status)) {
          res.status(400).json({
            status: "failed",
            message: `Invalid status for documentation.${step}`,
          });
          return;
        }
        set[`documentation.${step}.status`] = incoming.status;
      }
      if (incoming.completedOn !== undefined) {
        set[`documentation.${step}.completedOn`] =
          incoming.completedOn === null ? null : new Date(incoming.completedOn as string);
      }
      if (incoming.notes !== undefined) {
        set[`documentation.${step}.notes`] = incoming.notes;
      }
      if (incoming.attachmentUrl !== undefined) {
        set[`documentation.${step}.attachmentUrl`] = incoming.attachmentUrl;
      }
    }
    if (body.extraNotes !== undefined) {
      set["documentation.extraNotes"] = body.extraNotes;
    }

    if (!Object.keys(set).length) {
      res
        .status(400)
        .json({ status: "failed", message: "Nothing to update" });
      return;
    }

    const project = await ProjectModel.findByIdAndUpdate(
      req.params.id,
      { $set: set },
      { new: true }
    );
    if (!project) {
      res.status(404).json({ status: "failed", message: "Project not found" });
      return;
    }
    res.status(200).json({ status: "success", data: project });
  } catch (error) {
    res.status(400).json({ status: "failed", error: getErrorMessage(error) });
  }
};
