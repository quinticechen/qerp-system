// Same format as rolls created in the inventory intake dialog: R + YYMMDD + time digits + random suffix
export const generateRollNumber = (now: Date = new Date()): string => {
  const year = now.getFullYear().toString().slice(-2);
  const month = (now.getMonth() + 1).toString().padStart(2, '0');
  const day = now.getDate().toString().padStart(2, '0');
  const time = now.getTime().toString().slice(-6);
  const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
  return `R${year}${month}${day}${time}${random}`;
};
