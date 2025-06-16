
import React, { useState } from 'react';
import { Check, ChevronsUpDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

interface ComboboxOption {
  value: string;
  label: string;
  extra?: React.ReactNode;
}

interface ComboboxProps {
  options: ComboboxOption[];
  value?: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  className?: string;
  disabled?: boolean;
}

export const Combobox: React.FC<ComboboxProps> = ({
  options,
  value,
  onValueChange,
  placeholder = "選擇選項...",
  searchPlaceholder = "搜尋...",
  emptyText = "未找到選項",
  className,
  disabled = false,
}) => {
  const [open, setOpen] = useState(false);

  const selectedOption = options.find(option => option.value === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn(
            "justify-between bg-white border-gray-300 text-gray-900 hover:bg-gray-50 focus:border-blue-500 focus:ring-blue-500",
            className
          )}
          disabled={disabled}
        >
          <span className="text-gray-900 opacity-100">
            {selectedOption ? selectedOption.label : placeholder}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0 bg-white border-gray-200 shadow-lg z-50" align="start">
        <Command className="bg-white">
          <CommandInput 
            placeholder={searchPlaceholder} 
            className="h-9 border-0 text-gray-900 placeholder:text-gray-500" 
          />
          <CommandList className="bg-white">
            <CommandEmpty className="text-gray-500 text-sm py-6 text-center">
              {emptyText}
            </CommandEmpty>
            <CommandGroup className="bg-white">
              {options.map((option) => (
                <CommandItem
                  key={option.value}
                  value={option.label}
                  onSelect={() => {
                    onValueChange(option.value);
                    setOpen(false);
                  }}
                  className="cursor-pointer text-gray-900 hover:bg-blue-50 hover:text-blue-900 data-[selected]:bg-blue-50 data-[selected]:text-blue-900"
                >
                  <div className="flex flex-col flex-1">
                    <span className="text-gray-900">{option.label}</span>
                    {option.extra && <div className="text-xs text-gray-500">{option.extra}</div>}
                  </div>
                  <Check
                    className={cn(
                      "ml-auto h-4 w-4 text-blue-600",
                      value === option.value ? "opacity-100" : "opacity-0"
                    )}
                  />
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
};
