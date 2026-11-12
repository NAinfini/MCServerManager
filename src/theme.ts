import { createTheme, type MantineColorsTuple } from "@mantine/core";

/* Ink-blue neutrals with one azure accent. Status colours (running, crashed,
   starting) stay green, red and amber because they mean something; nothing
   else on screen is green any more. tokens.css mirrors these values for the
   parts of the app still styled with plain CSS. */

const dark: MantineColorsTuple = [
  "#e8ebf2",
  "#c5cbd8",
  "#9aa2b4",
  "#727b8f",
  "#4b5366",
  "#343b4b",
  "#262c39",
  "#1c212c",
  "#151922",
  "#0f121a",
];

const azure: MantineColorsTuple = [
  "#eaf2ff",
  "#d3e3ff",
  "#a6c5ff",
  "#76a6ff",
  "#5b95ff",
  "#3f81ff",
  "#2a71ff",
  "#1f63e6",
  "#1655cc",
  "#0d47b2",
];

export const theme = createTheme({
  primaryColor: "azure",
  primaryShade: { light: 7, dark: 7 },
  colors: { dark, azure },
  fontFamily:
    '"Segoe UI Variable Text", "Segoe UI Variable", "Segoe UI", system-ui, "Microsoft YaHei UI", "Microsoft YaHei", "PingFang SC", sans-serif',
  fontFamilyMonospace:
    '"Cascadia Code", "Cascadia Mono", "JetBrains Mono", ui-monospace, "Microsoft YaHei UI", monospace',
  headings: {
    fontWeight: "650",
    sizes: {
      h1: { fontSize: "22px", lineHeight: "1.3" },
      h2: { fontSize: "18px", lineHeight: "1.35" },
      h3: { fontSize: "15px", lineHeight: "1.4" },
      h4: { fontSize: "14px", lineHeight: "1.4" },
    },
  },
  /* A desktop tool, read at arm's length: denser than Mantine's web defaults. */
  fontSizes: { xs: "11px", sm: "12px", md: "13px", lg: "15px", xl: "18px" },
  spacing: { xs: "6px", sm: "10px", md: "14px", lg: "20px", xl: "28px" },
  radius: { xs: "4px", sm: "6px", md: "8px", lg: "12px", xl: "16px" },
  defaultRadius: "md",
  cursorType: "pointer",
  focusRing: "auto",
  components: {
    /* Icons are passed as children, so the label spaces them from the text. */
    Button: { defaultProps: { size: "sm" }, styles: { label: { gap: 6 } } },
    ActionIcon: { defaultProps: { variant: "subtle", color: "gray" } },
    TextInput: { defaultProps: { size: "sm" } },
    NumberInput: { defaultProps: { size: "sm" } },
    PasswordInput: { defaultProps: { size: "sm" } },
    Select: { defaultProps: { size: "sm", allowDeselect: false } },
    Textarea: { defaultProps: { size: "sm" } },
    Switch: { defaultProps: { size: "sm" } },
    Checkbox: { defaultProps: { size: "sm" } },
    SegmentedControl: { defaultProps: { size: "sm" } },
    Tabs: { defaultProps: { color: "azure" } },
    Paper: { defaultProps: { radius: "md" } },
    Card: { defaultProps: { radius: "md", padding: "md" } },
    Modal: {
      defaultProps: {
        radius: "lg",
        centered: true,
        overlayProps: { backgroundOpacity: 0.55, blur: 2 },
      },
    },
    Tooltip: { defaultProps: { withArrow: true, openDelay: 300 } },
    Badge: { defaultProps: { radius: "sm", variant: "light" } },
  },
});
