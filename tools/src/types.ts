export const WEBVST_ABI = "webvst-vst3-wasm-1" as const;

/** Namespace of the optional Buzz host projection carried under `extensions`. */
export const BUZZ_EXTENSION = "buzz" as const;

export type BuzzParameterType = "note" | "switch" | "byte" | "word";

export interface ParameterDisplay {
  unit?: "%" | "Hz" | "ms" | "dB" | "ticks";
  min?: number;
  max?: number;
  precision?: number;
  curve?: "linear" | "exp";
  choices?: string[];
}

/**
 * Host-specific projection of an ABI parameter onto Buzz's integer value model.
 * It is optional: the generic descriptor above it is complete on its own, and a
 * host that does not use these conventions ignores the whole namespace.
 */
export interface BuzzParameterExtension {
  type: BuzzParameterType;
  minValue: number;
  maxValue: number;
  noValue: number;
  defValue: number;
  flags: number;
}

export interface ParameterExtensions {
  buzz?: BuzzParameterExtension;
  [namespace: string]: unknown;
}

/** Generic, ABI-derived parameter descriptor. No host conventions here. */
export interface WebVstParameter {
  parameterId: number;
  name: string;
  description: string;
  /** ABI flag bits: automatable (1), read-only (2). */
  flags: number;
  /** 0 for a continuous parameter, otherwise the number of discrete steps. */
  stepCount: number;
  /** Normalized default in [0, 1]. */
  defaultValue: number;
  display?: ParameterDisplay;
  extensions?: ParameterExtensions;
}

export interface WebVstManifestClass {
  classUid: string;
  name: string;
  vendor: string;
  kind: "instrument" | "effect";
  exposedParameters: WebVstParameter[];
  programs?: {
    categories: Array<{
      name: string;
      entries: Array<{
        name: string;
        artifactId: string;
        offset: number;
        size: number;
      }>;
    }>;
  };
}

export interface WebVstManifestV1 {
  schemaVersion: 1;
  packageId: string;
  version: string;
  abi: typeof WEBVST_ABI;
  module: {
    path: string;
    sha256: string;
  };
  classes: WebVstManifestClass[];
  artifacts?: Array<{
    id: string;
    path: string;
    sha256: string;
    role: "preset" | "resource";
  }>;
}

export interface AuthorParameterCuration {
  classUid: string;
  parameterId: number;
  expose?: boolean;
  /** Presentation-only tweaks applied after the ABI has supplied the descriptor. */
  name?: string;
  description?: string;
  display?: Omit<ParameterDisplay, "choices">;
}

export interface ManifestAuthorConfig {
  wasm: Uint8Array;
  packageId: string;
  version: string;
  modulePath: string;
  curation?: AuthorParameterCuration[];
  /**
   * Host extension namespaces to emit. Defaults to the Buzz projection so that
   * existing hosts keep working; pass an empty array for a host-neutral package.
   */
  extensions?: readonly string[];
}

export interface ProbedParameter {
  parameterId: number;
  flags: number;
  stepCount: number;
  defaultValue: number;
  title: string;
  displayValues: string[];
}

export interface ProbedClass {
  classUid: string;
  name: string;
  vendor: string;
  kind: "instrument" | "effect";
  parameters: ProbedParameter[];
}
