import { cleanup, render, screen } from "../../test/render";
import { afterEach, describe, expect, it } from "vitest";
import { BottomStatusBar } from "./BottomStatusBar";

const selectedServer = {
  javaPath: "C:/runtimes/temurin-21/bin/java.exe",
  maxMemoryMb: 4096,
  minMemoryMb: 1024,
  serverPort: 25565,
};

describe("BottomStatusBar", () => {
  afterEach(() => {
    cleanup();
  });

  it("shows unset placeholders when no server is selected", () => {
    render(<BottomStatusBar />);

    expect(screen.getByText("Java: unset")).toBeInTheDocument();
    expect(screen.getAllByText("unset").length).toBeGreaterThan(0);
    expect(screen.getByText("v0.1.0")).toBeInTheDocument();
  });

  it("shows Java version, memory, and port for the selected server", () => {
    render(<BottomStatusBar selectedServer={selectedServer} />);

    expect(screen.getByText("Java 21")).toBeInTheDocument();
    expect(screen.getByText("4096 MB")).toBeInTheDocument();
    expect(screen.getByText("Port 25565")).toBeInTheDocument();
  });

  it("hides runtime badges while nothing is running or crashed", () => {
    render(<BottomStatusBar crashedCount={0} runningCount={0} />);

    expect(screen.queryByText(/running/)).not.toBeInTheDocument();
    expect(screen.queryByText(/crashed/)).not.toBeInTheDocument();
  });

  it("shows the running badge when servers are running", () => {
    render(<BottomStatusBar runningCount={2} />);

    expect(screen.getByText("2 running")).toBeInTheDocument();
    expect(screen.queryByText(/crashed/)).not.toBeInTheDocument();
  });

  it("shows the crashed badge when servers have crashed", () => {
    render(<BottomStatusBar crashedCount={1} runningCount={0} />);

    expect(screen.getByText("1 crashed")).toBeInTheDocument();
    expect(screen.queryByText(/running/)).not.toBeInTheDocument();
  });
});
