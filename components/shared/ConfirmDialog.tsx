"use client";

import { motion, AnimatePresence } from "framer-motion";
import { NeonButton } from "@/components/shared/NeonButton";

export function ConfirmDialog({
  open,
  title,
  text,
  confirmLabel,
  onConfirm,
  onClose
}: {
  open: boolean;
  title: string;
  text: string;
  confirmLabel: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="fixed inset-0 z-[80] grid place-items-center bg-slate-950/70 p-4 backdrop-blur-xl"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <motion.div
            className="glass-panel max-w-md rounded-[28px] p-6"
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 12 }}
          >
            <p className="text-xl font-semibold text-white">{title}</p>
            <p className="mt-3 text-sm leading-6 text-slate-300">{text}</p>
            <div className="mt-6 flex justify-end gap-3">
              <NeonButton variant="secondary" onClick={onClose}>
                Cancel
              </NeonButton>
              <NeonButton onClick={onConfirm}>{confirmLabel}</NeonButton>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
