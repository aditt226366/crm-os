"use client";

import { motion } from "framer-motion";

const particles = Array.from({ length: 42 }).map((_, index) => ({
  id: index,
  x: `${8 + ((index * 17) % 84)}%`,
  y: `${12 + ((index * 23) % 76)}%`,
  size: 2 + (index % 5),
  delay: (index % 9) * 0.18
}));

export function AuthOrbBackground() {
  return (
    <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden bg-[#030712]" aria-hidden="true">
      <motion.div
        className="absolute left-1/2 top-1/2 h-[44rem] w-[44rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,rgba(34,211,238,0.34),rgba(37,99,235,0.18)_34%,transparent_67%)] blur-2xl"
        animate={{ scale: [0.96, 1.06, 0.98], opacity: [0.72, 0.98, 0.78] }}
        transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.div
        className="absolute -right-40 top-20 h-[30rem] w-[30rem] rounded-full bg-[radial-gradient(circle,rgba(37,99,235,0.28),transparent_70%)] blur-3xl"
        animate={{ y: [0, 36, 0], x: [0, -24, 0] }}
        transition={{ duration: 10, repeat: Infinity, ease: "easeInOut" }}
      />
      <div className="grid-mask absolute inset-0 opacity-50" />
      {particles.map((particle) => (
        <motion.span
          key={particle.id}
          className="absolute rounded-full bg-cyan-200 shadow-[0_0_18px_rgba(34,211,238,0.75)]"
          style={{
            left: particle.x,
            top: particle.y,
            width: particle.size,
            height: particle.size
          }}
          animate={{ y: [0, -18, 0], opacity: [0.18, 0.86, 0.22], scale: [0.8, 1.25, 0.9] }}
          transition={{ duration: 4.5 + (particle.id % 6), delay: particle.delay, repeat: Infinity, ease: "easeInOut" }}
        />
      ))}
    </div>
  );
}
