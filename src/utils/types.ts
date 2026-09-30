import type { Validate } from "@clack/core";
import { Project } from "./project.js";
export type PackageManager = "pnpm" | "npm";
export type ProjectType = "app" | "library" | "extension" | "custom-element";

export type LayerOptionType = "text" | "number" | "select" | "confirm" | "multiselect";

export interface LayerSelectChoice {
  /**
   * A string, because the same value is also typed as a CLI flag
   */
  value: string;
  label: string;
  hint?: string;
}

export interface LayerOptionSchema {
  type: LayerOptionType;
  /**
   * The question to ask, also shown in `--help`
   */
  prompt: string;
  default?: any;
  /**
   * The choices for "select" and "multiselect"
   */
  options?: LayerSelectChoice[];
  /**
   * The same as clack's `validate`:
   * a function that returns a message (or an Error) to reject the value,
   * or a Standard Schema.
   *
   * Receives the value after conversion to the option's type.
   */
  validate?: Validate<any>;
  /**
   * Reads the value that an existing project uses now.
   *
   * When updating a project, the prompt starts at this value instead of `default`,
   * so that pressing enter keeps the project as it is.
   */
  detect?: (project: Project) => unknown;
}

export interface LayerOptionsSchema {
  [optionKey: string]: LayerOptionSchema;
}

export interface Layer {
  /**
   * The text to show during selection
   */
  label: string;
  hint?: string;
  /**
   * Optional schema of configurable options for this layer
   */
  options?: LayerOptionsSchema;
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
   *
   * `options` are this layer's options, with defaults filled in.
   */
  run: (project: Project, options: Record<string, any>) => Promise<void>;
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
  options?: Record<string, Record<string, any>>;
}
