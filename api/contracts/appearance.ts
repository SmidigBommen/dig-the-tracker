export type Palette = 'nature' | 'neutral' | 'tokyo-night'
export type ThemeMode = 'system' | 'light' | 'dark'
export interface AppearancePreference { palette: Palette; mode: ThemeMode }
export interface AppearanceView extends AppearancePreference { identityId: string; revision: number }
export const defaultAppearance: AppearancePreference = { palette: 'nature', mode: 'system' }

export function isAppearancePreference(value: unknown): value is AppearancePreference {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return Object.keys(record).every(key => key === 'palette' || key === 'mode')
    && ['nature', 'neutral', 'tokyo-night'].includes(record.palette as string)
    && ['system', 'light', 'dark'].includes(record.mode as string)
}
