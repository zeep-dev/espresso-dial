import { useEffect, useState } from "react";
import { GrinderSection } from "./GrinderSection";
import { MachineSection } from "./MachineSection";
import {
  EMPTY_GRINDER,
  EMPTY_INPUT,
  EMPTY_MACHINE,
  classifyEquipment,
  type EquipmentInput,
  type EquipmentProfile,
  type GrinderProfile,
  type MachineProfile,
} from "../lib/equipment";

interface ProfilePageProps {
  profile: EquipmentProfile | null;
  onSave: (profile: EquipmentProfile) => Promise<void> | void;
}

export function ProfilePage({ profile, onSave }: ProfilePageProps) {
  const [grinder, setGrinder] = useState<GrinderProfile>(profile?.grinder ?? EMPTY_GRINDER);
  const [machine, setMachine] = useState<MachineProfile>(profile?.machine ?? EMPTY_MACHINE);
  const [grinderInput, setGrinderInput] = useState<EquipmentInput>(EMPTY_INPUT);
  const [machineInput, setMachineInput] = useState<EquipmentInput>(EMPTY_INPUT);
  const [loadingGrinder, setLoadingGrinder] = useState(false);
  const [loadingMachine, setLoadingMachine] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Re-sync when the persisted profile arrives or changes underneath us.
  useEffect(() => {
    if (!profile) return;
    setGrinder(profile.grinder);
    setMachine(profile.machine);
  }, [profile]);

  const reidentifyGrinder = async () => {
    setLoadingGrinder(true);
    setSaved(false);
    try {
      setGrinder(
        await classifyEquipment(
          "grinder",
          grinderInput.base64 ?? undefined,
          grinderInput.modelName || grinder.name
        )
      );
    } finally {
      setLoadingGrinder(false);
    }
  };

  const reidentifyMachine = async () => {
    setLoadingMachine(true);
    setSaved(false);
    try {
      setMachine(
        await classifyEquipment(
          "machine",
          machineInput.base64 ?? undefined,
          machineInput.modelName || machine.name
        )
      );
    } finally {
      setLoadingMachine(false);
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      await onSave({ grinder, machine });
      setSaved(true);
    } finally {
      setSaving(false);
    }
  };

  const busy = saving || loadingGrinder || loadingMachine;

  return (
    <div>
      <div className="equip-grid">
        <GrinderSection
          variant="page"
          input={grinderInput}
          onInputChange={(patch) => {
            setGrinderInput((p) => ({ ...p, ...patch }));
            setSaved(false);
          }}
          profile={grinder.name || grinder.burr_type !== "unknown" ? grinder : null}
          onProfileChange={(p) => {
            setGrinder(p);
            setSaved(false);
          }}
          loading={loadingGrinder}
          onReidentify={reidentifyGrinder}
        />
        <MachineSection
          variant="page"
          input={machineInput}
          onInputChange={(patch) => {
            setMachineInput((p) => ({ ...p, ...patch }));
            setSaved(false);
          }}
          profile={machine.name || machine.boiler !== "unknown" ? machine : null}
          onProfileChange={(p) => {
            setMachine(p);
            setSaved(false);
          }}
          loading={loadingMachine}
          onReidentify={reidentifyMachine}
        />
      </div>

      <button
        type="button"
        className="btn btn-primary btn-full"
        onClick={save}
        disabled={busy}
      >
        {saving ? "Saving…" : saved ? "Saved" : "Save changes"}
      </button>
    </div>
  );
}
