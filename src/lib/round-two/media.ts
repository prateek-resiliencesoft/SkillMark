import {
  ScreenSharePresets,
  VideoPreset,
  type RoomOptions,
  type VideoCaptureOptions,
} from "livekit-client";

/** Target capture/publish for Round 2 rooms: 1920×1080 @ 60fps (best-effort; camera may negotiate down). */
export const R2_VIDEO_PRESET = new VideoPreset(1920, 1080, 4_500_000, 60);

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
      new VideoPreset(640, 360, 450_000, 30),
      new VideoPreset(1280, 720, 1_700_000, 30),
    ],
    screenShareEncoding: ScreenSharePresets.h1080fps30.encoding,
  },
};
