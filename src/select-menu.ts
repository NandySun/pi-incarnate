import type { ExtensionCommandContext, Theme } from "@earendil-works/pi-coding-agent";
import { Container, SelectList, Text, truncateToWidth, type TUI } from "@earendil-works/pi-tui";

function supportsThemedMenu(ctx: ExtensionCommandContext): boolean {
  return typeof ctx.ui.custom === "function" && ctx.ui.theme !== undefined;
}

function menuComponent(
  tui: TUI,
  theme: Theme,
  title: string,
  options: readonly string[],
  done: (result: string | undefined) => void,
) {
  const container = new Container();
  container.addChild(new Text(theme.fg("accent", theme.bold(title)), 1, 0));

  const list = new SelectList(
    options.map((option) => ({ value: option, label: option })),
    Math.min(options.length, 12),
    {
      selectedPrefix: (text) => theme.fg("accent", text),
      selectedText: (text) => theme.fg("accent", text),
      description: (text) => theme.fg("muted", text),
      scrollInfo: (text) => theme.fg("muted", text),
      noMatch: (text) => theme.fg("warning", text),
    },
    {
      truncatePrimary: ({ text, maxWidth, isSelected }) => {
        const clipped = truncateToWidth(text, maxWidth, "");
        // Keep the terminal's own foreground color so this remains readable even
        // when Pi's configured theme does not match the terminal background.
        return isSelected ? clipped : theme.bold(clipped);
      },
    },
  );
  list.onSelect = (item) => done(item.value);
  list.onCancel = () => done(undefined);
  container.addChild(list);
  container.addChild(new Text(theme.fg("muted", "↑↓ navigate · Enter select · Esc cancel"), 1, 0));

  return {
    render: (width: number) => container.render(width),
    invalidate: () => container.invalidate(),
    handleInput(data: string) {
      list.handleInput(data);
      tui.requestRender();
    },
  };
}

export async function selectMenu(
  ctx: ExtensionCommandContext,
  title: string,
  options: readonly string[],
): Promise<string | undefined> {
  if (options.length === 0) return undefined;
  if (!supportsThemedMenu(ctx)) return ctx.ui.select(title, [...options]);
  return ctx.ui.custom<string | undefined>((tui, theme, _keybindings, done) =>
    menuComponent(tui, theme, title, options, done));
}

export async function confirmMenu(
  ctx: ExtensionCommandContext,
  title: string,
  message: string,
): Promise<boolean> {
  if (!supportsThemedMenu(ctx)) return ctx.ui.confirm(title, message);
  return await selectMenu(ctx, `${title}\n${message}`, ["Yes", "No"]) === "Yes";
}
