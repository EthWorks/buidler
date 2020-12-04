import util from "util";

export class ModulesLogger {
  private _enabled = false;
  private _logs: Array<string | [string, string]> = [];
  private _titleLength = 0;
  private _indentEnabled = false;
  private _indent = 4;

  public get enabled() {
    return this._enabled;
  }

  public setEnabled(enabled: boolean) {
    this._enabled = enabled;
  }

  public log(message: string) {
    if (!this.enabled) {
      return;
    }

    if (this._indentEnabled) {
      message = " ".repeat(this._indent) + message;
    }

    this._logs.push(message);
  }

  public setIndent(flag: boolean) {
    this._indentEnabled = flag;
  }

  public logWithTitle(title: string, message: string) {
    if (!this.enabled) {
      return;
    }

    if (this._indentEnabled) {
      title = " ".repeat(this._indent) + title;
    }

    // We always use the max title length we've seen. Otherwise the value move
    // a lot with each tx/call.
    if (title.length > this._titleLength) {
      this._titleLength = title.length;
    }

    this._logs.push([title, message]);
  }

  public debug(...args: any[]) {
    this.log(util.format(args[0], ...args.splice(1)));
  }

  public clearLogs() {
    this._logs = [];
  }

  public hasLogs(): boolean {
    return this._logs.length > 0;
  }

  public getLogs(): string[] {
    return this._logs.map((l) => {
      if (typeof l === "string") {
        return l;
      }

      const title = `${l[0]}:`;

      return `${title.padEnd(this._titleLength + 1)} ${l[1]}`;
    });
  }
}
