export const updateArrayFields = (req: any, arrayFields: any) => {
  const updateOps: any = {};

  arrayFields.forEach((field: any) => {
    if (req.body[field]) {
      updateOps.$push = updateOps.$push || {};
      updateOps.$push[field] = req.body[field];

      delete req.body[field];
    }
  });
  return updateOps;
};
