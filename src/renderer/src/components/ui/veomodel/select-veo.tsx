'use client';

import { Select } from '@/components/ui/select';

export interface SelectVeoOption {
  id: string;
  displayName: string;
}

export interface SelectVeoProps {
  value: string;
  onChange: (value: string) => void;
  options: SelectVeoOption[];
  loading?: boolean;
  disabled?: boolean;
  /** Hiện label "Model Veo" — tắt khi đã bọc Field bên ngoài */
  showLabel?: boolean;
  id?: string;
  className?: string;
  selectClassName?: string;
}

/** Dựng trên `Select` chung (base-ui) thay vì `<select>` native — đồng bộ keyboard/popup style
 * với phần còn lại của app (UX_UI_AUDIT.md, mục 15.6). Trạng thái loading/rỗng đưa thẳng vào
 * options dạng "option ảo" (value rỗng) để `Select` luôn có 1 item khớp `value` hiện tại — base-ui
 * Select không tự hiện placeholder cho value không khớp item nào trong danh sách. */
export function SelectVeo({
  value,
  onChange,
  options,
  loading = false,
  disabled = false,
  showLabel = true,
  id,
  className,
  selectClassName,
}: SelectVeoProps) {
  const isDisabled = disabled || loading || options.length === 0;

  const selectOptions = loading
    ? [{ value: '', label: 'Đang tải model...' }]
    : options.length === 0
      ? [{ value: '', label: 'Chưa có model' }]
      : options.map((m) => ({ value: m.id, label: m.displayName }));

  const resolvedValue = selectOptions.some((o) => o.value === value) ? value : selectOptions[0].value;

  return (
    <div className={className}>
      {showLabel && (
        <label htmlFor={id} className="field-label block mb-1.5">
          Model Veo
        </label>
      )}
      <Select
        id={id}
        value={resolvedValue}
        onChange={onChange}
        options={selectOptions}
        disabled={isDisabled}
        aria-label={showLabel ? undefined : 'Model Veo'}
        className={selectClassName}
      />
    </div>
  );
}
