import type { ReactElement } from "react";
import {
  render as testingLibraryRender,
  type RenderOptions,
} from "@testing-library/react";
import { AppSettingsProvider } from "../i18n";

export * from "@testing-library/react";

export function render(ui: ReactElement, options?: RenderOptions) {
  const result = testingLibraryRender(
    <AppSettingsProvider>{ui}</AppSettingsProvider>,
    options,
  );
  const baseRerender = result.rerender;
  return {
    ...result,
    rerender: (nextUi: ReactElement) =>
      baseRerender(<AppSettingsProvider>{nextUi}</AppSettingsProvider>),
  };
}
