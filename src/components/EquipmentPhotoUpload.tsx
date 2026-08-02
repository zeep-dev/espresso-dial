import { useState } from "react";

interface EquipmentPhotoUploadProps {
  label: string;
  previewUrl: string | null;
  onSelect: (file: File) => void;
  onClear: () => void;
  disabled?: boolean;
}

export function EquipmentPhotoUpload({
  label,
  previewUrl,
  onSelect,
  onClear,
  disabled = false,
}: EquipmentPhotoUploadProps) {
  const [dragging, setDragging] = useState(false);

  const take = (files: FileList | null) => {
    const file = files?.[0];
    if (file && file.type.startsWith("image/")) onSelect(file);
  };

  return (
    <div className="field">
      <label>{label}</label>
      <div
        className={`upload-zone${dragging ? " dragging" : ""}`}
        style={{ padding: previewUrl ? 12 : "32px 20px" }}
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (!disabled) take(e.dataTransfer.files);
        }}
      >
        <input
          type="file"
          accept="image/*"
          disabled={disabled}
          aria-label={label}
          onChange={(e) => {
            take(e.target.files);
            e.target.value = "";
          }}
        />
        {previewUrl ? (
          <div style={{ position: "relative", pointerEvents: "auto" }}>
            <img src={previewUrl || "/placeholder.svg"} alt={label} className="photo-preview" />
            <button
              type="button"
              className="photo-remove"
              aria-label="Remove photo"
              onClick={(e) => {
                e.stopPropagation();
                onClear();
              }}
            >
              &times;
            </button>
          </div>
        ) : (
          <>
            <div className="icon" aria-hidden="true">
              <svg
                width="26"
                height="26"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M14.5 4h-5L8 6H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-4l-1.5-2Z" />
                <circle cx="12" cy="13" r="3.5" />
              </svg>
            </div>
            <p>Drag a photo here, or click to browse</p>
          </>
        )}
      </div>
    </div>
  );
}
