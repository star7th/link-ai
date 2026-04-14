import { ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * 组合样式类名的实用函数，结合clsx和tailwind-merge功能
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
} 