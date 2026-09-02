/**
 * Background image transport of the overlay editor: picking a file, sending it
 * to the backend and dropping one that is no longer referenced. Reporting a
 * failure stays with the caller, which is the only side that knows which toast
 * to raise.
 */
import { apiUrl } from "../../utils/api";

/** Reads a File as a base64 data URL. */
export function readFileAsBase64(file: File): Promise<string> {
  const reader = new FileReader();
  return new Promise<string>((resolve) => {
    reader.onload = () => resolve(reader.result as string);
    reader.readAsDataURL(file);
  });
}

/**
 * Uploads a background image and returns the file name the backend stored it
 * under. Throws when the upload is rejected, so the caller can leave the
 * settings untouched.
 */
export async function uploadBackgroundImage(file: File): Promise<string> {
  const base64 = await readFileAsBase64(file);
  const res = await fetch(apiUrl("/api/backgrounds/upload"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ image_base64: base64 }),
  });
  if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
  const data = await res.json();
  return data.filename;
}

/** Deletes a stored background image. The caller decides how a failure is reported. */
export function deleteBackgroundImage(filename: string): Promise<Response> {
  return fetch(apiUrl(`/api/backgrounds/${filename}`), { method: "DELETE" });
}

/** Opens the file picker for a background image and hands the pick to onPick. */
export function pickImageFile(onPick: (file: File) => void): void {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/png,image/jpeg,image/webp";
  input.onchange = () => {
    const file = input.files?.[0];
    if (file) onPick(file);
  };
  input.click();
}
