import { loadCollection, saveCollection, PROFILE_KEY } from "./storage";

export type BurrType = "flat" | "conical" | "unknown";
export type AdjustmentType = "stepped" | "stepless" | "unknown";
export type BoilerType = "single" | "heat_exchanger" | "dual" | "thermocoil" | "unknown";

export interface GrinderProfile {
  name: string;
  burr_type: BurrType;
  adjustment: AdjustmentType;
}

export interface MachineProfile {
  name: string;
  boiler: BoilerType;
  pid: boolean;
  pressure_profile: boolean;
}

export interface EquipmentProfile {
  grinder: GrinderProfile;
  machine: MachineProfile;
}

export const EMPTY_GRINDER: GrinderProfile = {
  name: "",
  burr_type: "unknown",
  adjustment: "unknown",
};

export const EMPTY_MACHINE: MachineProfile = {
  name: "",
  boiler: "unknown",
  pid: false,
  pressure_profile: false,
};

/** Transient UI state for one section's photo + typed model name. */
export interface EquipmentInput {
  previewUrl: string | null;
  base64: string | null;
  modelName: string;
}

export const EMPTY_INPUT: EquipmentInput = {
  previewUrl: null,
  base64: null,
  modelName: "",
};

export function hasInput(input: EquipmentInput): boolean {
  return Boolean(input.base64 || input.modelName.trim());
}

export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = () => reject(new Error("Read failed"));
    reader.readAsDataURL(file);
  });
}

// Option lists shared by the badge editors so labels stay consistent everywhere.
export const BURR_OPTIONS: { value: BurrType; label: string }[] = [
  { value: "flat", label: "Flat" },
  { value: "conical", label: "Conical" },
  { value: "unknown", label: "Unknown" },
];

export const ADJUSTMENT_OPTIONS: { value: AdjustmentType; label: string }[] = [
  { value: "stepped", label: "Stepped" },
  { value: "stepless", label: "Stepless" },
  { value: "unknown", label: "Unknown" },
];

export const BOILER_OPTIONS: { value: BoilerType; label: string }[] = [
  { value: "single", label: "Single" },
  { value: "heat_exchanger", label: "Heat exchanger" },
  { value: "dual", label: "Dual" },
  { value: "thermocoil", label: "Thermocoil" },
  { value: "unknown", label: "Unknown" },
];

export function labelFor<T extends string>(
  options: { value: T; label: string }[],
  value: T
): string {
  return options.find((o) => o.value === value)?.label ?? "Unknown";
}

/**
 * STUB — not wired to Claude yet.
 *
 * Real implementation will POST the photo (imageBase64) and/or the typed
 * modelName to the Anthropic vision API and parse a JSON response into the
 * matching profile shape. For now it just resolves hardcoded mock data after
 * 1.5s so the UI flow is reviewable.
 */
export function classifyEquipment(
  type: "grinder",
  imageBase64?: string,
  modelName?: string
): Promise<GrinderProfile>;
export function classifyEquipment(
  type: "machine",
  imageBase64?: string,
  modelName?: string
): Promise<MachineProfile>;
export function classifyEquipment(
  type: "grinder" | "machine",
  imageBase64?: string,
  modelName?: string
): Promise<GrinderProfile | MachineProfile> {
  return new Promise((resolve) => {
    setTimeout(() => {
      if (type === "grinder") {
        resolve({
          name: modelName?.trim() || "Niche Zero",
          burr_type: "conical",
          adjustment: "stepless",
        });
      } else {
        resolve({
          name: modelName?.trim() || "Breville Bambino Plus",
          boiler: "thermocoil",
          pid: true,
          pressure_profile: false,
        });
      }
    }, 1500);
  });
}

// Persisted as a single-element array so it reuses the existing per-user
// `collections` table (one JSON row per user per collection_name).
export async function saveEquipmentProfile(profile: EquipmentProfile): Promise<void> {
  await saveCollection(PROFILE_KEY, [profile]);
}

export async function loadEquipmentProfile(): Promise<EquipmentProfile | null> {
  const rows = await loadCollection<EquipmentProfile>(PROFILE_KEY);
  return rows[0] ?? null;
}
