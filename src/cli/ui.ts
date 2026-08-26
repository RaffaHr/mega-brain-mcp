import { marked } from 'marked';
import TerminalRenderer from 'marked-terminal';
import pc from 'picocolors';

let markdownRendererConfigured = false;

function terminalMarkdownEnabled(output: NodeJS.WriteStream | { isTTY?: boolean }): boolean {
  return Boolean(output.isTTY);
}

export function renderTerminalMarkdown(message: string, output: NodeJS.WriteStream | { isTTY?: boolean }): string {
  if (!terminalMarkdownEnabled(output)) return message;
  try {
    if (!markdownRendererConfigured) {
      marked.use({ renderer: new TerminalRenderer() });
      markdownRendererConfigured = true;
    }
    return String(marked.parse(message, { async: false })).trimEnd();
  } catch {
    return message;
  }
}

export function cliLabel(message: string): string {
  return pc.cyan(pc.bold(message));
}

export function cliMuted(message: string): string {
  return pc.dim(message);
}
