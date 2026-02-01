import React from 'react';

interface ProgressBarProps {
  currentStep: number;
  steps: { id: number; title: string }[];
  onStepClick?: (stepId: number) => void;
}

const ProgressBar: React.FC<ProgressBarProps> = ({ currentStep, steps, onStepClick }) => {
  return (
    <div className="w-full py-4">
      <div className="flex items-center justify-center">
        {steps.map((step, index) => (
          <React.Fragment key={step.id}>
            {/* ステップ円 - グラデーション */}
            <div className="flex flex-col items-center">
              <button
                onClick={() => onStepClick && currentStep > step.id && onStepClick(step.id)}
                disabled={currentStep < step.id}
                className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold transition-all ${
                  currentStep >= step.id
                    ? 'text-white'
                    : 'bg-gray-200 text-gray-500'
                } ${currentStep > step.id && onStepClick ? 'cursor-pointer hover:opacity-80' : ''}`}
                style={currentStep >= step.id ? {
                  background: 'linear-gradient(135deg, #0D4F4F 0%, #1A365D 100%)'
                } : {}}
              >
                {currentStep > step.id ? '✓' : step.id}
              </button>
              <span
                className={`mt-2 text-sm ${
                  currentStep >= step.id ? 'text-[#0D4F4F] font-medium' : 'text-gray-400'
                }`}
              >
                {step.title}
              </span>
            </div>
            
            {/* 接続線 - グラデーション */}
            {index < steps.length - 1 && (
              <div
                className={`w-24 h-1 mx-2 transition-all ${
                  currentStep > step.id ? '' : 'bg-gray-200'
                }`}
                style={currentStep > step.id ? {
                  background: 'linear-gradient(90deg, #0D4F4F 0%, #1A365D 100%)'
                } : {}}
              />
            )}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
};

export default ProgressBar;
