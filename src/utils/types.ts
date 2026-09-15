import { Project } from "./project.js";
export type PackageManager = "pnpm" | "npm";
export type ProjectType = "app" | "library" | "extension" | "custom-element";

export interface Layer {
  /**
   * The text to show during selection
   */
  label: string;
  hint?: string;
  /**
   * Whether the layer is pre-selected in the CLI.
   * The user can still deselect it.
   */
  defaultValue?: (projectType: ProjectType) => unknown;
  /**
   * Optional README documentation snippet or function.
   *
   * Whatever is returned shows up in the generated project's README file.
   */
  readme?: string | ((project: Project) => string | undefined | Promise<string | undefined>);
  /**
   * The function that applies the codemod
   *
   * run _may_ be invoked multiple times,
   * so it's important to not require interaction here
   */
  run: (project: Project) => Promise<void>;
  isSetup: <Explain extends boolean = false>(
    project: Project,
    explain?: Explain,
  ) => Promise<
    Explain extends true
      ? {
          isSetup: boolean;
          reasons: string[];
        }
      : boolean
  >;
}

export interface DiscoveredLayer extends Layer {
  /**
   * The unique name of the layer.
   *
   * An exact match of the folder name.
   * Not provided by the layer itself.
   */
  name: string;
}

export interface Answers {
  type: ProjectType;
  path: string;
  name: string;
  layers: DiscoveredLayer[];
  packageManager: PackageManager;
}
