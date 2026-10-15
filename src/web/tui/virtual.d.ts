/** Modules the static build makes (src/web/static/plugins.ts). */
declare module "virtual:opentui-fonts" {
  /** OpenTUI's ASCII fonts by name, read out of the installed @opentui/core. */
  const fonts: Record<string, unknown>;
  export default fonts;
}
