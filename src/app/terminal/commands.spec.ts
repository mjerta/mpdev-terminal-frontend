import { commandNotFound, EXIT_NOT_FOUND, resolveCommand, TERMINAL_COMMANDS } from './commands';

describe('resolveCommand', () => {
  it('finds every registered command by exact first token', () => {
    for (const name of ['clear', 'help', 'history']) {
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

describe('help', () => {
  it('lists every registered command, including itself', () => {
    const printed: string[][] = [];
    const context = {
      clearScreen: () => {},
      commandList: () => [],
      printOutput: (lines: readonly string[]) => printed.push([...lines]),
    };

    const help = TERMINAL_COMMANDS.find((command) => command.name === 'help');
    expect(help).toBeTruthy();
    help?.run(context, []);

    const listed = printed[0].map((line) => line.trim().split(/\s+/)[0]);
    for (const command of TERMINAL_COMMANDS) {
      expect(listed).toContain(command.name);
    }
  });

  it('sorts by name so appending to the registry cannot shuffle the output', () => {
    const printed: string[][] = [];
    const context = {
      clearScreen: () => {},
      commandList: () => [],
      printOutput: (lines: readonly string[]) => printed.push([...lines]),
    };
    TERMINAL_COMMANDS.find((command) => command.name === 'help')?.run(context, []);

    const names = printed[0].map((line) => line.trim().split(/\s+/)[0]);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });
});
