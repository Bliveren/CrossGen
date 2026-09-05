export type GptImage2ResolutionTier = "1K" | "2K" | "4K";

export interface GptImage2SizePreset {
  tier: GptImage2ResolutionTier;
  size: string;
}

export interface GptImage2SizePresetGroup {
  aspectRatio: string;
  presets: readonly GptImage2SizePreset[];
}

export const GPT_IMAGE_2_SIZE_PRESET_GROUPS = [
  {
    aspectRatio: "1:1",
    presets: [
      { tier: "1K", size: "1024x1024" },
      { tier: "2K", size: "2048x2048" },
      { tier: "4K", size: "2880x2880" }
    ]
  },
  {
    aspectRatio: "3:2",
    presets: [
      { tier: "1K", size: "1536x1024" },
      { tier: "2K", size: "2160x1440" },
      { tier: "4K", size: "3456x2304" }
    ]
  },
  {
    aspectRatio: "2:3",
    presets: [
      { tier: "1K", size: "1024x1536" },
      { tier: "2K", size: "1440x2160" },
      { tier: "4K", size: "2304x3456" }
    ]
  },
  {
    aspectRatio: "16:9",
    presets: [
      { tier: "1K", size: "1280x720" },
      { tier: "2K", size: "2560x1440" },
      { tier: "4K", size: "3840x2160" }
    ]
  },
  {
    aspectRatio: "9:16",
    presets: [
      { tier: "1K", size: "720x1280" },
      { tier: "2K", size: "1440x2560" },
      { tier: "4K", size: "2160x3840" }
    ]
  },
  {
    aspectRatio: "4:3",
    presets: [
      { tier: "1K", size: "1024x768" },
      { tier: "2K", size: "2048x1536" },
      { tier: "4K", size: "3200x2400" }
    ]
  },
  {
    aspectRatio: "3:4",
    presets: [
      { tier: "1K", size: "768x1024" },
      { tier: "2K", size: "1536x2048" },
      { tier: "4K", size: "2400x3200" }
    ]
  },
  {
    aspectRatio: "21:9",
    presets: [
      { tier: "1K", size: "1280x544" },
      { tier: "2K", size: "2560x1088" },
      { tier: "4K", size: "3840x1600" }
    ]
  }
] as const satisfies readonly GptImage2SizePresetGroup[];

export const GPT_IMAGE_2_SIZE_PRESET_VALUES: readonly string[] = [
  "auto",
  ...GPT_IMAGE_2_SIZE_PRESET_GROUPS.flatMap((group) => group.presets.map((preset) => preset.size))
];

export function isGptImage2SizePreset(value: string): boolean {
  return GPT_IMAGE_2_SIZE_PRESET_VALUES.includes(value);
}
