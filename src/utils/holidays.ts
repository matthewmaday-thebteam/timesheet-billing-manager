import { isWeekend, isSameDay, eachDayOfInterval, startOfMonth, endOfMonth } from 'date-fns';

/**
 * Calculate Orthodox Easter date for a given year using the Meeus Julian algorithm
 */
function getOrthodoxEaster(year: number): Date {
  const a = year % 4;
  const b = year % 7;
  const c = year % 19;
  const d = (19 * c + 15) % 30;
  const e = (2 * a + 4 * b - d + 34) % 7;
  const month = Math.floor((d + e + 114) / 31); // 3 = March, 4 = April
  const day = ((d + e + 114) % 31) + 1;

  // This gives Julian calendar date, need to convert to Gregorian
  // Add 13 days for 20th/21st century conversion
  const julianDate = new Date(year, month - 1, day);
  julianDate.setDate(julianDate.getDate() + 13);

  return julianDate;
}

/**
 * Get all Bulgarian public holidays for a given year
 * Returns array of Date objects
 */
export function getBulgarianHolidays(year: number): Date[] {
  const holidays: Date[] = [];

  // Fixed holidays
  holidays.push(new Date(year, 0, 1));   // January 1 - New Year's Day
  holidays.push(new Date(year, 2, 3));   // March 3 - Liberation Day
  holidays.push(new Date(year, 4, 1));   // May 1 - Labour Day
  holidays.push(new Date(year, 4, 6));   // May 6 - St. George's Day / Army Day
  holidays.push(new Date(year, 4, 24));  // May 24 - Education and Culture Day
  holidays.push(new Date(year, 8, 6));   // September 6 - Unification Day
  holidays.push(new Date(year, 8, 22));  // September 22 - Independence Day
  holidays.push(new Date(year, 11, 24)); // December 24 - Christmas Eve
  holidays.push(new Date(year, 11, 25)); // December 25 - Christmas Day
  holidays.push(new Date(year, 11, 26)); // December 26 - Christmas Day 2

  // Orthodox Easter-based holidays (variable dates)
  const easter = getOrthodoxEaster(year);

  // Good Friday (2 days before Easter)
  const goodFriday = new Date(easter);
  goodFriday.setDate(easter.getDate() - 2);
  holidays.push(goodFriday);

  // Holy Saturday (1 day before Easter)
  const holySaturday = new Date(easter);
  holySaturday.setDate(easter.getDate() - 1);
  holidays.push(holySaturday);

  // Easter Sunday
  holidays.push(new Date(easter));

  // Easter Monday (1 day after Easter)
  const easterMonday = new Date(easter);
  easterMonday.setDate(easter.getDate() + 1);
  holidays.push(easterMonday);

  return holidays;
}

/**
 * Check if a date is a Bulgarian public holiday
 */
export function isBulgarianHoliday(date: Date): boolean {
  const holidays = getBulgarianHolidays(date.getFullYear());
  return holidays.some(holiday => isSameDay(date, holiday));
}

/**
 * Check if a date is a working day (not weekend, not holiday)
 */
export function isWorkingDay(date: Date): boolean {
  return !isWeekend(date) && !isBulgarianHoliday(date);
}

/**
 * Count working days in a date range (inclusive)
 */
export function countWorkingDays(startDate: Date, endDate: Date): number {
  const days = eachDayOfInterval({ start: startDate, end: endDate });
  return days.filter(isWorkingDay).length;
}

/**
 * Get working days in a month up to a specific date
 */
export function getWorkingDaysInMonth(date: Date): { total: number; elapsed: number } {
  const monthStart = startOfMonth(date);
  const monthEnd = endOfMonth(date);

  // Total working days in the month
  const total = countWorkingDays(monthStart, monthEnd);

  // Working days elapsed (up to and including the given date)
  const elapsed = countWorkingDays(monthStart, date);

  return { total, elapsed };
}

/**
 * Get list of holidays in a specific month (for display purposes)
 */
export function getHolidaysInMonth(date: Date): { date: Date; name: string }[] {
  const year = date.getFullYear();
  const month = date.getMonth();
  const holidays = getBulgarianHolidays(year);

  const holidayNames: Record<string, string> = {
    '1-1': 'New Year\'s Day',
    '3-3': 'Liberation Day',
    '5-1': 'Labour Day',
    '5-6': 'St. George\'s Day',
    '5-24': 'Education Day',
    '9-6': 'Unification Day',
    '9-22': 'Independence Day',
    '12-24': 'Christmas Eve',
    '12-25': 'Christmas Day',
    '12-26': 'Christmas Day',
  };

  const easter = getOrthodoxEaster(year);

  return holidays
    .filter(h => h.getMonth() === month)
    .map(h => {
      const key = `${h.getMonth() + 1}-${h.getDate()}`;
      let name = holidayNames[key];

      if (!name) {
        // Check if it's an Easter-related holiday
        const diffFromEaster = Math.round((h.getTime() - easter.getTime()) / (1000 * 60 * 60 * 24));
        if (diffFromEaster === -2) name = 'Good Friday';
        else if (diffFromEaster === -1) name = 'Holy Saturday';
        else if (diffFromEaster === 0) name = 'Easter Sunday';
        else if (diffFromEaster === 1) name = 'Easter Monday';
        else name = 'Holiday';
      }

      return { date: h, name };
    });
}
