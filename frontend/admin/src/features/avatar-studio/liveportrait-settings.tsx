import { Fragment } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { LivePortraitSettings } from '@/lib/api'

export const DEFAULT_LIVEPORTRAIT_SETTINGS: LivePortraitSettings = {
  drivingSpeed: 1,
  drivingMultiplier: 1,
  drivingOption: 'expression-friendly',
  animationRegion: 'all',
  useHalfPrecision: true,
  flagCropDrivingVideo: false,
  flagNormalizeLip: false,
  flagEyeRetargeting: false,
  flagLipRetargeting: false,
  flagSourceVideoEyeRetargeting: false,
  flagStitching: true,
  flagRelativeMotion: true,
  flagPasteback: true,
  flagDoCrop: true,
  flagDoRot: true,
  drivingSmoothObservationVariance: 3e-7,
  detThresh: 0.15,
  scale: 2.3,
  vxRatio: 0,
  vyRatio: -0.125,
  sourceMaxDim: 1280,
  sourceDivision: 2,
  scaleCropDrivingVideo: 2.2,
  vxRatioCropDrivingVideo: 0,
  vyRatioCropDrivingVideo: -0.1,
  outputFps: 24,
  crf: 15,
  outputFormat: 'mp4',
  baseSeconds: 4,
  outputWidth: 720,
  outputHeight: 1280,
  drivingTemplate: 'd1.pkl',
}

type Props = {
  value: LivePortraitSettings
  onChange: (next: LivePortraitSettings) => void
  disabled?: boolean
}

type FieldSpec = {
  key: keyof LivePortraitSettings
  labelKey: string
  min?: number
  max?: number
  step?: number
}

const MOTION_NUMBERS: FieldSpec[] = [
  { key: 'drivingSpeed', labelKey: 'studio.lpDrivingSpeed', min: 0.05, max: 4, step: 0.05 },
  { key: 'drivingMultiplier', labelKey: 'studio.lpDrivingMultiplier', min: 0, max: 3, step: 0.05 },
  {
    key: 'drivingSmoothObservationVariance',
    labelKey: 'studio.lpSmoothVariance',
    min: 0,
    step: 1e-7,
  },
]

const CROP_NUMBERS: FieldSpec[] = [
  { key: 'detThresh', labelKey: 'studio.lpCrop.detThresh', step: 0.01 },
  { key: 'scale', labelKey: 'studio.lpCrop.scale', step: 0.1 },
  { key: 'vxRatio', labelKey: 'studio.lpCrop.vxRatio', step: 0.05 },
  { key: 'vyRatio', labelKey: 'studio.lpCrop.vyRatio', step: 0.05 },
  { key: 'scaleCropDrivingVideo', labelKey: 'studio.lpCrop.scaleCropDrivingVideo', step: 0.1 },
  {
    key: 'vxRatioCropDrivingVideo',
    labelKey: 'studio.lpCrop.vxRatioCropDrivingVideo',
    step: 0.05,
  },
  {
    key: 'vyRatioCropDrivingVideo',
    labelKey: 'studio.lpCrop.vyRatioCropDrivingVideo',
    step: 0.05,
  },
  { key: 'sourceMaxDim', labelKey: 'studio.lpCrop.sourceMaxDim', step: 64 },
  { key: 'sourceDivision', labelKey: 'studio.lpCrop.sourceDivision', min: 1, max: 16 },
]

const OUTPUT_NUMBERS: FieldSpec[] = [
  { key: 'outputWidth', labelKey: 'studio.lpOutputWidth', min: 64, step: 16 },
  { key: 'outputHeight', labelKey: 'studio.lpOutputHeight', min: 64, step: 16 },
  { key: 'outputFps', labelKey: 'studio.lpOutputFps', min: 1, max: 60 },
  { key: 'crf', labelKey: 'studio.lpCrf', min: 0, max: 51 },
]

const MOTION_FLAGS: FieldSpec[] = [
  { key: 'useHalfPrecision', labelKey: 'studio.lpFlag.useHalfPrecision' },
  { key: 'flagNormalizeLip', labelKey: 'studio.lpFlag.flagNormalizeLip' },
  { key: 'flagRelativeMotion', labelKey: 'studio.lpFlag.flagRelativeMotion' },
  { key: 'flagStitching', labelKey: 'studio.lpFlag.flagStitching' },
  { key: 'flagPasteback', labelKey: 'studio.lpFlag.flagPasteback' },
  { key: 'flagDoCrop', labelKey: 'studio.lpFlag.flagDoCrop' },
  { key: 'flagDoRot', labelKey: 'studio.lpFlag.flagDoRot' },
  { key: 'flagCropDrivingVideo', labelKey: 'studio.lpFlag.flagCropDrivingVideo' },
  { key: 'flagEyeRetargeting', labelKey: 'studio.lpFlag.flagEyeRetargeting' },
  { key: 'flagLipRetargeting', labelKey: 'studio.lpFlag.flagLipRetargeting' },
  {
    key: 'flagSourceVideoEyeRetargeting',
    labelKey: 'studio.lpFlag.flagSourceVideoEyeRetargeting',
  },
]

