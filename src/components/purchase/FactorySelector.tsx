
import React from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Check, ChevronsUpDown } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

interface Factory {
  id: string;
  name: string;
}

interface FactorySelectorProps {
  factories?: Factory[];
  factoryId: string;
  setFactoryId: (id: string) => void;
  factoryOpen: boolean;
  setFactoryOpen: (open: boolean) => void;
}

export const FactorySelector: React.FC<FactorySelectorProps> = ({
  factories,
  factoryId,
  setFactoryId,
  factoryOpen,
  setFactoryOpen,
}) => {
  return (
    <div className="space-y-2">
      <Label htmlFor="factory" className="text-gray-800 font-medium">工廠 *</Label>
      <Popover open={factoryOpen} onOpenChange={setFactoryOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={factoryOpen}
            className="w-full justify-between bg-white border-gray-300 text-gray-900 hover:bg-gray-50 focus:border-blue-500 focus:ring-blue-500"
          >
            <span className="text-gray-900 opacity-100">
              {factoryId
                ? factories?.find((factory) => factory.id === factoryId)?.name
                : "選擇工廠..."}
            </span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[--radix-popover-trigger-width] p-0 bg-white border-gray-200 shadow-lg z-50">
          <Command className="bg-white">
            <CommandInput 
              placeholder="搜尋工廠..." 
              className="h-9 border-0 text-gray-900 placeholder:text-gray-500" 
            />
            <CommandList className="bg-white">
              <CommandEmpty className="text-gray-500 text-sm py-6 text-center">
                未找到工廠。
              </CommandEmpty>
              <CommandGroup className="bg-white">
                {factories?.map((factory) => (
                  <CommandItem
                    key={factory.id}
                    value={factory.name}
                    onSelect={() => {
                      setFactoryId(factory.id);
                      setFactoryOpen(false);
                    }}
                    className="cursor-pointer text-gray-900 hover:bg-blue-50 hover:text-blue-900 data-[selected]:bg-blue-50 data-[selected]:text-blue-900"
                  >
                    <span className="text-gray-900">{factory.name}</span>
                    <Check
                      className={cn(
                        "ml-auto h-4 w-4 text-blue-600",
                        factoryId === factory.id ? "opacity-100" : "opacity-0"
                      )}
                    />
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
};
