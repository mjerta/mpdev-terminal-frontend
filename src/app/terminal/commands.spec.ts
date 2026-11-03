import {
  commandNotFound,
  EXIT_NOT_FOUND,
  EXIT_USAGE,
  resolveCommand,
  TERMINAL_COMMANDS,
  TerminalCommandContext,
} from './commands';
import { FICTIONAL_TERMINAL, FontChoice } from './terminal.config';

/**
 * A context that records rather than does, configurable where a command's answer
 * depends on state. `history` and `help` do not care about font state, so they all
 * share this one; the font tests hand it a choice and a storage outcome.
 */
function fakeContext(
  options: {
    fonts?: readonly FontChoice[];
    current?: string;
    saved?: string | null;
    saves?: boolean;
  } = {},
) {
  const catalogue = options.fonts ?? FICTIONAL_TERMINAL.fonts;
  const printed: string[][] = [];
  let currentId = options.current ?? catalogue[0].id;
  let savedId = options.saved ?? null;
  let saved = 0;

  const context: TerminalCommandContext = {
    clearScreen: () => {},
    commandList: () => [],
    printOutput: (lines) => printed.push([...lines]),
    showNeofetch: () => {},
    fontCatalogue: () => catalogue,
    currentFont: () => catalogue.find((choice) => choice.id === currentId) ?? catalogue[0],
    savedFontId: () => savedId,
    selectFont: (id) => {
      const choice = catalogue.find((candidate) => candidate.id === id);
      if (!choice) return false;
      currentId = id;
      return true;
    },
    saveFont: async () => {
      saved++;
      if (options.saves ?? true) savedId = currentId;
      return options.saves ?? true;
    },
  };

  return { context, printed, savedCalls: () => saved };
}

/** Look a command up by name; the registry is the only place they are listed. */
const command = (name: string) => TERMINAL_COMMANDS.find((candidate) => candidate.name === name);

describe('resolveCommand', () => {
  it('finds every registered command by exact first token', () => {
    for (const { name } of TERMINAL_COMMANDS) {
      expect(resolveCommand(name).found).toBe(true);
    }
  });

  it('rejects a near-miss rather than prefix-matching', () => {
    const resolution = resolveCommand('clearx');
    expect(resolution.found).toBe(false);
    if (!resolution.found) expect(resolution.name).toBe('clearx');
  });

  it('keeps arguments out of the name and hands them over untouched', () => {
    const resolution = resolveCommand('history 3 --foo');
    expect(resolution.found).toBe(true);
    if (resolution.found) expect(resolution.args).toEqual(['3', '--foo']);
  });

  it('reports only the command word when nothing matched, not the whole line', () => {
    const resolution = resolveCommand('git commit -m "msg"');
    expect(resolution.found).toBe(false);
    if (!resolution.found) expect(resolution.name).toBe('git');
  });

  it('resolves an empty line to an empty name', () => {
    const resolution = resolveCommand('   ');
    expect(resolution.found).toBe(false);
    if (!resolution.found) expect(resolution.name).toBe('');
  });
});

describe('commandNotFound', () => {
  it('words the reply the way bash does', () => {
    expect(commandNotFound('bash', 'ls')).toBe('bash: ls: command not found');
  });

  it('uses the configured shell name', () => {
    expect(commandNotFound('zsh', 'foo')).toBe('zsh: foo: command not found');
  });

  it('carries bash conventional exit code', () => {
    expect(EXIT_NOT_FOUND).toBe(127);
  });
});

describe('neofetch', () => {
  it('asks the terminal for the block rather than printing lines', () => {
    let blocks = 0;
    const { context, printed } = fakeContext();
    context.showNeofetch = () => {
      blocks++;
    };

    command('neofetch')?.run(context, []);

    expect(blocks).toBe(1);
    // Text output would mean the component never gets a chance to lay out the
    // logo and the report, which is the whole reason this command exists.
    expect(printed).toHaveLength(0);
  });
});

describe('help', () => {
  it('lists every registered command, including itself', () => {
    const { context, printed } = fakeContext();
    command('help')?.run(context, []);

    const listed = printed[0].map((line) => line.trim().split(/\s+/)[0]);
    for (const each of TERMINAL_COMMANDS) {
      expect(listed).toContain(each.name);
    }
  });

  it('sorts by name so appending to the registry cannot shuffle the output', () => {
    const { context, printed } = fakeContext();
    command('help')?.run(context, []);

    const names = printed[0].map((line) => line.trim().split(/\s+/)[0]);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });
});