// Templates shipped with the cloned LivePortrait repo
// (worker/external/LivePortrait/assets/examples/driving). Users can drop more
// .pkl / .mp4 files into that directory and type the filename here.
// Ordered best -> worst for the base-video (idle) use case, grouped by kind:
//   natural .pkl templates > real-person clips (longer first) >
//   emotion/effect templates (not ideal as idle) > short frantic loops.
const DRIVING_GROUPS: { headerKey: string; items: string[] }[] = [
  {
    headerKey: 'studio.lpGroupNatural',
    items: ['d8.pkl', 'd7.pkl', 'd5.pkl'],
  },
  {
    headerKey: 'studio.lpGroupVideo',
    items: [
      'd6.mp4',
      'd9.mp4',
      'd14.mp4',
      'd3.mp4',
      'd13.mp4',
      'd12.mp4',
      'd11.mp4',
      'd19.mp4',
      'd20.mp4',
      'd18.mp4',
      'd10.mp4',
      'd0.mp4',
    ],
  },
  {
    headerKey: 'studio.lpGroupExpression',
    items: [
      'shy.pkl',
      'wink.pkl',
      'laugh.pkl',
      'talking.pkl',
      'open_lip.pkl',
      'shake_face.pkl',
      'aggrieved.pkl',
    ],
  },
  {
    headerKey: 'studio.lpGroupShort',
    items: ['d2.pkl', 'd1.pkl'],
  },
]

const DRIVING_TEMPLATES = DRIVING_GROUPS.flatMap((group) => group.items)

const CUSTOM_TEMPLATE = '__custom__'

const MP4_DURATIONS: Record<string, string> = {
  'd0.mp4': '3.1',
  'd3.mp4': '11.8',
  'd6.mp4': '33.6',
  'd9.mp4': '19.6',
  'd10.mp4': '15.0',
  'd11.mp4': '9.0',
  'd12.mp4': '7.3',
  'd13.mp4': '11.7',
  'd14.mp4': '17.9',
  'd18.mp4': '7.2',
  'd19.mp4': '8.3',
  'd20.mp4': '7.0',
}

// i18next treats dots as path separators, so template names map to flat keys.
const TEMPLATE_NOTE_KEY: Record<string, string> = {
  'aggrieved.pkl': 'aggrievedPkl',
  'd1.pkl': 'd1Pkl',
  'd2.pkl': 'd2Pkl',
  'd5.pkl': 'd5Pkl',
  'd7.pkl': 'd7Pkl',
  'd8.pkl': 'd8Pkl',
  'laugh.pkl': 'laughPkl',
  'open_lip.pkl': 'openLipPkl',
  'shake_face.pkl': 'shakeFacePkl',
  'shy.pkl': 'shyPkl',
  'talking.pkl': 'talkingPkl',
  'wink.pkl': 'winkPkl',
}

// Estimated duration (seconds) of each driving template / clip, used to
// display and sync the base video length.
const TEMPLATE_DURATION: Record<string, number> = {
  'aggrieved.pkl': 2.3,
  'd1.pkl': 0.6,
  'd2.pkl': 0.6,
  'd5.pkl': 5.9,
  'd7.pkl': 7.1,
  'd8.pkl': 11,
  'laugh.pkl': 2.2,
  'open_lip.pkl': 3.1,
  'shake_face.pkl': 3.7,
  'shy.pkl': 3.2,
  'talking.pkl': 4,
  'wink.pkl': 2.3,
  'd0.mp4': 3.1,
  'd3.mp4': 11.8,
  'd6.mp4': 33.6,
  'd9.mp4': 19.6,
  'd10.mp4': 15,
  'd11.mp4': 9,
  'd12.mp4': 7.3,
  'd13.mp4': 11.7,
  'd14.mp4': 17.9,
  'd18.mp4': 7.2,
  'd19.mp4': 8.3,
  'd20.mp4': 7,
}

function FieldNote({ id }: { id: string }) {
  const { t } = useTranslation()
  return <p className='text-xs leading-relaxed text-muted-foreground'>{t(`studio.lpFieldDesc.${id}`)}</p>
}

