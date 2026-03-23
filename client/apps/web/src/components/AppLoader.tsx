import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";

interface AppLoaderProps {
  children: React.ReactNode;
}

/**
 * AppLoader Component
 * Shows a premium splash screen with the Quill logo animation for at least 2 seconds.
 */
export const AppLoader: React.FC<AppLoaderProps> = ({ children }) => {
  const [minDelayPassed, setMinDelayPassed] = useState(false);
  const [isAppReady, setIsAppReady] = useState(false);

  useEffect(() => {
    // 1. Mandatory 2 second timer
    const timer = setTimeout(() => {
      setMinDelayPassed(true);
    }, 2000);

    // 2. Simulate app readiness (could be actual data fetching or asset loading)
    // For now, we set it to true after 500ms
    const readyTimer = setTimeout(() => {
      setIsAppReady(true);
    }, 500);

    return () => {
      clearTimeout(timer);
      clearTimeout(readyTimer);
    };
  }, []);

  const showLoader = !minDelayPassed || !isAppReady;

  return (
    <>
      <AnimatePresence>
        {showLoader && (
          <motion.div
            key="app-loader"
            initial={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.5, ease: "easeInOut" }}
            className="fixed inset-0 z-[100] flex items-center justify-center bg-background"
          >
            <motion.div
              animate={{
                scale: [1, 1.08, 1],
              }}
              transition={{
                duration: 1.2,
                repeat: Infinity,
                ease: "easeInOut"
              }}
              className="flex flex-col items-center gap-6"
            >
              <div className="h-20 w-20 md:h-24 md:w-24">
                <img
                  src="/logo_cleaned.png"
                  alt="Quill Logo"
                  className="h-full w-full object-contain brightness-0 dark:invert"
                />
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <motion.div
        initial={{ opacity: 0, filter: "blur(10px)" }}
        animate={!showLoader ? { opacity: 1, filter: "blur(0px)" } : {}}
        transition={{ duration: 0.8, ease: "easeOut" }}
      >
        {children}
      </motion.div>
    </>
  );
};
