
import React, { useState, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { useStockThresholds } from '@/hooks/useStockThresholds';

interface ThresholdInputProps {
  productId: string;
  productName: string;
  disabled?: boolean;
  onThresholdChange?: (threshold: number | null) => void;
}

export const ThresholdInput: React.FC<ThresholdInputProps> = ({
  productId,
  productName,
  disabled = false,
  onThresholdChange,
}) => {
  const { getThresholdByProductId, setThreshold, deleteThreshold } = useStockThresholds();
  const [thresholdValue, setThresholdValue] = useState<string>('');
  const [isEditing, setIsEditing] = useState(false);

  useEffect(() => {
    const existingThreshold = getThresholdByProductId(productId);
    if (existingThreshold) {
      setThresholdValue(existingThreshold.threshold_quantity.toString());
      onThresholdChange?.(existingThreshold.threshold_quantity);
    } else {
      setThresholdValue('');
      onThresholdChange?.(null);
    }
  }, [productId, getThresholdByProductId, onThresholdChange]);

  const handleSave = async () => {
    const numValue = parseFloat(thresholdValue);
    if (isNaN(numValue) || numValue < 0) {
      return;
    }

    const success = await setThreshold(productId, numValue);
    if (success) {
      setIsEditing(false);
      onThresholdChange?.(numValue);
    }
  };

  const handleDelete = async () => {
    const success = await deleteThreshold(productId);
    if (success) {
      setThresholdValue('');
      setIsEditing(false);
      onThresholdChange?.(null);
    }
  };

  const existingThreshold = getThresholdByProductId(productId);

  return (
    <div className="space-y-2">
      <Label className="text-sm text-gray-700">
        庫存閾值 (KG) - {productName}
      </Label>
      
      {!isEditing && existingThreshold ? (
        <div className="flex items-center space-x-2">
          <span className="text-sm font-medium text-green-700">
            {existingThreshold.threshold_quantity} KG
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setIsEditing(true)}
            disabled={disabled}
            className="text-xs"
          >
            編輯
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleDelete}
            disabled={disabled}
            className="text-xs text-red-600 hover:text-red-700"
          >
            刪除
          </Button>
        </div>
      ) : (
        <div className="flex items-center space-x-2">
          <Input
            type="number"
            min="0"
            step="0.1"
            placeholder="設定庫存閾值"
            value={thresholdValue}
            onChange={(e) => setThresholdValue(e.target.value)}
            disabled={disabled}
            className="w-32 text-sm"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleSave}
            disabled={disabled || !thresholdValue || isNaN(parseFloat(thresholdValue)) || parseFloat(thresholdValue) < 0}
            className="text-xs"
          >
            保存
          </Button>
          {isEditing && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setIsEditing(false);
                const existingThreshold = getThresholdByProductId(productId);
                setThresholdValue(existingThreshold?.threshold_quantity.toString() || '');
              }}
              disabled={disabled}
              className="text-xs"
            >
              取消
            </Button>
          )}
        </div>
      )}
    </div>
  );
};