function NumberField({
  spec,
  value,
  onNumber,
  disabled,
}: {
  spec: FieldSpec
  value: number
  onNumber: (key: FieldSpec['key'], next: number) => void
  disabled?: boolean
}) {
  const { t } = useTranslation()
  return (
    <div className='flex flex-col gap-1.5'>
      <Label>{t(spec.labelKey)}</Label>
      <Input
        type='number'
        min={spec.min}
        max={spec.max}
        step={spec.step}
        value={value}
        disabled={disabled}
        onChange={(e) => {
          const n = Number(e.target.value)
          if (!Number.isNaN(n)) onNumber(spec.key, n)
        }}
      />
      <FieldNote id={spec.key} />
    </div>
  )
}

export function LivePortraitSettingsPanel({ value, onChange, disabled }: Props) {
  const { t } = useTranslation()

  const set = <K extends keyof LivePortraitSettings>(
    key: K,
    next: LivePortraitSettings[K],
  ) => onChange({ ...value, [key]: next })

  const onNumber = (key: keyof LivePortraitSettings, next: number) =>
    set(key, next as LivePortraitSettings[typeof key])

  const templateNote = (name: string) =>
    name.endsWith('.mp4')
      ? t('studio.lpTemplateNote.mp4Video', { seconds: MP4_DURATIONS[name] ?? '' })
      : t(`studio.lpTemplateNote.${TEMPLATE_NOTE_KEY[name] ?? name}`)

  const templateDuration = (name: string): number | null =>
    TEMPLATE_DURATION[name] ?? null

  const renderTemplateOptions = () => (
    <>
      {DRIVING_GROUPS.map((group, index) => (
        <Fragment key={group.headerKey}>
          <SelectItem
            disabled
            value={`__header__${index}`}
            className='text-xs font-semibold text-muted-foreground'
          >
            {t(group.headerKey)}
          </SelectItem>
          {group.items.map((name) => (
            <SelectItem key={name} value={name}>
              <div className='flex w-full items-center justify-between gap-2'>
                <span>{name}</span>
                <span className='text-xs text-muted-foreground'>
                  {templateNote(name)}
                </span>
              </div>
            </SelectItem>
          ))}
        </Fragment>
      ))}
      <SelectItem value={CUSTOM_TEMPLATE}>{t('studio.lpTemplateCustom')}</SelectItem>
    </>
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle className='text-base'>{t('studio.liveportraitTitle')}</CardTitle>
        <CardDescription>{t('studio.liveportraitDesc')}</CardDescription>
      </CardHeader>
      <CardContent className='flex flex-col gap-5'>
        <p className='text-xs text-muted-foreground'>{t('studio.liveportraitHint')}</p>

        {/* 动作 / 推理 */}
        <fieldset className='space-y-3' disabled={disabled}>
          <legend className='text-sm font-medium'>{t('studio.lpGroupMotion')}</legend>
          <div className='grid grid-cols-2 gap-3'>
            {MOTION_NUMBERS.map((spec) => (
              <NumberField
                key={spec.key}
                spec={spec}
                value={value[spec.key] as number}
                onNumber={onNumber}
                disabled={disabled}
              />
            ))}
            <div className='flex flex-col gap-1.5'>
              <Label>{t('studio.lpDrivingOption')}</Label>
              <Select
                value={value.drivingOption}
                onValueChange={(v) =>
                  set('drivingOption', v as LivePortraitSettings['drivingOption'])
                }
                disabled={disabled}
              >
                <SelectTrigger className='w-full'>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value='expression-friendly'>
                    {t('studio.lpOptionExpression')}
                  </SelectItem>
                  <SelectItem value='pose-friendly'>{t('studio.lpOptionPose')}</SelectItem>
                </SelectContent>
              </Select>
              <FieldNote id='drivingOption' />
            </div>
            <div className='flex flex-col gap-1.5'>
              <Label>{t('studio.lpAnimationRegion')}</Label>
              <Select
                value={value.animationRegion}
                onValueChange={(v) =>
                  set('animationRegion', v as LivePortraitSettings['animationRegion'])
                }
                disabled={disabled}
              >
                <SelectTrigger className='w-full'>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(['all', 'exp', 'pose', 'lip', 'eyes'] as const).map((r) => (
                    <SelectItem key={r} value={r}>
                      {t(`studio.lpRegion.${r}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldNote id='animationRegion' />
            </div>
          </div>
          <div className='flex flex-col gap-2'>
            {MOTION_FLAGS.map((spec) => (
              <label
                key={spec.key}
                className='flex cursor-pointer items-start gap-2 text-sm'
              >
                <Checkbox
                  className='mt-0.5'
                  checked={Boolean(value[spec.key])}
                  onCheckedChange={(v) => set(spec.key, Boolean(v) as LivePortraitSettings[typeof spec.key])}
                  disabled={disabled}
                />
                <span className='flex flex-col'>
                  <span>{t(spec.labelKey)}</span>
                  <FieldNote id={spec.key} />
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        {/* 裁剪 */}
        <fieldset className='space-y-3' disabled={disabled}>
          <legend className='text-sm font-medium'>{t('studio.lpGroupCrop')}</legend>
          <div className='grid grid-cols-2 gap-3'>
            {CROP_NUMBERS.map((spec) => (
              <NumberField
                key={spec.key}
                spec={spec}
                value={value[spec.key] as number}
                onNumber={onNumber}
                disabled={disabled}
              />
            ))}
          </div>
        </fieldset>

        {/* 输出 / 项目 */}
        <fieldset className='space-y-3' disabled={disabled}>
          <legend className='text-sm font-medium'>{t('studio.lpGroupOutput')}</legend>
          <div className='grid grid-cols-2 gap-3'>
            <div className='col-span-2 flex flex-col gap-1.5'>
              <Label>{t('studio.lpDrivingTemplate')}</Label>
              {DRIVING_TEMPLATES.includes(value.drivingTemplate) ? (
                <Select
                  value={value.drivingTemplate}
                  onValueChange={(v) =>
                    set('drivingTemplate', v === CUSTOM_TEMPLATE ? '' : v)
                  }
                  disabled={disabled}
                >
                  <SelectTrigger className='w-full'>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>{renderTemplateOptions()}</SelectContent>
                </Select>
              ) : (
                <>
                  <Select
                    value={CUSTOM_TEMPLATE}
                    onValueChange={(v) => {
                      if (v !== CUSTOM_TEMPLATE) set('drivingTemplate', v)
                    }}
                    disabled={disabled}
                  >
                    <SelectTrigger className='w-full'>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>{renderTemplateOptions()}</SelectContent>
                  </Select>
                  <Input
                    value={value.drivingTemplate}
                    placeholder='my_template.pkl'
                    disabled={disabled}
                    onChange={(e) => set('drivingTemplate', e.target.value)}
                  />
                </>
              )}
              <FieldNote id='drivingTemplate' />
              {templateDuration(value.drivingTemplate) != null && (
                <div className='flex items-center gap-2'>
                  <span className='text-xs text-muted-foreground'>
                    {t('studio.lpTemplateDuration', {
                      seconds: templateDuration(value.drivingTemplate),
                    })}
                  </span>
                  <Button
                    type='button'
                    variant='outline'
                    size='sm'
                    disabled={disabled}
                    onClick={() =>
                      set('baseSeconds', templateDuration(value.drivingTemplate)!)
                    }
                  >
                    {t('studio.lpSyncBaseLength')}
                  </Button>
                </div>
              )}
            </div>
            {OUTPUT_NUMBERS.map((spec) => (
              <NumberField
                key={spec.key}
                spec={spec}
                value={value[spec.key] as number}
                onNumber={onNumber}
                disabled={disabled}
              />
            ))}
            <div className='flex flex-col gap-1.5'>
              <Label>{t('studio.lpOutputFormat')}</Label>
              <Select
                value={value.outputFormat}
                onValueChange={(v) =>
                  set('outputFormat', v as LivePortraitSettings['outputFormat'])
                }
                disabled={disabled}
              >
                <SelectTrigger className='w-full'>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value='mp4'>MP4</SelectItem>
                  <SelectItem value='gif'>GIF</SelectItem>
                </SelectContent>
              </Select>
              <FieldNote id='outputFormat' />
            </div>
            <div className='flex flex-col gap-1.5'>
              <Label>{t('studio.lpBaseSeconds')}</Label>
              <Input
                type='number'
                min={1}
                max={300}
                step={0.5}
                value={value.baseSeconds}
                disabled={disabled}
                onChange={(e) => {
                  const n = Number(e.target.value)
                  if (!Number.isNaN(n)) set('baseSeconds', n)
                }}
              />
              <FieldNote id='baseSeconds' />
              {templateDuration(value.drivingTemplate) != null && (
                <p className='text-xs text-muted-foreground'>
                  {t('studio.lpBaseVsTemplate', {
                    seconds: templateDuration(value.drivingTemplate),
                  })}
                </p>
              )}
            </div>
          </div>
        </fieldset>
      </CardContent>
    </Card>
  )
}
