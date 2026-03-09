type input = string | number | Date | unknown;
export const myDate = (fromDate?: input, toDate?: input) => {
  const toDay = new Date();

  const sanitizeDate = (date?: input) => {
    if (
      typeof date !== "number" &&
      typeof date !== "string" &&
      !(date instanceof Date)
    ) {
      return toDay;
    }
    return date && !isNaN(new Date(date).getTime()) ? new Date(date) : toDay;
  };

  try {
    const from = sanitizeDate(fromDate);
    const to = sanitizeDate(toDate);
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
