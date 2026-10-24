import { createContext, useContext } from "react";
import type { Client } from "../core/types.js";

export const TrappContext = createContext<Client | null>(null);

/** Marks that a `<TrappErrorBoundary>` is already above — nested ones are not "root". */
export const BoundaryContext = createContext(false);

/** The client from the nearest `<TrappProvider>`: `captureException`, `setUser`, `setTag`, … */
export function useTrapp(): Client {
  const client = useContext(TrappContext);
  if (!client) throw new Error("useTrapp must be used inside <TrappProvider>");
  return client;
}
