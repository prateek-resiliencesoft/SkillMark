import {
  ScreenSharePresets,
  VideoPreset,
  type RoomOptions,
  type VideoCaptureOptions,
} from "livekit-client";

/**
 * Round 2 camera: 1080p.
 * Publish at 30fps — 60fps software encode freezes typical laptops while LiveKit + React
 * also run. Capture still asks for 1080p; adaptiveStream/dynacast downshift for weak links.
 */
export const R2_VIDEO_PRESET = new VideoPreset(1920, 1080, 2_800_000, 30);

export const R2_VIDEO_CAPTURE: VideoCaptureOptions = {
  resolution: R2_VIDEO_PRESET.resolution,
  facingMode: "user",
};

export function r2CameraCapture(deviceId?: string): VideoCaptureOptions {
  return {
    ...R2_VIDEO_CAPTURE,
    ...(deviceId ? { deviceId } : {}),
  };
}

export const R2_ROOM_OPTIONS: RoomOptions = {
  adaptiveStream: true,
  dynacast: true,
  videoCaptureDefaults: R2_VIDEO_CAPTURE,
  publishDefaults: {
    videoEncoding: R2_VIDEO_PRESET.encoding,
    videoSimulcastLayers: [
      new VideoPreset(640, 360, 400_000, 20),
      new VideoPreset(1280, 720, 1_400_000, 30),
    ],
    screenShareEncoding: ScreenSharePresets.h1080fps15.encoding,
    degradationPreference: "maintain-resolution",
  },
};
