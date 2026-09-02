import { useEffect } from "react";
import { startClock, stopClock } from "@/state/store";

/** Starts the simulation clock once on the client. */
export function ClockStarter() {
  useEffect(() => {
    startClock();
    return stopClock;
  }, []);
  return null;
}
