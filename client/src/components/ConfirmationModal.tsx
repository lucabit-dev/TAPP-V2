import React from 'react';

interface ConfirmationModalProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  type?: 'danger' | 'warning' | 'info';
  onConfirm: () => void;
  onCancel: () => void;
}

const ConfirmationModal: React.FC<ConfirmationModalProps> = ({
  isOpen,
  title,
  message,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  type = 'danger',
  onConfirm,
  onCancel
}) => {
  if (!isOpen) return null;

  const getTypeStyles = () => {
    switch (type) {
      case 'danger':
        return {
          accent: 'border-[#f87171]',
          accentBg: 'bg-[#f87171]/10',
          button: 'bg-[#f87171] hover:bg-[#ef4444] text-[#14130e]',
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
          button: 'bg-[#fbbf24] hover:bg-[#f59e0b] text-[#14130e]',
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
          button: 'bg-[#3b82f6] hover:bg-[#2563eb] text-[#eae9e9]',
          shadow: 'shadow-[0_0_8px_rgba(59,130,246,0.3)]',
          icon: (
            <svg className="w-8 h-8 text-[#3b82f6]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          )
        };
    }
  };

  const styles = getTypeStyles();

  return (
    <div
      className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4 animate-fadeIn"
      onClick={onCancel}
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
          <p className="text-[#eae9e9]/80 text-sm leading-relaxed whitespace-pre-line">
            {message}
          </p>
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-4 border-t border-[#2a2820]/60 flex items-center justify-end space-x-3">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm font-medium text-[#eae9e9]/70 hover:text-[#eae9e9] hover:bg-[#0f0e0a] transition-all duration-200 border border-transparent hover:border-[#2a2820]/70"
          >
            {cancelText}
          </button>
          <button
            onClick={onConfirm}
            className={`px-4 py-2 text-sm font-bold transition-all duration-200 ${styles.button} ${styles.shadow}`}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmationModal;

