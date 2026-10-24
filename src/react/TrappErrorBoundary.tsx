import { Component, useContext, type ErrorInfo, type ReactNode } from "react";
import { safe, truncate } from "../core/env.js";
import type { Client } from "../core/types.js";
import { BoundaryContext, TrappContext } from "./context.js";

export interface TrappErrorBoundaryProps {
  children?: ReactNode;
  /** What to render instead of the crashed subtree. */
  fallback?: ReactNode | ((props: { error: Error; reset: () => void }) => ReactNode);
  onError?: (error: Error, info: ErrorInfo) => void;
  /** Rendering again when any of these change clears the error. */
  resetKeys?: unknown[];
  /**
   * The root boundary is the one `redirectOnCrash` watches: an error it does not recover from
   * within 10 s counts as a crash. Detected automatically (no boundary above); override if needed.
   */
  root?: boolean;
}

interface State {
  error: Error | null;
}

type InnerProps = TrappErrorBoundaryProps & { client: Client | null; isRoot: boolean };

class Boundary extends Component<InnerProps, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    const { client, isRoot, onError } = this.props;
    safe(() => {
      if (info.componentStack) {
        client?.addBreadcrumb({ category: "react", message: truncate(info.componentStack.trim(), 500), level: "error" });
      }
      client?.captureException(error, { mechanism: "boundary", tags: { boundary: isRoot ? "root" : "nested" } });
      if (isRoot) client?.emit("crash", { recovered: false });
    });
    safe(() => onError?.(error, info));
  }

  componentDidUpdate(prev: InnerProps, prevState: State) {
    if (prevState.error && !this.state.error && this.props.isRoot) {
      safe(() => this.props.client?.emit("crash", { recovered: true }));
    }
    const keys = this.props.resetKeys;
    if (this.state.error && keys && prev.resetKeys && keys.some((k, i) => k !== prev.resetKeys![i])) this.reset();
  }

  reset = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const { fallback } = this.props;
    return typeof fallback === "function" ? fallback({ error, reset: this.reset }) : (fallback ?? null);
  }
}

/** Catches render errors, reports them, and lets `maintenance({ redirectOnCrash })` know about crashes. */
export function TrappErrorBoundary(props: TrappErrorBoundaryProps) {
  const client = useContext(TrappContext);
  const nested = useContext(BoundaryContext);
  return (
    <BoundaryContext.Provider value={true}>
      <Boundary {...props} client={client} isRoot={props.root ?? !nested} />
    </BoundaryContext.Provider>
  );
}
