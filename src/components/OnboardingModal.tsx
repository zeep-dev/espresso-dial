import { useEffect, useState } from "react";
import { GrinderSection } from "./GrinderSection";
import { MachineSection } from "./MachineSection";
import {
  EMPTY_INPUT,
  classifyEquipment,
  hasInput,
  type EquipmentInput,
  type EquipmentProfile,
  type GrinderProfile,
  type MachineProfile,
} from "../lib/equipment";

interface OnboardingModalProps {
  onSave: (profile: EquipmentProfile) => Promise<void> | void;
  onSkip: () => void;
}

export function OnboardingModal({ onSave, onSkip }: OnboardingModalProps) {
  const [grinderInput, setGrinderInput] = useState<EquipmentInput>(EMPTY_INPUT);
  const [machineInput, setMachineInput] = useState<EquipmentInput>(EMPTY_INPUT);
  const [grinder, setGrinder] = useState<GrinderProfile | null>(null);
  const [machine, setMachine] = useState<MachineProfile | null>(null);
  const [loadingGrinder, setLoadingGrinder] = useState(false);
  const [loadingMachine, setLoadingMachine] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onSkip();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onSkip]);

  const busy = loadingGrinder || loadingMachine || saving;
  const readyToIdentify = hasInput(grinderInput) && hasInput(machineInput);
  const classified = Boolean(grinder && machine);

  const identify = async () => {
    setLoadingGrinder(true);
    setLoadingMachine(true);
    // Both sections classify in parallel so each spinner clears independently.
    void classifyEquipment("grinder", grinderInput.base64 ?? undefined, grinderInput.modelName)
      .then(setGrinder)
      .finally(() => setLoadingGrinder(false));
    void classifyEquipment("machine", machineInput.base64 ?? undefined, machineInput.modelName)
      .then(setMachine)
      .finally(() => setLoadingMachine(false));
  };

  const save = async () => {
    if (!grinder || !machine) return;
    setSaving(true);
    try {
      await onSave({ grinder, machine });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" role="presentation">
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="onboarding-title"
      >
        <header className="modal-head">
          <h1 id="onboarding-title">
            Let&apos;s set up your <em>kit</em>
          </h1>
          <p>
            Espresso Dial works best when it knows your setup. This only takes a
            minute.
          </p>
        </header>

        <div className="equip-grid">
          <GrinderSection
            input={grinderInput}
            onInputChange={(patch) => setGrinderInput((p) => ({ ...p, ...patch }))}
            profile={grinder}
            onProfileChange={setGrinder}
            loading={loadingGrinder}
          />
          <MachineSection
            input={machineInput}
            onInputChange={(patch) => setMachineInput((p) => ({ ...p, ...patch }))}
            profile={machine}
            onProfileChange={setMachine}
            loading={loadingMachine}
          />
        </div>

        <div className="modal-foot">
          <button
            type="button"
            className="btn btn-primary btn-full"
            disabled={classified ? busy : !readyToIdentify || busy}
            onClick={classified ? save : identify}
          >
            {saving
              ? "Saving…"
              : classified
                ? "Save my profile"
                : "Identify my kit"}
          </button>
          <button type="button" className="link-btn" onClick={onSkip} disabled={busy}>
            Skip for now
          </button>
        </div>
      </div>
    </div>
  );
}
