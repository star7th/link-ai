import React from 'react';
import { cn } from '@/lib/utils';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'secondary' | 'outline' | 'ghost' | 'link' | 'destructive';
  size?: 'default' | 'sm' | 'lg' | 'icon';
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'default', size = 'default', ...props }, ref) => {
    const variantClasses = {
      default:
        'bg-gradient-to-r from-primary to-secondary text-white shadow-sm shadow-primary/20 hover:shadow-md hover:shadow-primary/30 hover:opacity-95 active:opacity-90',
      secondary:
        'bg-light-nav dark:bg-dark-nav text-light-text-primary dark:text-dark-text-primary border border-primary/20 hover:border-primary/40 hover:bg-light-card dark:hover:bg-dark-card active:bg-light-nav dark:active:bg-dark-nav',
      outline:
        'border border-primary/20 bg-transparent text-light-text-primary dark:text-dark-text-primary hover:bg-primary/5 hover:border-primary/30 active:bg-primary/10',
      ghost:
        'text-light-text-secondary dark:text-dark-text-secondary hover:bg-primary/5 hover:text-primary active:bg-primary/10',
      link: 'underline-offset-4 hover:underline text-primary',
      destructive:
        'bg-error text-white shadow-sm hover:bg-error/90 active:bg-error/80',
    };

    const sizeClasses = {
      default: 'h-10 py-2 px-4',
      sm: 'h-9 px-3 rounded-md text-xs',
      lg: 'h-11 px-8 rounded-md',
      icon: 'h-10 w-10',
    };

    return (
      <button
        className={cn(
          'inline-flex items-center justify-center rounded-md text-sm font-medium transition-all duration-200',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:ring-offset-2',
          'disabled:opacity-50 disabled:pointer-events-none',
          variantClasses[variant],
          sizeClasses[size],
          className
        )}
        ref={ref}
        {...props}
      />
    );
  }
);

Button.displayName = 'Button';

export { Button };
