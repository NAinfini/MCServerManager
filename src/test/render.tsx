import type { ReactElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  render as testingLibraryRender,
  type RenderOptions,
} from "@testing-library/react";
import { AppSettingsProvider } from "../i18n";

export * from "@testing-library/react";

type AppRenderOptions = Omit<RenderOptions, "wrapper"> & {
  queryClient?: QueryClient;
};

export function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

export function render(ui: ReactElement, options: AppRenderOptions = {}) {
  const { queryClient = createTestQueryClient(), ...renderOptions } = options;
  const wrap = (content: ReactElement) => (
    <QueryClientProvider client={queryClient}>
      <AppSettingsProvider>{content}</AppSettingsProvider>
    </QueryClientProvider>
  );
  const result = testingLibraryRender(wrap(ui), renderOptions);
  const baseRerender = result.rerender;
  return {
    ...result,
    queryClient,
    rerender: (nextUi: ReactElement) => baseRerender(wrap(nextUi)),
  };
}
