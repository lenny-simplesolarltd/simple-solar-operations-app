'use client';

import { motion, useReducedMotion } from 'motion/react';
import { useMemo, useState } from 'react';
import type React from 'react';
import { cn } from '@/lib/utils';

export interface ContributionData {
  date: string;
  count: number;
}

export interface ContributionGraphProps {
  data?: ContributionData[];
  year?: number;
  className?: string;
  showLegend?: boolean;
  showTooltips?: boolean;
}

const WEEKS_IN_YEAR = 53;
const DAYS_IN_WEEK = 7;
const JANUARY_MONTH = 0;
const DECEMBER_MONTH = 11;
const SUNDAY_DAY = 0;
const MIN_WEEKS_FOR_DECEMBER_HEADER = 2;
const TOOLTIP_OFFSET_X = 12;
const TOOLTIP_OFFSET_Y = 40;

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec'
];

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const CONTRIBUTION_COLORS = [
  'bg-muted/40',
  'bg-primary/20',
  'bg-primary/35',
  'bg-primary/60',
  'bg-primary'
];

const LEVEL_0 = 0;
const LEVEL_4 = 4;
const CONTRIBUTION_LEVELS = [0, 1, 2, 3, 4];
const DAY_1 = 1;
const DAY_31 = 31;

const getContributionLevel = (count: number, maxCount: number) => {
  if (count <= 0 || maxCount <= 0) return LEVEL_0;
  if (maxCount <= LEVEL_4) return Math.min(LEVEL_4, count);
  return Math.min(LEVEL_4, Math.ceil((count / maxCount) * LEVEL_4));
};

const isDateInValidRange = (
  currentDate: Date,
  startDate: Date,
  endDate: Date,
  targetYear: number
) => {
  const isInRange = currentDate >= startDate && currentDate <= endDate;
  const isPreviousYearDecember =
    currentDate.getUTCFullYear() === targetYear - 1 &&
    currentDate.getUTCMonth() === DECEMBER_MONTH;
  const isNextYearJanuary =
    currentDate.getUTCFullYear() === targetYear + 1 &&
    currentDate.getUTCMonth() === JANUARY_MONTH;
  return isInRange || isPreviousYearDecember || isNextYearJanuary;
};

interface MonthHeaderCheck {
  currentYear: number;
  targetYear: number;
  currentMonth: number;
  startDateDay: number;
  weekCount: number;
}

const shouldShowMonthHeader = ({
  currentYear,
  targetYear,
  currentMonth,
  startDateDay,
  weekCount
}: MonthHeaderCheck) =>
  currentYear === targetYear ||
  (currentYear === targetYear - 1 &&
    currentMonth === DECEMBER_MONTH &&
    startDateDay !== SUNDAY_DAY &&
    weekCount >= MIN_WEEKS_FOR_DECEMBER_HEADER);

const calculateMonthHeaders = (targetYear: number) => {
  const headers: { month: string; colspan: number; startWeek: number }[] = [];
  const startDate = new Date(Date.UTC(targetYear, JANUARY_MONTH, DAY_1));
  const firstSunday = new Date(startDate);
  firstSunday.setUTCDate(startDate.getUTCDate() - startDate.getUTCDay());

  let currentMonth = -1;
  let currentYear = -1;
  let monthStartWeek = 0;
  let weekCount = 0;

  for (let weekNumber = 0; weekNumber < WEEKS_IN_YEAR; weekNumber++) {
    const weekDate = new Date(firstSunday);
    weekDate.setUTCDate(firstSunday.getUTCDate() + weekNumber * DAYS_IN_WEEK);

    const monthKey = weekDate.getUTCMonth();
    const yearKey = weekDate.getUTCFullYear();

    if (monthKey !== currentMonth || yearKey !== currentYear) {
      if (
        currentMonth !== -1 &&
        shouldShowMonthHeader({
          currentYear,
          targetYear,
          currentMonth,
          startDateDay: startDate.getUTCDay(),
          weekCount
        })
      ) {
        headers.push({
          month: MONTHS[currentMonth],
          colspan: weekCount,
          startWeek: monthStartWeek
        });
      }
      currentMonth = monthKey;
      currentYear = yearKey;
      monthStartWeek = weekNumber;
      weekCount = 1;
    } else {
      weekCount++;
    }
  }

  if (
    currentMonth !== -1 &&
    shouldShowMonthHeader({
      currentYear,
      targetYear,
      currentMonth,
      startDateDay: startDate.getUTCDay(),
      weekCount
    })
  ) {
    headers.push({
      month: MONTHS[currentMonth],
      colspan: weekCount,
      startWeek: monthStartWeek
    });
  }

  return headers;
};

