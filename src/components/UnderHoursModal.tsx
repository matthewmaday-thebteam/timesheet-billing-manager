import { Modal } from './Modal';
import type { UnderHoursResource } from '../utils/calculations';

interface UnderHoursModalProps {
  isOpen: boolean;
  onClose: () => void;
  items: UnderHoursResource[];
  expectedHours: number;
  workingDaysElapsed: number;
  workingDaysTotal: number;
}

export function UnderHoursModal({
  isOpen,
  onClose,
  items,
  expectedHours,
  workingDaysElapsed,
  workingDaysTotal,
}: UnderHoursModalProps) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Resources Under Target">
      <div className="space-y-6">
        {/* Summary Stats */}
        <div className="grid grid-cols-2 gap-4">
          <div className="p-4 bg-[#FAFAFA] rounded-lg border border-[#EAEAEA]">
            <p className="text-[12px] text-[#666666] mb-1">Prorated Target</p>
            <p className="text-lg font-semibold text-[#000000]">
              {expectedHours.toFixed(1)} hrs
            </p>
          </div>
          <div className="p-4 bg-[#FAFAFA] rounded-lg border border-[#EAEAEA]">
            <p className="text-[12px] text-[#666666] mb-1">Working Days</p>
            <p className="text-lg font-semibold text-[#000000]">
              {workingDaysElapsed} / {workingDaysTotal}
            </p>
          </div>
        </div>

        {/* Info Banner */}
        <div className="p-4 bg-[#FAFAFA] rounded-lg border border-[#EAEAEA]">
          <div className="flex items-start gap-3">
            <div className="w-2 h-2 rounded-full bg-[#F5A623] mt-1.5 flex-shrink-0" />
            <div>
              <p className="text-sm text-[#000000] font-medium">Monthly Target: 140 hours</p>
              <p className="text-[12px] text-[#666666] mt-1">
                Working days exclude weekends and Bulgarian public holidays
              </p>
            </div>
          </div>
        </div>

        {/* Resource List */}
        {items.length === 0 ? (
          <div className="text-center py-8">
            <div className="w-2.5 h-2.5 rounded-full bg-[#50E3C2] mx-auto mb-3" />
            <p className="text-sm text-[#666666]">All resources are on target</p>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center justify-between px-3 py-2 text-[12px] text-[#666666] uppercase tracking-wider">
              <span>Resource</span>
              <span>Hours (Actual / Expected)</span>
            </div>
            {items.map((item) => (
              <div
                key={item.userName}
                className="flex items-center justify-between p-4 bg-[#FFFFFF] rounded-lg border border-[#EAEAEA] hover:border-[#000000] transition-colors"
              >
                <div className="flex items-center gap-3">
                  <div className="w-2 h-2 rounded-full bg-[#EE0000]" />
                  <span className="text-sm font-medium text-[#000000]">{item.userName}</span>
                </div>
                <div className="text-right">
                  <span className="text-sm font-medium text-[#000000]">
                    {item.actualHours.toFixed(1)}h
                  </span>
                  <span className="text-sm text-[#666666] mx-1">/</span>
                  <span className="text-sm text-[#666666]">
                    {item.expectedHours.toFixed(1)}h
                  </span>
                  <span className="text-sm text-[#EE0000] ml-3">
                    -{item.deficit.toFixed(1)}h
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}
