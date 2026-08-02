import { useState } from "react";
import { EquipmentPhotoUpload } from "./EquipmentPhotoUpload";
import { ClassificationBadge } from "./ClassificationBadge";
import {
  ADJUSTMENT_OPTIONS,
  BURR_OPTIONS,
  fileToBase64,
  type AdjustmentType,
  type BurrType,
  type EquipmentInput,
  type GrinderProfile,
} from "../lib/equipment";

interface GrinderSectionProps {
  input: EquipmentInput;
  onInputChange: (patch: Partial<EquipmentInput>) => void;
  profile: GrinderProfile | null;
  onProfileChange: (profile: GrinderProfile) => void;
  loading: boolean;
  /** "modal" always shows the inputs; "page" hides them behind an Edit button. */
  variant?: "modal" | "page";
  onReidentify?: () => void;
}

export function GrinderSection({
  input,
  onInputChange,
  profile,
  onProfileChange,
  loading,
  variant = "modal",
  onReidentify,
}: GrinderSectionProps) {
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
          <div className="section-label">Grinder</div>
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
            label="Photo of your grinder"
            previewUrl={input.previewUrl}
            disabled={loading}
            onSelect={handleSelect}
            onClear={() => onInputChange({ previewUrl: null, base64: null })}
          />
          <div className="field">
            <label htmlFor="grinder-model">Or enter model name</label>
            <input
              id="grinder-model"
              type="text"
              placeholder="e.g. Niche Zero, DF64 Gen 2"
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
            Identifying your grinder…
          </div>
        ) : profile ? (
          <div className="badge-row">
            <ClassificationBadge
              label="Model"
              value={profile.name}
              onChange={(v) => onProfileChange({ ...profile, name: v })}
            />
            <ClassificationBadge
              label="Burrs"
              value={profile.burr_type}
              options={BURR_OPTIONS}
              onChange={(v) => onProfileChange({ ...profile, burr_type: v as BurrType })}
            />
            <ClassificationBadge
              label="Adjustment"
              value={profile.adjustment}
              options={ADJUSTMENT_OPTIONS}
              onChange={(v) => onProfileChange({ ...profile, adjustment: v as AdjustmentType })}
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
