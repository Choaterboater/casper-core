export type SandboxNetwork = "ask" | "host" | "none";

export interface SandboxWrapOptions {
  cwd: string;
  network?: SandboxNetwork;
  /** Folders this command may also write. */
  extraWrite?: string[];
  /** The project is read-only too. */
  readOnlyProject?: boolean;
}

export interface WrappedCommand {
  /** A shell line to run with `sh -c` (or cmd.exe on Windows). */
  command: string;
  /** Whether the sandbox holds this run. */
  held: boolean;
  /** Ties what the sandbox refused to this run. */
  id?: string;
}

/**
 * The shell sandbox a command check may run inside. casper-core carries no global sandbox: the caller
 * passes one on the call, or none. Implementations live outside the kernel.
 */
export interface CommandSandbox {
  readonly on: boolean;
  /** True when this project's checks run outside the sandbox. */
  checksOutside(): boolean | Promise<boolean>;
  wrap(command: string, options: SandboxWrapOptions): Promise<WrappedCommand>;
  /** The run is over; release what the sandbox held for it. */
  finished(id: string): void;
  /** Why the sandbox refused this run, read from its monitor and the run's own output. */
  blockedReason(id: string, output: string): string | undefined;
  /** Set when the sandbox failed to start; checks then run unheld and the caller can say so. */
  readonly failure?: string;
}
