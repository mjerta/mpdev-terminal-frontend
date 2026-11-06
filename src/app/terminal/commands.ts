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
import { FontChoice } from './terminal.config';

export interface TerminalCommandContext {
  /** Erase the screen. The command history is deliberately left untouched. */
  clearScreen(): void;
  /** The commands typed so far, oldest first, with line continuations spliced. */
  commandList(): readonly string[];
  /** Append machine output to the scrollback: lines with no prompt. */
  printOutput(lines: readonly string[]): void;
  /**
   * Append the `neofetch` block.
   *
   * Separate from `printOutput` because this one is not text: it is a logo plus a
   * two-column report, which the terminal hands to a component. Commands stay
   * Angular-free either way - the context is the seam, and what it draws behind it
   * is not this file's business.
   */
  showNeofetch(): void;
  /** The fonts that can be selected, in the order `--list` shows them. */
  fontCatalogue(): readonly FontChoice[];
  /** The family in use right now, whether or not it was saved. */
  currentFont(): FontChoice;
  /**
   * What IndexedDB holds, or null if nothing ever was.
   *
   * Separate from `currentFont` because the two disagree whenever a visitor tries
   * a font without committing it, and the whole point of asking is to be able to
   * say so on screen.
   */
  savedFontId(): string | null;
  /**
   * Select for this session. Returns false when the id is not in the catalogue,
   * so the command can report a refusal rather than print a success that did not
   * happen.
   */
  selectFont(id: string): boolean;
  /** Persist the current choice; resolves false when the browser refused the write. */
  saveFont(): Promise<boolean>;
}

/**
 * What a command hands back.
 *
 * Nothing means "it worked", a number is the exit status to record - which is how
 * `font` can answer 2 on a bad name the way a shell answers usage errors. A
 * promise is awaited before the status is recorded, so a command whose work is
 * asynchronous cannot report success before it knows.
 */
export type CommandOutcome = void | number | Promise<void | number>;

