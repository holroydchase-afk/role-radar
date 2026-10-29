// Test-only types for js-yaml 4 (the tests read criteria.yaml and the workflows with it).
// Loaded YAML is dug into freely by the assertions, so load() is typed loosely here.
declare module "js-yaml" {
  export function load(text: string, options?: object): any;
  export function dump(value: unknown, options?: object): string;
  const yaml: { load: typeof load; dump: typeof dump };
  export default yaml;
}
