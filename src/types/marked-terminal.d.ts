declare module 'marked-terminal' {
  import { Renderer } from 'marked';

  export interface MarkedTerminalOptions {
    [key: string]: unknown;
  }

  export default class TerminalRenderer extends Renderer {
    constructor(options?: MarkedTerminalOptions);
  }
}
