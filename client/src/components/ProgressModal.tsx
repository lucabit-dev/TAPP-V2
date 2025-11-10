import React from 'react';

interface ProgressStep {
  id: string;
  label: string;
  status: 'pending' | 'active' | 'completed' | 'error';
}

interface ProgressModalProps {
  isOpen: boolean;
  title: string;
  steps: ProgressStep[];
  currentStep?: string;
  message?: string;
  onClose?: () => void;
  type?: 'danger' | 'warning' | 'info' | 'success';
}

const ProgressModal: React.FC<ProgressModalProps> = ({
  isOpen,
  title,
  steps,
  currentStep,
  message,
  onClose,
  type = 'danger'
}) => {
  if (!isOpen) return null;

  const getTypeStyles = () => {
    switch (type) {
      case 'danger':
        return {
          accent: 'border-[#f87171]',
          accentBg: 'bg-[#f87171]/10',
          active: 'bg-[#f87171]/20',
          shadow: 'shadow-[0_0_8px_rgba(248,113,113,0.3)]',
          icon: (
            <svg className="w-8 h-8 text-[#f87171]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          )
        };
      case 'warning':
        return {
          accent: 'border-[#fbbf24]',
          accentBg: 'bg-[#fbbf24]/10',
          active: 'bg-[#fbbf24]/20',
          shadow: 'shadow-[0_0_8px_rgba(251,191,36,0.3)]',
          icon: (
            <svg className="w-8 h-8 text-[#fbbf24]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          )
        };
      case 'info':
        return {
          accent: 'border-[#3b82f6]',
          accentBg: 'bg-[#3b82f6]/10',
          active: 'bg-[#3b82f6]/20',
          shadow: 'shadow-[0_0_8px_rgba(59,130,246,0.3)]',
          icon: (
            <svg className="w-8 h-8 text-[#3b82f6]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          )
        };
      case 'success':
        return {
          accent: 'border-[#22c55e]',
          accentBg: 'bg-[#22c55e]/10',
          active: 'bg-[#22c55e]/20',
          shadow: 'shadow-[0_0_8px_rgba(34,197,94,0.3)]',
          icon: (
            <svg className="w-8 h-8 text-[#22c55e]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          )
        };
    }
  };

  const styles = getTypeStyles();

  const getStepIcon = (step: ProgressStep) => {
    if (step.status === 'completed') {
      return (
        <div className="w-6 h-6 rounded-full bg-[#22c55e] flex items-center justify-center">
          <svg className="w-4 h-4 text-[#14130e]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
      );
    }
    if (step.status === 'error') {
      return (
        <div className="w-6 h-6 rounded-full bg-[#f87171] flex items-center justify-center">
          <svg className="w-4 h-4 text-[#14130e]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </div>
      );
    }
    if (step.status === 'active') {
      return (
        <div className="w-6 h-6 rounded-full border-2 border-[#22c55e] flex items-center justify-center">
          <div className="w-3 h-3 rounded-full bg-[#22c55e] animate-pulse"></div>
        </div>
      );
    }
    return (
      <div className="w-6 h-6 rounded-full border-2 border-[#2a2820] flex items-center justify-center">
        <div className="w-2 h-2 rounded-full bg-[#808080]"></div>
      </div>
    );
  };

  const completedSteps = steps.filter(s => s.status === 'completed').length;
  const progressPercentage = (completedSteps / steps.length) * 100;

  const hasErrors = steps.some(s => s.status === 'error');
  const allCompleted = steps.every(s => s.status === 'completed' || s.status === 'error');
  const canClose = onClose && (type === 'success' || hasErrors || allCompleted);
  
  return (
    <div
      className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4 animate-fadeIn"
      onClick={canClose ? onClose : undefined}
    >
      <div
        className="bg-gradient-to-br from-[#14130e] via-[#0f0e0a] to-[#14130e] border border-[#2a2820] shadow-[0_0_30px_rgba(0,0,0,0.8)] w-full max-w-md overflow-hidden relative"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Sci-fi corner accents */}
        <div className="absolute top-0 left-0 w-16 h-16 border-t-2 border-l-2 border-[#22c55e]/30 pointer-events-none"></div>
        <div className="absolute top-0 right-0 w-16 h-16 border-t-2 border-r-2 border-[#22c55e]/30 pointer-events-none"></div>
        <div className="absolute bottom-0 left-0 w-16 h-16 border-b-2 border-l-2 border-[#22c55e]/30 pointer-events-none"></div>
        <div className="absolute bottom-0 right-0 w-16 h-16 border-b-2 border-r-2 border-[#22c55e]/30 pointer-events-none"></div>

        {/* Modal Header */}
        <div className={`${styles.accentBg} border-b border-[#2a2820]/60 px-6 py-4`}>
          <div className="flex items-center space-x-3">
            <div className="flex-shrink-0">
              {styles.icon}
            </div>
            <h3 className="text-lg font-bold text-[#eae9e9] tracking-wider font-mono uppercase">
              {title}
            </h3>
          </div>
        </div>

        {/* Modal Content */}
        <div className="p-6">
          {/* Progress Bar */}
          <div className="mb-6">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-[#808080] uppercase tracking-wider">Progress</span>
              <span className="text-xs text-[#808080] font-mono">{Math.round(progressPercentage)}%</span>
            </div>
            <div className="h-2 bg-[#0f0e0a] border border-[#2a2820] rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-[#22c55e] to-[#16a34a] transition-all duration-500 ease-out"
                style={{ width: `${progressPercentage}%` }}
              ></div>
            </div>
          </div>

          {/* Progress Steps */}
          <div className="space-y-4">
            {steps.map((step, index) => (
              <div
                key={step.id}
                className={`flex items-center space-x-3 p-3 rounded border transition-all duration-200 ${
                  step.status === 'active'
                    ? `${styles.active} border-[#22c55e]/30`
                    : step.status === 'completed'
                    ? 'bg-[#22c55e]/5 border-[#22c55e]/20'
                    : step.status === 'error'
                    ? 'bg-[#f87171]/5 border-[#f87171]/20'
                    : 'bg-[#0f0e0a] border-[#2a2820]'
                }`}
              >
                {getStepIcon(step)}
                <div className="flex-1">
                  <p
                    className={`text-sm font-medium ${
                      step.status === 'active'
                        ? 'text-[#eae9e9]'
                        : step.status === 'completed'
                        ? 'text-[#22c55e]'
                        : step.status === 'error'
                        ? 'text-[#f87171]'
                        : 'text-[#808080]'
                    }`}
                  >
                    {step.label}
                  </p>
                </div>
              </div>
            ))}
          </div>

          {/* Message */}
          {message && (
            <div className="mt-4 p-3 bg-[#0f0e0a] border border-[#2a2820] rounded">
              <p className="text-xs text-[#eae9e9]/80 leading-relaxed">{message}</p>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        {canClose && (
          <div className="px-6 py-4 border-t border-[#2a2820]/60 flex items-center justify-end">
            <button
              onClick={onClose}
              className={`px-4 py-2 text-sm font-bold transition-all duration-200 ${
                hasErrors
                  ? 'bg-[#f87171] hover:bg-[#ef4444] text-[#14130e] shadow-[0_0_8px_rgba(248,113,113,0.3)]'
                  : 'bg-[#22c55e] hover:bg-[#16a34a] text-[#14130e] shadow-[0_0_8px_rgba(34,197,94,0.3)]'
              }`}
            >
              Close
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default ProgressModal;