export function ContributionGraph({
  data = [],
  year = new Date().getFullYear(),
  className,
  showLegend = true,
  showTooltips = true
}: ContributionGraphProps) {
  const [hoveredDay, setHoveredDay] = useState<ContributionData | null>(null);
  const [tooltipPosition, setTooltipPosition] = useState({ x: 0, y: 0 });
  const shouldReduceMotion = useReducedMotion();

  const dataMap = useMemo(() => {
    const map = new Map<string, number>();
    data.forEach((entry) => map.set(entry.date, entry.count));
    return map;
  }, [data]);

  const maxCount = useMemo(
    () => data.reduce((max, entry) => Math.max(max, entry.count), 0),
    [data]
  );

  const yearData = useMemo(() => {
    const startDate = new Date(Date.UTC(year, JANUARY_MONTH, DAY_1));
    const endDate = new Date(Date.UTC(year, DECEMBER_MONTH, DAY_31));
    const days: ContributionData[] = [];

    const firstSunday = new Date(startDate);
    firstSunday.setUTCDate(startDate.getUTCDate() - startDate.getUTCDay());

    for (let weekNum = 0; weekNum < WEEKS_IN_YEAR; weekNum++) {
      for (let day = 0; day < DAYS_IN_WEEK; day++) {
        const currentDate = new Date(firstSunday);
        currentDate.setUTCDate(
          firstSunday.getUTCDate() + weekNum * DAYS_IN_WEEK + day
        );

        if (isDateInValidRange(currentDate, startDate, endDate, year)) {
          const dateString = currentDate.toISOString().split('T')[0];
          const count = dataMap.get(dateString) ?? 0;
          days.push({
            date: dateString,
            count
          });
        } else {
          days.push({
            date: '',
            count: 0
          });
        }
      }
    }

    return days;
  }, [dataMap, year]);

  const monthHeaders = useMemo(() => calculateMonthHeaders(year), [year]);

  const handleDayHover = (day: ContributionData, event: React.MouseEvent) => {
    if (showTooltips && day.date) {
      setHoveredDay(day);
      setTooltipPosition({ x: event.clientX, y: event.clientY });
    }
  };

  const handleDayLeave = () => {
    setHoveredDay(null);
  };

  const formatDate = (dateString: string) => {
    if (!dateString) {
      return '';
    }
    const date = new Date(`${dateString}T00:00:00Z`);
    return date.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  };

  const getContributionText = (count: number) => {
    if (count === LEVEL_0) {
      return 'No scans';
    }
    if (count === 1) {
      return '1 scan';
    }
    return `${count} scans`;
  };

  return (
    <div className={cn('space-y-4', className)}>
      <div className='w-full max-w-full min-w-0 overflow-x-auto'>
        <table className='border-separate border-spacing-1 text-xs'>
          <caption className='sr-only'>Contribution Graph for {year}</caption>
          <thead>
            <tr className='h-3'>
              <td className='w-7 min-w-7' />
              {monthHeaders.map((header) => (
                <td
                  className='text-foreground relative text-left'
                  colSpan={header.colspan}
                  key={`${header.month}-${header.startWeek}`}
                >
                  <span className='absolute top-0 left-1'>{header.month}</span>
                </td>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: DAYS_IN_WEEK }, (_, dayIndex) => (
              <tr className='h-2.5' key={DAYS[dayIndex]}>
                <td className='text-foreground relative w-7 min-w-7'>
                  {dayIndex % 2 === 0 && (
                    <span className='absolute -bottom-0.5 left-0 text-xs'>
                      {DAYS[dayIndex]}
                    </span>
                  )}
                </td>
                {Array.from({ length: WEEKS_IN_YEAR }, (_, w) => {
                  const dayData = yearData[w * DAYS_IN_WEEK + dayIndex];
                  const cellKey = `${dayData?.date ?? 'empty'}-${w}-${dayIndex}`;

                  if (!dayData?.date) {
                    return (
                      <td className='h-2.5 w-2.5 p-0' key={cellKey}>
                        <div className='h-2.5 w-2.5' />
                      </td>
                    );
                  }

                  const level = getContributionLevel(dayData.count, maxCount);

                  return (
                    <td
                      className='h-2.5 w-2.5 cursor-pointer p-0'
                      key={cellKey}
                      onMouseEnter={(e) => handleDayHover(dayData, e)}
                      onMouseLeave={handleDayLeave}
                      title={
                        showTooltips
                          ? `${formatDate(dayData.date)}: ${getContributionText(dayData.count)}`
                          : undefined
                      }
                    >
                      <div
                        className={cn(
                          'hover:ring-background h-2.5 w-2.5 rounded-sm transition hover:ring-2',
                          CONTRIBUTION_COLORS[level]
                        )}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showTooltips && hoveredDay && (
        <motion.div
          animate={
            shouldReduceMotion ? { opacity: 1 } : { opacity: 1, scale: 1 }
          }
          className='bg-primary text-primary-foreground pointer-events-none fixed z-50 rounded-lg border px-3 py-2 text-sm shadow-lg'
          exit={
            shouldReduceMotion
              ? { opacity: 0, transition: { duration: 0 } }
              : { opacity: 0, scale: 0.8 }
          }
          initial={
            shouldReduceMotion ? { opacity: 1 } : { opacity: 0, scale: 0.8 }
          }
          style={{
            left: tooltipPosition.x + TOOLTIP_OFFSET_X,
            top: tooltipPosition.y - TOOLTIP_OFFSET_Y
          }}
          transition={shouldReduceMotion ? { duration: 0 } : { duration: 0.2 }}
        >
          <div className='font-semibold'>
            {getContributionText(hoveredDay.count)}
          </div>
          <div className='text-primary-foreground/70'>
            {formatDate(hoveredDay.date)}
          </div>
        </motion.div>
      )}

      {showLegend && (
        <div className='text-muted-foreground flex items-center justify-between text-xs'>
          <span>Less</span>
          <div className='flex items-center gap-1'>
            {CONTRIBUTION_LEVELS.map((level) => (
              <div
                className={cn('h-3 w-3 rounded-sm', CONTRIBUTION_COLORS[level])}
                key={level}
              />
            ))}
          </div>
          <span>More</span>
        </div>
      )}
    </div>
  );
}

export default ContributionGraph;
