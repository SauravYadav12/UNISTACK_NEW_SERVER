import { Request } from "express";

export const updateArrayFields = (req: Request, arrayFields: string[]) => {
  const updateOps: { $push?: Record<string, unknown> } = {};

  arrayFields.forEach((field) => {
    if (req.body[field]) {
      updateOps.$push = updateOps.$push || {};
      updateOps.$push[field] = req.body[field];

      delete req.body[field];
    }
  });
  return updateOps;
};