export interface TerminalCommand {
  readonly name: string;
  /** One-liner for a future `help`. */
  readonly summary: string;
  run(context: TerminalCommandContext, args: readonly string[]): CommandOutcome;
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

/**
 * The system report. Unlike the others this prints nothing itself: the output is a
 * logo and a two-column report, so it asks the terminal to place a block rather
 * than handing it lines. The data lives in the config map; see neofetch/.
 */
const neofetch: TerminalCommand = {
  name: 'neofetch',
  summary: 'show system information with the mpdev logo',
  run(context) {
    context.showNeofetch();
  },
};

/** bash's conventional exit code for a command it could not find. */
export const EXIT_NOT_FOUND = 127;

/**
 * bash's conventional exit code for being called incorrectly, which is what an
 * unknown font name is: the command exists, the argument does not.
 */
export const EXIT_USAGE = 2;

/** The font was chosen but the browser would not store it. */
export const EXIT_NOT_SAVED = 1;

/**
 * What a line of terminal output can be without wrapping on the smallest phone.
 *
 * `printOutput` commits text to the scrollback, and committed text cannot reflow
 * when the window changes, so the width budget is fixed at the narrowest screen
 * this app is realistic on: 320px, less the scroller's padding, at a nine-pixel
 * cell is 32 characters. Staying at 31 keeps a character of slack - the earlier
 * version of the `font` command padded a description column and produced
 * 97-character rows, which every phone then folded into a stack of ragged lines.
 *
 * Exported so `commands.spec.ts` can assert every line respects it.
 */
export const LINE_BUDGET = 31;

/** Shown wherever the visitor might need to know what else to type. */
const FONT_HINT = 'font <id>, --save to keep';

/**
 * The one warning the list carries, standing in for a per-row note column.
 *
 * What a choice actually changes is the text. The picture does not follow it: the
 * art needs every cell on one pitch, which only a single face can promise, so a
 * device family that has to substitute the box-drawing range per glyph would put
 * its spaces and its blocks at different widths and skew the logo. Saying that
 * plainly is worth a line; per-row descriptions were not worth ninety characters.
 */
const FONT_CAVEAT = 'art stays JetBrains Mono';

/** `nerd: JetBrains Mono` - the id, and the face's human name. */
function fontLine(choice: FontChoice): string {
  return `${choice.id}: ${choice.label}`;
}

/**
 * Whether the choice on screen is the choice that comes back after a reload.
 *
 * These genuinely differ, and the difference is the whole reason the command has a
 * `--save`: you can be looking at one font while IndexedDB remembers another.
 * Saying "saved" in that state would send the visitor away with the wrong plan.
 */
function fontState(context: TerminalCommandContext): string {
  const saved = context.savedFontId();
  const current = context.currentFont();
  if (saved === null) {
    return current.id === context.fontCatalogue()[0].id ? 'default, not saved' : 'session only';
  }
  return saved === current.id ? 'saved' : `session only, saved: ${saved}`;
}

/**
 * One row per selectable font, the current one marked, in the config's order.
 *
 * No aligned columns: padding the ids to the widest of them costs a character per
 * row to no purpose with this many entries, and a padded family column is exactly
 * the kind of thing that overflows a small screen.
 */
function fontTable(context: TerminalCommandContext): string[] {
  const current = context.currentFont();
  /*
    Config order, not alphabetical: the first entry is the default and the face the
    logo is pinned to, and a list that sorted itself would bury it under `mono`.
  */
  const rows = context
    .fontCatalogue()
    .map((choice) => `${choice.id === current.id ? '*' : ' '} ${fontLine(choice)}`);
  return [...rows, '', FONT_CAVEAT, FONT_HINT];
}

/** The reply after a selection: the row, its state, and how to go further. */
function selectionReply(context: TerminalCommandContext, saved: boolean): string[] {
  const line = fontLine(context.currentFont());
  if (!saved) return [line, '  selected, session only', FONT_HINT];
  return [line, '  selected and saved'];
}

/**
 * Choose, and show or keep, the terminal's font.
 *
 * `font` alone reports, `font --list` enumerates, `font <id>` tries a choice out
 * for this session, and `--save` writes it. The split between trying and keeping
 * is deliberate: a font that turns the block art into per-glyph substitutions is
 * something you want to be able to look at and then walk away from.
 */
const font: TerminalCommand = {
  name: 'font',
  summary: 'show or choose the terminal font',
  run(context, args) {
    let wantsList = false;
    let wantsSave = false;
    const words: string[] = [];

    for (const arg of args) {
      if (arg === '--list' || arg === '-l') wantsList = true;
      else if (arg === '--save' || arg === '-s') wantsSave = true;
      else if (arg.startsWith('-')) {
        context.printOutput([`font: ${arg}: unknown option`, FONT_HINT]);
        return EXIT_USAGE;
      } else words.push(arg);
    }

    if (wantsList) {
      // Listing wins over anything else on the line: it is a read, and reading is
      // never the thing that changes state.
      context.printOutput(fontTable(context));
      return;
    }

    const id = words[0];
    if (id === undefined) {
      /*
        `font` alone reports; `font --save` alone commits whatever is on screen,
        because trying a face out and then deciding to keep it is a natural two-step
        and making the visitor retype the name for the second half would be a trap.
      */
      if (!wantsSave) {
        context.printOutput([fontLine(context.currentFont()), `  ${fontState(context)}`]);
        return;
      }
    } else if (!context.selectFont(id)) {
      context.printOutput([`font: ${id}: unknown font`, FONT_HINT]);
      return EXIT_USAGE;
    }

    if (!wantsSave) {
      context.printOutput(selectionReply(context, false));
      return;
    }

    /*
      Returned rather than awaited here: the caller records the exit status after
      this settles, so the `✗` glyph on the next prompt reflects whether the write
      actually landed rather than whether the command was able to ask for it.
    */
    return context.saveFont().then((stored) => {
      if (stored) {
        context.printOutput(selectionReply(context, true));
        return;
      }

      context.printOutput([
        fontLine(context.currentFont()),
        '  selected, could not save',
        '  the browser refused the write',
      ]);
      return EXIT_NOT_SAVED;
    });
  },
};

export const TERMINAL_COMMANDS: readonly TerminalCommand[] = [clear, history, help, neofetch, font];

/**
 * The reply for input that names no command, worded the way bash words it:
 * `bash: foo: command not found`.
 *
 * Only the command name is reported, not the whole line, because that is what
 * bash prints: the arguments belong to a command that never got as far as
 * parsing them.
 */
export function commandNotFound(shell: string, name: string): string {
  return `${shell}: ${name}: command not found`;
}

export interface Invocation {
  readonly command: TerminalCommand;
  readonly args: readonly string[];
}

/**
 * Resolved rather than optional, so the caller has to handle the not-found case
 * instead of glossing over an `undefined`. The failure arm keeps the name, since
 * that is exactly what the reply needs to report.
 */
export type CommandResolution =
  | ({ readonly found: true } & Invocation)
  | { readonly found: false; readonly name: string; readonly args: readonly string[] };

/**
 * Match by exact first token, so `clearx` is not a command while `clear -x` is.
 *
 * Arguments are handed to the command untouched: `clear` ignores the tput
 * options it cannot honour, while `history` reads its count from them.
 */
export function resolveCommand(line: string): CommandResolution {
  const [name = '', ...args] = line.trim().split(/\s+/);
  const command = TERMINAL_COMMANDS.find((candidate) => candidate.name === name);
  return command ? { found: true, command, args } : { found: false, name, args };
}
