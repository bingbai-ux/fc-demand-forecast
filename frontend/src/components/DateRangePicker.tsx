import { useState, useRef, useEffect } from 'react';
import { format, subDays, startOfMonth, endOfMonth, subMonths, addMonths, 
         startOfWeek, endOfWeek, eachDayOfInterval, isSameMonth, isSameDay,
         isWithinInterval } from 'date-fns';
import { ja } from 'date-fns/locale';
import { Calendar, ChevronLeft, ChevronRight, ChevronDown, X } from 'lucide-react';

interface DateRangePickerProps {
  fromDate: string;
  toDate: string;
  onDateChange: (from: string, to: string) => void;
}

export function DateRangePicker({
  fromDate,
  toDate,
  onDateChange,
}: DateRangePickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [tempFrom, setTempFrom] = useState<Date | null>(new Date(fromDate));
  const [tempTo, setTempTo] = useState<Date | null>(new Date(toDate));
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectingStart, setSelectingStart] = useState(true);
  const pickerRef = useRef<HTMLDivElement>(null);

  // 外側クリックで閉じる
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // fromDate/toDateが外部から変更された場合に同期
  useEffect(() => {
    setTempFrom(new Date(fromDate));
    setTempTo(new Date(toDate));
  }, [fromDate, toDate]);

  // クイック選択
  const quickSelections = [
    { label: '今日', getRange: () => {
      const today = new Date();
      return { from: today, to: today };
    }},
    { label: '昨日', getRange: () => {
      const yesterday = subDays(new Date(), 1);
      return { from: yesterday, to: yesterday };
    }},
    { label: '過去7日', getRange: () => {
      const today = new Date();
      return { from: subDays(today, 6), to: today };
    }},
    { label: '過去30日', getRange: () => {
      const today = new Date();
      return { from: subDays(today, 29), to: today };
    }},
    { label: '今月', getRange: () => {
      const today = new Date();
      return { from: startOfMonth(today), to: today };
    }},
    { label: '先月', getRange: () => {
      const lastMonth = subMonths(new Date(), 1);
      return { from: startOfMonth(lastMonth), to: endOfMonth(lastMonth) };
    }},
  ];

  const handleQuickSelect = (getRange: () => { from: Date; to: Date }) => {
    const { from, to } = getRange();
    setTempFrom(from);
    setTempTo(to);
  };

  const handleDateClick = (date: Date) => {
    if (selectingStart) {
      setTempFrom(date);
      setTempTo(null);
      setSelectingStart(false);
    } else {
      if (tempFrom && date < tempFrom) {
        setTempTo(tempFrom);
        setTempFrom(date);
      } else {
        setTempTo(date);
      }
      setSelectingStart(true);
    }
  };

  const handleApply = () => {
    if (tempFrom && tempTo) {
      onDateChange(format(tempFrom, 'yyyy-MM-dd'), format(tempTo, 'yyyy-MM-dd'));
      setIsOpen(false);
    }
  };

  const renderCalendar = (monthDate: Date) => {
    const monthStart = startOfMonth(monthDate);
    const monthEnd = endOfMonth(monthDate);
    const calendarStart = startOfWeek(monthStart, { weekStartsOn: 0 });
    const calendarEnd = endOfWeek(monthEnd, { weekStartsOn: 0 });
    const days = eachDayOfInterval({ start: calendarStart, end: calendarEnd });

    const weekDays = ['日', '月', '火', '水', '木', '金', '土'];

    return (
      <div className="w-56">
        <div className="text-center font-semibold mb-2 text-gray-700">
          {format(monthDate, 'yyyy年 M月', { locale: ja })}
        </div>
        <div className="grid grid-cols-7 gap-0.5 text-center text-sm">
          {weekDays.map((day, idx) => (
            <div 
              key={day} 
              className={`font-medium py-1 ${idx === 0 ? 'text-red-400' : idx === 6 ? 'text-blue-400' : 'text-gray-500'}`}
            >
              {day}
            </div>
          ))}
          {days.map((day, idx) => {
            const isCurrentMonth = isSameMonth(day, monthDate);
            const isSelected = (tempFrom && isSameDay(day, tempFrom)) || 
                              (tempTo && isSameDay(day, tempTo));
            const isInRange = tempFrom && tempTo && 
                             isWithinInterval(day, { start: tempFrom, end: tempTo });
            const isToday = isSameDay(day, new Date());
            const dayOfWeek = day.getDay();

            return (
              <button
                key={idx}
                onClick={() => isCurrentMonth && handleDateClick(day)}
                disabled={!isCurrentMonth}
                className={`
                  py-1.5 rounded text-sm transition-colors
                  ${!isCurrentMonth ? 'text-gray-300 cursor-default' : 'hover:bg-[#0D4F4F]/10 cursor-pointer'}
                  ${isSelected ? 'bg-[#0D4F4F] text-white hover:bg-[#0A3D3D]' : ''}
                  ${isInRange && !isSelected ? 'bg-[#0D4F4F]/10' : ''}
                  ${isToday && !isSelected ? 'ring-1 ring-[#0D4F4F]' : ''}
                  ${isCurrentMonth && !isSelected && !isInRange && dayOfWeek === 0 ? 'text-red-500' : ''}
                  ${isCurrentMonth && !isSelected && !isInRange && dayOfWeek === 6 ? 'text-blue-500' : ''}
                `}
              >
                {format(day, 'd')}
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  const displayDateRange = `${format(new Date(fromDate), 'yyyy/MM/dd')} - ${format(new Date(toDate), 'yyyy/MM/dd')}`;

  return (
    <div className="relative" ref={pickerRef}>
      {/* 日付表示ボタン */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg bg-white hover:bg-gray-50 transition-colors"
      >
        <Calendar className="w-5 h-5 text-gray-500" />
        <span className="text-sm font-medium text-gray-700">{displayDateRange}</span>
        <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {/* カレンダーポップアップ */}
      {isOpen && (
        <div className="absolute top-full left-0 mt-2 p-4 bg-white border border-gray-200 rounded-lg shadow-xl z-50">
          {/* 閉じるボタン */}
          <button
            onClick={() => setIsOpen(false)}
            className="absolute top-2 right-2 p-1 hover:bg-gray-100 rounded"
          >
            <X className="w-5 h-5 text-gray-400" />
          </button>

          {/* クイック選択ボタン */}
          <div className="flex flex-wrap gap-2 mb-4 pb-4 border-b border-gray-200">
            {quickSelections.map(({ label, getRange }) => (
              <button
                key={label}
                onClick={() => handleQuickSelect(getRange)}
                className="px-3 py-1.5 text-sm border border-gray-300 rounded-md hover:bg-gray-100 transition-colors"
              >
                {label}
              </button>
            ))}
          </div>

          {/* 選択中の日付表示 */}
          <div className="flex items-center gap-2 mb-4">
            <div className="flex items-center gap-2 px-3 py-1.5 border border-gray-300 rounded-md">
              <span className="text-xs text-gray-500">開始日</span>
              <span className="font-medium text-sm">
                {tempFrom ? format(tempFrom, 'yyyy/MM/dd') : '----/--/--'}
              </span>
            </div>
            <span className="text-gray-400">-</span>
            <div className="flex items-center gap-2 px-3 py-1.5 border border-gray-300 rounded-md">
              <span className="text-xs text-gray-500">終了日</span>
              <span className="font-medium text-sm">
                {tempTo ? format(tempTo, 'yyyy/MM/dd') : '----/--/--'}
              </span>
            </div>
            <button
              onClick={handleApply}
              disabled={!tempFrom || !tempTo}
              className="ml-2 px-4 py-1.5 text-white text-sm font-medium rounded-md hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              style={{ background: 'linear-gradient(90deg, #0D4F4F 0%, #1A365D 100%)' }}
            >
              日付を変更
            </button>
          </div>

          {/* カレンダー（2ヶ月表示） */}
          <div className="flex gap-6">
            <div>
              <button 
                onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}
                className="mb-2 p-1 hover:bg-gray-100 rounded transition-colors"
              >
                <ChevronLeft className="w-5 h-5 text-gray-600" />
              </button>
              {renderCalendar(subMonths(currentMonth, 1))}
            </div>
            <div>
              <button 
                onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}
                className="mb-2 p-1 hover:bg-gray-100 rounded float-right transition-colors"
              >
                <ChevronRight className="w-5 h-5 text-gray-600" />
              </button>
              {renderCalendar(currentMonth)}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default DateRangePicker;
