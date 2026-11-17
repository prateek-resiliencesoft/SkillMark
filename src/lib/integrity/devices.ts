/**
 * Classifies camera / microphone labels. Labels can be renamed, so a match is
 * evidence, not proof; "processing" devices (noise suppression, phone-as-webcam,
 * capture cards) are common legitimate / accessibility tools and never warn.
 */
export type DeviceClass = "virtual" | "processing" | "physical";

const VIRTUAL_CAMERA = [
  /obs[\s-]*(virtual|camera)/i,
  /manycam/i,
  /xsplit/i,
  /snap camera/i,
  /mmhmm/i,
  /splitcam/i,
  /e2esoft|vcam/i,
  /altercam/i,
  /youcam/i,
  /unity video capture/i,
  /dummy video device/i, // v4l2loopback default
  /v4l2 ?loopback/i,
  /virtual (camera|cam|webcam)/i,
  /deep.?live.?cam|facefusion|avatarify/i,
];

const VIRTUAL_MIC = [
  /vb-?audio|cable (output|input)/i,
  /voicemeeter/i,
  /blackhole/i,
  /loopback audio/i,
  /soundflower/i,
  /virtual audio cable/i,
  /voicemod/i,
  /clownfish/i,
  /monitor of /i, // PulseAudio/PipeWire output monitor (system audio as mic)
  /stereo mix|what u hear|wave out mix/i,
];

const PROCESSING = [
  /krisp/i,
  /nvidia broadcast|rtx voice/i,
  /camo/i,
  /droidcam/i,
  /ivcam/i,
  /epoccam/i,
  /continuity camera/i,
  /logi(tech)? capture/i,
  /cam link|elgato/i,
  /descript|riverside/i,
];

export function classifyDeviceLabel(kind: "audio" | "video", label: string): DeviceClass {
  const l = label.trim();
  if (!l) return "physical";
  const virtual = kind === "video" ? VIRTUAL_CAMERA : VIRTUAL_MIC;
  if (virtual.some((r) => r.test(l))) return "virtual";
  if (PROCESSING.some((r) => r.test(l))) return "processing";
  return "physical";
}
