/**
 * The terminal's command group.
 *
 * Commands are code, not config: each one is a function that acts on the
 * terminal through `TerminalCommandContext` rather than reaching into the
 * component, which keeps this file free of Angular and trivially unit-testable.
 *
 * To add one, append to TERMINAL_COMMANDS — the matcher below is the only
 * consumer.
 */
export interface TerminalCommandContext {
  /** Erase the screen. The command history is deliberately left untouched. */
  clearScreen(): void;
  /** The commands typed so far, oldest first, with line continuations spliced. */
  commandList(): readonly string[];
  /** Append machine output to the scrollback: lines with no prompt. */
  printOutput(lines: readonly string[]): void;
}

export interface TerminalCommand {
  readonly name: string;
  /** One-liner for a future `help`. */
  readonly summary: string;
  run(context: TerminalCommandContext, args: readonly string[]): void;
}

const clear: TerminalCommand = {
  name: 'clear',
  summary: 'clear the screen',
  run(context) {
    context.clearScreen();
  },
};

/**
 * Bash numbers history from 1 and keeps those numbers stable, so the numbering
 * here is the absolute position in the command list rather than the position in
 * whatever subset `history <n>` happens to show.
 */
const history: TerminalCommand = {
  name: 'history',
  summary: 'show the commands you typed',
  run(context, args) {
    const commands = context.commandList();
    const count = Number(args[0]);
    // `history` with no usable count shows everything; a non-numeric or
    // non-positive argument is treated as "no limit" rather than as an error,
    // which is what a shell does with `history abc`.
    const limited = Number.isInteger(count) && count > 0 ? commands.slice(-count) : commands;
    const firstNumber = commands.length - limited.length + 1;
    const width = String(commands.length).length;

    context.printOutput(
      limited.map((command, index) => `${String(firstNumber + index).padStart(width)}  ${command}`),
    );
  },
};

/**
 * Lists what can be typed. Built from TERMINAL_COMMANDS rather than a hand
 * written list, so a command cannot be added here and forgotten there.
 *
 * Sorted because the registry order is authoring order, and a list that
 * reshuffles when someone appends to the array is a nuisance.
 */
const help: TerminalCommand = {
  name: 'help',
  summary: 'list the available commands',
  run(context) {
    const width = Math.max(...TERMINAL_COMMANDS.map((command) => command.name.length));
    context.printOutput(
      [...TERMINAL_COMMANDS]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((command) => `${command.name.padEnd(width)}  ${command.summary}`),
    );
  },
};

export const TERMINAL_COMMANDS: readonly TerminalCommand[] = [clear, history, help];

export interface Invocation {
  readonly command: TerminalCommand;
  readonly args: readonly string[];
}

/**
 * Match by exact first token, so `clearx` is not a command while `clear -x` is.
 *
 * Arguments are handed to the command untouched: `clear` ignores the tput
 * options it cannot honour, while `history` reads its count from them.
 */
export function findCommand(line: string): Invocation | undefined {
  const [name = '', ...args] = line.trim().split(/\s+/);
  const command = TERMINAL_COMMANDS.find((candidate) => candidate.name === name);
  return command ? { command, args } : undefined;
}
