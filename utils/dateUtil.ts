export const myDate = (fromDate: any, toDate: any) => {
  const from = new Date(fromDate) || new Date();
  const to = new Date(toDate) || new Date();
  from.setHours(0, 0, 0, 0);
  to.setHours(23, 59, 59, 999);
  return { from, to };
};
