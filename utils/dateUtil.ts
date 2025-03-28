export const myDate = (fromDate: any, toDate: any) => {
  const toDay = new Date();
  try {
    const from = new Date(fromDate) || toDay;
    const to = new Date(toDate) || toDay;
    from.setHours(0, 0, 0, 0);
    to.setHours(23, 59, 59, 999);
    return { from, to };
  } catch (error) {
    console.log(error);
  }
  toDay.setHours(0, 0, 0, 0);
  toDay.setHours(23, 59, 59, 999);
  return { from: toDay, to: toDay };
};
