// Copied from the prototype's src/web/tui/virtual.d.ts at 44c6d4a, whole, unchanged.
/** Modules the static build makes (src/web/static/plugins.ts). */
declare module "virtual:opentui-fonts" {
  /** OpenTUI's ASCII fonts by name, read out of the installed @opentui/core. */
  const fonts: Record<string, unknown>;
  export default fonts;
}
