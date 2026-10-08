// Business dates follow Taiwan time, like the document numbers the database assigns (BUSINESS_API.md §2.5).
// toISOString() would give the UTC date, a day behind between midnight and 08:00 in Taiwan.
const TAIWAN_DATE = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' });

// Today's date in Taiwan as YYYY-MM-DD, the value a date input expects
export const todayInTaiwan = (now: Date = new Date()): string => TAIWAN_DATE.format(now);
