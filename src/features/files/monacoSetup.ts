import { loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import jsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";

// @monaco-editor/react fetches Monaco from cdn.jsdelivr.net by default, which
// leaves the file editor broken in a packaged or offline app. Bundle Monaco and
// its language workers instead so the editor is entirely self-contained. The
// Electron UI smoke opens an invalid JSON file and asserts the error squiggle,
// which only appears if the bundled worker really started under file://.
//
// This lives in its own module because importing Monaco has side effects that
// jsdom cannot run, so tests replace this one file instead of the editor.
self.MonacoEnvironment = {
  getWorker(_workerId: string, label: string) {
    return label === "json" ? new jsonWorker() : new editorWorker();
  },
};

loader.config({ monaco });
