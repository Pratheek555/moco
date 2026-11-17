import { Notification } from "electron";
import type { BrowserWindow } from "electron";
import type { AppCommand, RunState, Update } from "../shared/api.ts";

interface Options {
  window(): BrowserWindow | null;
  enabled(): boolean;
  projectName(id: string): Promise<string>;
  command(command: AppCommand): void;
}
export class RunNotifications {
  private options: Options;
  private states = new Map<string, RunState>();
  private transitions = new Map<string, object>();
  private notifications = new Map<Notification, string>();
  constructor(options: Options) { this.options = options; }
  get activeCount(): number { return [...this.states.values()].filter(state => state === "running" || state === "waiting").length; }
  clear(): void {
    this.states.clear();
    this.transitions.clear();
    for (const notification of this.notifications.keys()) notification.close();
    this.notifications.clear();
  }
  forget(projectId: string): void {
    this.states.delete(projectId);
    this.transitions.delete(projectId);
    for (const [notification, id] of this.notifications) if (id === projectId) { notification.close(); this.notifications.delete(notification); }
  }
  update(update: Update): void {
    if (!("projectId" in update) || !update.state) return;
    const { projectId, state } = update;
    const previous = this.states.get(projectId) ?? "idle";
    if (state === "idle") this.states.delete(projectId); else this.states.set(projectId, state);
    if (previous === state) return;
    const transition = {};
    this.transitions.set(projectId, transition);
    const suffix = state === "waiting" && previous === "running" ? "needs your answer"
      : state === "idle" && previous === "running" ? "is ready"
      : state === "error" ? "stopped with an error" : undefined;
    if (suffix && this.background() && this.options.enabled()) void this.notify(projectId, state, suffix, transition).catch(() => {});
  }
  private background(): boolean {
    const win = this.options.window();
    return !win || !win.isFocused() || win.isMinimized();
  }
  private async notify(projectId: string, state: RunState, suffix: string, transition: object): Promise<void> {
    const name = await this.options.projectName(projectId);
    if (!this.background() || !this.options.enabled() || this.transitions.get(projectId) !== transition || !Notification.isSupported()) return;
    const notification = new Notification({ title: `${name} ${suffix}` });
    this.notifications.set(notification, projectId);
    notification.once("click", () => this.options.command({ type: "open-project", projectId }));
    const clear = () => this.notifications.delete(notification);
    notification.once("close", clear); notification.once("failed", clear);
    notification.show();
    if (process.platform === "win32" && state === "waiting") this.options.window()?.flashFrame(true);
  }
}
