"use client";

import { motion } from "motion/react";

export default function SettingsTemplate({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, x: 6 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{
        duration: 0.18,
        ease: [0.16, 1, 0.3, 1],
      }}
      className="flex-1 min-w-0"
    >
      {children}
    </motion.div>
  );
}
