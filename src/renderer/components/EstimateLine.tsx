import type { JSX } from 'react'
import { COPY } from '../lib/copy'
import { estimateBytes, formatBytes } from '../lib/format'

/**
 * 对应原型 `.estimate`。形如「34.2 MB → 约 12.0 MB」，后半段加粗并转主字色。
 *
 * 预估完全在前端算（SPEC §7：滑块拖动不发 IPC）。
 * 列表为空时整行不渲染，由调用方决定。
 */

export interface EstimateLineProps {
  totalBytes: number
  shrinkPercent: number
}

export function EstimateLine({ totalBytes, shrinkPercent }: EstimateLineProps): JSX.Element {
  const out = estimateBytes(totalBytes, shrinkPercent)

  return (
    <p className="font-mono text-1 tabular-nums text-fg-3">
      {formatBytes(totalBytes)} {COPY.arrow}{' '}
      <b className="font-normal text-fg">
        {COPY.estimateApprox} {formatBytes(out)}
      </b>
    </p>
  )
}