describe('font', () => {
  it('reports the current choice and whether it is saved', () => {
    const { context, printed } = fakeContext({ current: 'nerd', saved: 'nerd' });
    command('font')?.run(context, []);

    // One line: the id, the family as drawn, and the state it is in.
    expect(printed[0]).toEqual(['nerd  JetBrainsMono Nerd Font  (saved)']);
  });

  it('says so plainly when the screen and storage disagree', () => {
    /*
      The state this reports is the reason the command has a --save at all: you can
      be looking at one font while IndexedDB remembers another, and a bare `font`
      that claimed "saved" here would send the visitor away with the wrong plan.
    */
    const { context, printed } = fakeContext({ current: 'mono', saved: 'nerd' });
    command('font')?.run(context, []);
    expect(printed[0][0]).toContain('session only, saved as nerd');
  });

  it('marks an unsaved default rather than calling it a session change', () => {
    const { context, printed } = fakeContext({ current: 'nerd', saved: null });
    command('font')?.run(context, []);
    expect(printed[0][0]).toContain('default, not saved');
  });

  it('lists every choice in config order, marking the current one', () => {
    const { context, printed } = fakeContext({ current: 'system' });
    command('font')?.run(context, ['--list']);

    const rows = printed[0].filter((line) => /^[* ] /.test(line));
    expect(rows).toHaveLength(FICTIONAL_TERMINAL.fonts.length);
    /*
      The marker column is one character plus a space, so it is sliced off rather
      than trimmed: trimming leaves `*` as the first token of the current row and
      the id of every other one, which reads like a misaligned table instead.
    */
    const ids = rows.map((line) => line.slice(2).trim().split(/\s+/)[0]);
    // Config order, not alphabetical: the first entry is the one that renders
    // every glyph, and sorting would bury it under `mono`.
    expect(ids).toEqual(FICTIONAL_TERMINAL.fonts.map((choice) => choice.id));
    expect(rows.filter((line) => line.startsWith('*'))).toHaveLength(1);
    expect(rows.find((line) => line.startsWith('*'))).toContain('system');
  });

  it('lists on the short flag too, and ignores the rest of the line', () => {
    const { context, printed, savedCalls } = fakeContext();
    command('font')?.run(context, ['-l', '--save', 'mono']);

    expect(printed[0].length).toBeGreaterThan(1);
    // Reading is never the thing that changes state.
    expect(savedCalls()).toBe(0);
  });

  it('selects for the session without writing anything when told to', () => {
    const { context, printed, savedCalls } = fakeContext();
    command('font')?.run(context, ['mono']);

    expect(context.currentFont().id).toBe('mono');
    expect(savedCalls()).toBe(0);
    expect(printed.join(' ')).toContain('selected');
    expect(printed.join(' ')).toContain('--save');
  });

  it('refuses a name that is not in the catalogue and changes nothing', () => {
    const { context, printed, savedCalls } = fakeContext();
    const status = command('font')?.run(context, ['comic-sans']);

    expect(status).toBe(EXIT_USAGE);
    expect(context.currentFont().id).toBe('nerd');
    expect(savedCalls()).toBe(0);
    expect(printed[0][0]).toBe('font: comic-sans: unknown font');
  });

  it('rejects an option it does not implement rather than ignoring it', () => {
    /*
      Silently dropping `--size` would let `font --size 20` look like it worked.
      An unimplemented option has to be refused out loud.
    */
    const { context, printed } = fakeContext();
    const status = command('font')?.run(context, ['--size', 'mono']);

    expect(status).toBe(EXIT_USAGE);
    expect(printed[0][0]).toBe('font: --size: unknown option');
    expect(context.currentFont().id).toBe('nerd');
  });

  it('saves the chosen font when asked, and says it did', async () => {
    const { context, printed, savedCalls } = fakeContext({ saves: true });
    const outcome = command('font')?.run(context, ['--save', 'system']);

    // Returned rather than swallowed: the caller waits for it before recording the
    // exit status, so the glyph on the next prompt matches what actually happened.
    expect(outcome).toBeInstanceOf(Promise);
    expect(await outcome).toBeUndefined();
    expect(savedCalls()).toBe(1);
    expect(context.currentFont().id).toBe('system');
    expect(printed.join(' ')).toContain('selected and saved');
  });

  it('commits the choice already on screen when given --save alone', () => {
    const { context, savedCalls } = fakeContext({ current: 'mono', saved: 'nerd' });
    command('font')?.run(context, ['--save']);

    // Trying a font out and then deciding to keep it should not require retyping.
    expect(savedCalls()).toBe(1);
  });

  it('reports a refused write honestly instead of claiming success', async () => {
    const { context, printed } = fakeContext({ saves: false });
    const status = await command('font')?.run(context, ['--save', 'mono']);

    expect(status).not.toBe(0);
    expect(status).toBeDefined();
    expect(context.savedFontId()).toBeNull();
    expect(printed.join(' ')).toContain('could not be saved');
    expect(printed.join(' ')).not.toContain('and saved');
  });

  it('names only the drawn family, never the whole stack', () => {
    const { context, printed } = fakeContext();
    command('font')?.run(context, ['--list']);

    // `'JetBrainsMono Nerd Font', 'JetBrainsMono NF', 'Adwaita Mono', ...` is a CSS
    // declaration, not something to print in a report; three lines on a phone.
    expect(printed[0].join('\n')).not.toMatch(/['"],\s/);
  });
});
