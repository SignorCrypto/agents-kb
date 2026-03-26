import { forwardRef } from 'react';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  error?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className = '', error, ...props }, ref) => {
    return (
      <input
        ref={ref}
        className={`w-full px-3 py-2 text-sm rounded-lg border bg-surface-elevated text-content-primary focus:outline-none focus:ring-2 focus:ring-focus-ring/40 transition-colors placeholder:text-content-tertiary ${
          error ? 'border-semantic-error' : 'border-chrome'
        } ${className}`}
        {...props}
      />
    );
  },
);

Input.displayName = 'Input';

interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  error?: boolean;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className = '', error, ...props }, ref) => {
    return (
      <textarea
        ref={ref}
        className={`w-full px-3 py-2 text-sm rounded-lg border bg-surface-elevated text-content-primary focus:outline-none focus:ring-2 focus:ring-focus-ring/40 transition-colors placeholder:text-content-tertiary resize-none ${
          error ? 'border-semantic-error' : 'border-chrome'
        } ${className}`}
        {...props}
      />
    );
  },
);

Textarea.displayName = 'Textarea';
