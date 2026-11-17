import { Component, type ReactNode } from "react";
import { Button } from "../../components/ui/button.tsx";
import { TopBar } from "../../components/app/top-bar.tsx";

export class ScreenBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (this.state.failed) return <><TopBar><span className="text-sm font-medium">Moco</span></TopBar><div role="alert" className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
      <p>Something went wrong on this screen.</p>
      <Button variant="outline" onClick={() => location.reload()}>Reload</Button>
    </div></>;
    return this.props.children;
  }
}
