
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
  error?: string;
}

export const FactorySelector: React.FC<FactorySelectorProps> = ({
  factories,
  factoryId,
  setFactoryId,
  factoryOpen,
  setFactoryOpen,
  error,
}) => {
  return (
    <div className="space-y-2">
      <Label htmlFor="factory">工廠 *</Label>
      <Popover open={factoryOpen} onOpenChange={setFactoryOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={factoryOpen}
            className="w-full justify-between"
          >
            {factoryId
              ? factories?.find((factory) => factory.id === factoryId)?.name
              : "選擇工廠..."}
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[--radix-popover-trigger-width] p-0">
          <Command>
            <CommandInput placeholder="搜尋工廠..." />
            <CommandList>
              <CommandEmpty>未找到工廠。</CommandEmpty>
              <CommandGroup>
                {factories?.map((factory) => (
                  <CommandItem
                    key={factory.id}
                    value={factory.name}
                    onSelect={() => {
                      console.log("Selected factory ID:", factory.id);
                      setFactoryId(factory.id);
                      setFactoryOpen(false);
                    }}
                  >
                    {factory.name}
                    <Check
                      className={cn(
                        "ml-auto h-4 w-4",
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
      {error && (
        <p className="text-sm text-red-600">{error}</p>
      )}
    </div>
  );
};
