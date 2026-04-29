import { describe, expect, it } from 'vitest'
import { normalizeJobsResponse } from './jobs-api'
import type { HermesJob } from './jobs-api'

const job = {
  id: 'job-1',
  name: 'Example job',
  prompt: 'Run the example job',
  schedule: {},
  enabled: true,
  state: 'scheduled',
} satisfies HermesJob

describe('normalizeJobsResponse', () => {
  it('accepts dashboard cron jobs returned as a top-level array', () => {
    expect(normalizeJobsResponse([job])).toEqual([job])
  })

  it('accepts gateway jobs returned in an object wrapper', () => {
    expect(normalizeJobsResponse({ jobs: [job] })).toEqual([job])
  })

  it('falls back to an empty list for unexpected payloads', () => {
    expect(normalizeJobsResponse({ jobs: null })).toEqual([])
  })
})
