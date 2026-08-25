export const WEBVST_ABI = "prometheos-vst3-wasm-1" as const;

export type BuzzParameterType = "note" | "switch" | "byte" | "word";

export interface BuzzParameterDisplay {
  unit?: "%" | "Hz" | "ms" | "dB" | "ticks";
  min?: number;
  max?: number;
  precision?: number;
  curve?: "linear" | "exp";
  choices?: string[];
}

export interface BuzzParameter {
  type: BuzzParameterType;
  name: string;
  description: string;
  minValue: number;
  maxValue: number;
  noValue: number;
  defValue: number;
  flags: number;
  display?: BuzzParameterDisplay;
}

export interface WebVstManifestClass {
  classUid: string;
  name: string;
  vendor: string;
  kind: "instrument" | "effect";
  exposedParameters: Array<{
    parameterId: number;
    buzz: BuzzParameter;
  }>;
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
  /** Presentation-only tweaks applied after the ABI has supplied the base descriptor. */
  buzz?: {
    name?: string;
    description?: string;
    display?: Omit<BuzzParameterDisplay, "choices">;
  };
}

export interface ManifestAuthorConfig {
  wasm: Uint8Array;
  packageId: string;
  version: string;
  modulePath: string;
  curation?: AuthorParameterCuration[];
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
