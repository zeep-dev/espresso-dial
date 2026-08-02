import { useState } from "react";
import { EquipmentPhotoUpload } from "./EquipmentPhotoUpload";
import { ClassificationBadge } from "./ClassificationBadge";
import {
  BOILER_OPTIONS,
  fileToBase64,
  type BoilerType,
  type EquipmentInput,
  type MachineProfile,
} from "../lib/equipment";

const YES_NO = [
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
];

interface MachineSectionProps {
  input: EquipmentInput;
  onInputChange: (patch: Partial<EquipmentInput>) => void;
  profile: MachineProfile | null;
  onProfileChange: (profile: MachineProfile) => void;
  loading: boolean;
  variant?: "modal" | "page";
  onReidentify?: () => void;
}

export function MachineSection({
  input,
  onInputChange,
  profile,
  onProfileChange,
  loading,
  variant = "modal",
  onReidentify,
}: MachineSectionProps) {
  const [editing, setEditing] = useState(false);
  const showInputs = variant === "modal" || editing;

  const handleSelect = async (file: File) => {
    onInputChange({
      previewUrl: URL.createObjectURL(file),
      base64: await fileToBase64(file),
    });
  };

  return (
    <section className="card equip-card">
      <div className="equip-card-head">
        <div>
          <div className="section-label">Espresso machine</div>
          <h2 className="equip-name">{profile?.name || "Not set yet"}</h2>
        </div>
        {variant === "page" && (
          <div className="equip-actions">
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setEditing((v) => !v)}
            >
              {editing ? "Close" : "Edit"}
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={onReidentify}
              disabled={loading}
            >
              Re-identify
            </button>
          </div>
        )}
      </div>

      {showInputs && (
        <>
          <EquipmentPhotoUpload
            label="Photo of your espresso machine"
            previewUrl={input.previewUrl}
            disabled={loading}
            onSelect={handleSelect}
            onClear={() => onInputChange({ previewUrl: null, base64: null })}
          />
          <div className="field">
            <label htmlFor="machine-model">Or enter model name</label>
            <input
              id="machine-model"
              type="text"
              placeholder="e.g. Sage Barista Pro, Rocket Appartamento"
              value={input.modelName}
              disabled={loading}
              onChange={(e) => onInputChange({ modelName: e.target.value })}
            />
          </div>
        </>
      )}

      <div className="equip-status">
        {loading ? (
          <div className="status">
            <div className="spinner" />
            Identifying your machine…
          </div>
        ) : profile ? (
          <div className="badge-row">
            <ClassificationBadge
              label="Model"
              value={profile.name}
              onChange={(v) => onProfileChange({ ...profile, name: v })}
            />
            <ClassificationBadge
              label="Boiler"
              value={profile.boiler}
              options={BOILER_OPTIONS}
              onChange={(v) => onProfileChange({ ...profile, boiler: v as BoilerType })}
            />
            <ClassificationBadge
              label="PID"
              value={profile.pid ? "yes" : "no"}
              options={YES_NO}
              toggle
              onChange={(v) => onProfileChange({ ...profile, pid: v === "yes" })}
            />
            <ClassificationBadge
              label="Pressure profiling"
              value={profile.pressure_profile ? "yes" : "no"}
              options={YES_NO}
              toggle
              onChange={(v) => onProfileChange({ ...profile, pressure_profile: v === "yes" })}
            />
          </div>
        ) : (
          <p className="equip-hint">
            Add a photo or model name, then run identification.
          </p>
        )}
      </div>
    </section>
  );
}
