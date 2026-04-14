"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";

interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  onConfirm: () => void;
  onCancel: () => void;
  isDestructive?: boolean;
}

export function ConfirmDialog({
  isOpen,
  title,
  message,
  confirmText = "确认",
  cancelText = "取消",
  onConfirm,
  onCancel,
  isDestructive = false
}: ConfirmDialogProps) {
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);

    if (isOpen) {
      document.body.style.overflow = "hidden";
    }

    return () => {
      document.body.style.overflow = "auto";
    };
  }, [isOpen]);

  if (!isMounted || !isOpen) return null;

  const dialog = (
    <div className="fixed inset-0 z-[100] flex items-center justify-center animate-fadeIn">
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onCancel}
      />

      <div className="relative max-w-md w-full mx-4 rounded-lg shadow-lg border border-primary/20 dark:border-primary/15 bg-light-card dark:bg-dark-card overflow-hidden animate-slideIn">
        <div className="p-6">
          <h3 className="text-lg font-semibold text-light-text-primary dark:text-dark-text-primary mb-2">{title}</h3>
          <p className="text-light-text-secondary dark:text-dark-text-secondary">{message}</p>

          <div className="mt-6 flex justify-end space-x-3">
            <button
              className="px-4 py-2 rounded-md text-sm font-medium border border-primary/20 dark:border-primary/30 text-light-text-primary dark:text-dark-text-primary hover:bg-primary/5 transition-all duration-200"
              onClick={onCancel}
            >
              {cancelText}
            </button>
            <button
              className={`px-4 py-2 rounded-md text-sm font-medium text-white transition-all duration-200 ${
                isDestructive
                  ? "bg-error hover:bg-error/90 shadow-sm shadow-error/20"
                  : "bg-gradient-to-r from-primary to-secondary hover:opacity-95 shadow-sm shadow-primary/20"
              }`}
              onClick={onConfirm}
            >
              {confirmText}
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(dialog, document.body);
}
