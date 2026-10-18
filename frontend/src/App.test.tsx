import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import App from '@/App'
import { ApiError } from '@/lib/api/errors'
import type { HeatwaveAnalysis, HeatwaveRequest } from '@/lib/api/types'
import { makeAnalysis, makeAnomalies, type FixtureOptions } from '@/test/fixtures'

// 14 Oct 2026 -> the archive ends 9 Oct 2026 and the default period is 2010-01-01 to 2025-12-31.
const NOW = new Date(2026, 9, 14)

type Fetcher = (request: HeatwaveRequest, options: { signal: AbortSignal }) => Promise<HeatwaveAnalysis>

// Anomalies load next to the heatwave analysis; tests inject a stub so no test reaches the network.
const anomalyOk = async () => makeAnomalies()

function setup(fetcher: Fetcher) {
  const spy = vi.fn(fetcher)
  const user = userEvent.setup()
  render(<App fetcher={spy} anomalyFetcher={anomalyOk} now={NOW} />)
  return { spy, user }
}

const ok = (options: FixtureOptions = {}): Fetcher => async () => makeAnalysis(options)
const fails = (error: ApiError): Fetcher => async () => {
  throw error
}
const analyzeButton = () => screen.getByRole('button', { name: /analyze heatwaves|try again in/i })

function mockMedia(matching: (query: string) => boolean) {
  window.matchMedia = ((query: string) =>
    ({
      matches: matching(query),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
      onchange: null,
    }) as MediaQueryList) as typeof window.matchMedia
}

// The anomaly section is lazy-loaded; transform it up front so a busy machine cannot time out the first test.
beforeAll(async () => {
  await import('@/components/AnomalySection')
})

afterEach(() => {
  mockMedia(() => false)
  vi.restoreAllMocks()
})

describe('initial state', () => {
  it('shows the title, description, labelled controls and an empty state', () => {
    setup(ok())
    expect(screen.getByRole('heading', { level: 1, name: 'Heatwave Trend Analyzer' })).toBeInTheDocument()
    expect(screen.getByText(/measured against a fixed 1991–2020 baseline/i)).toBeInTheDocument()
    expect(screen.getByLabelText('Latitude')).toHaveValue('28.6139')
    expect(screen.getByLabelText('Longitude')).toHaveValue('77.2090')
    expect(screen.getByLabelText('Start date')).toHaveValue('2010-01-01')
    expect(screen.getByLabelText('End date')).toHaveValue('2025-12-31')
    expect(screen.getByLabelText('Rolling average window')).toHaveValue('5')
    expect(screen.getByLabelText('Hazard')).toHaveDisplayValue('Heatwave')
    expect(screen.getByRole('heading', { name: 'Pick a place and a period to begin' })).toBeInTheDocument()
    expect(analyzeButton()).toBeEnabled()
  })

  it('bounds the date pickers to the archive', () => {
    setup(ok())
    expect(screen.getByLabelText('Start date')).toHaveAttribute('min', '1940-01-01')
    expect(screen.getByLabelText('End date')).toHaveAttribute('max', '2026-10-09')
  })

  it('does not show result navigation until there are results', () => {
    setup(ok())
    expect(screen.queryByRole('navigation', { name: 'Result sections' })).toBeNull()
  })
})

describe('form validation', () => {
  it('blocks the request, shows the problem next to the field and focuses it', async () => {
    const { spy, user } = setup(ok())
    await user.clear(screen.getByLabelText('Latitude'))
    await user.type(screen.getByLabelText('Latitude'), '123')
    await user.click(analyzeButton())

    expect(spy).not.toHaveBeenCalled()
    const latitude = screen.getByLabelText('Latitude')
    expect(latitude).toHaveAttribute('aria-invalid', 'true')
    expect(latitude).toHaveFocus()
    expect(latitude).toHaveAccessibleDescription(/Latitude must be between -90 and 90/)
    expect(screen.getByRole('alert')).toHaveTextContent('Latitude must be between -90 and 90.')
  })

  it('reports several errors together and clears each as it is fixed', async () => {
    const { spy, user } = setup(ok())
    await user.clear(screen.getByLabelText('Longitude'))
    await user.clear(screen.getByLabelText('Start date'))
    await user.click(analyzeButton())
    expect(screen.getAllByRole('alert')).toHaveLength(2)
    expect(spy).not.toHaveBeenCalled()

    await user.type(screen.getByLabelText('Longitude'), '-0.1278')
    expect(screen.getByLabelText('Longitude')).not.toHaveAttribute('aria-invalid')
    expect(screen.getAllByRole('alert')).toHaveLength(1)
  })

  it('rejects an end date before the start date', async () => {
    const { spy, user } = setup(ok())
    await user.clear(screen.getByLabelText('End date'))
    await user.type(screen.getByLabelText('End date'), '2009-12-31')
    await user.click(analyzeButton())
    expect(screen.getByRole('alert')).toHaveTextContent('The end date must be on or after the start date.')
    expect(spy).not.toHaveBeenCalled()
  })

  it('warns when the range has too few full years for a trend', async () => {
    const { user } = setup(ok())
    await user.clear(screen.getByLabelText('Start date'))
    await user.type(screen.getByLabelText('Start date'), '2024-03-01')
    expect(screen.getByText(/contains 1 full calendar year/)).toHaveTextContent('Trends need at least 3 full years.')
  })

  it('sends validated numbers using the backend parameter semantics', async () => {
    const { spy, user } = setup(ok())
    await user.selectOptions(screen.getByLabelText('Rolling average window'), '10')
    await user.click(analyzeButton())
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1))
    expect(spy.mock.calls[0][0]).toEqual({
      latitude: 28.6139,
      longitude: 77.209,
      startDate: '2010-01-01',
      endDate: '2025-12-31',
      rollingWindowYears: 10,
    })
  })

  it('fills coordinates from an example location', async () => {
    const { user } = setup(ok())
    await user.click(screen.getByRole('button', { name: 'Sydney' }))
    expect(screen.getByLabelText('Latitude')).toHaveValue('-33.8688')
    expect(screen.getByLabelText('Longitude')).toHaveValue('151.2093')
  })
})

describe('loading', () => {
  it('shows a cold-request loading state with skeletons, announces it and can be cancelled', async () => {
    let release: (value: HeatwaveAnalysis) => void = () => {}
    const { spy, user } = setup(
      () =>
        new Promise<HeatwaveAnalysis>((resolve) => {
          release = resolve
        }),
    )
    await user.click(analyzeButton())

    const status = await screen.findByText('Analyzing heatwaves…', { selector: 'p' })
    expect(status.closest('[role="status"]')).toHaveTextContent(/Loading the 30-year baseline|Sending the request/)
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull()
    expect(document.querySelectorAll('[aria-hidden="true"].rounded-md').length).toBeGreaterThan(5) // skeleton blocks
    expect(screen.getAllByRole('status').some((el) => /can take up to 15 seconds/.test(el.textContent ?? ''))).toBe(true)
    expect(screen.getByRole('button', { name: 'Analyzing…' })).toBeDisabled()
    expect(spy).toHaveBeenCalledTimes(1)

    const signal = spy.mock.calls[0][1].signal
    await user.click(screen.getAllByRole('button', { name: 'Cancel' })[0])
    expect(signal.aborted).toBe(true)
    expect(screen.getByRole('heading', { name: 'Pick a place and a period to begin' })).toBeInTheDocument()
    expect(analyzeButton()).toBeEnabled()

    release(makeAnalysis()) // a late answer to a cancelled request is ignored
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(screen.queryByRole('heading', { name: /Heatwaves near/ })).toBeNull()
  })
})

describe('results', () => {
  it('renders every section from the API response and the section navigation', async () => {
    const { user } = setup(ok({ incompleteYears: [2024], missingDates: ['2021-03-04'], warnings: ['analysis_missing_days:1'] }))
    await user.click(analyzeButton())

    expect(await screen.findByRole('heading', { name: /Heatwaves near 28.614°N, 77.209°E/ })).toHaveFocus()
    expect(screen.getByRole('heading', { name: 'Summary' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Year by year' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Trends' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Data quality' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Methodology' })).toBeInTheDocument()
    expect(within(document.getElementById('charts') as HTMLElement).getAllByRole('figure')).toHaveLength(4)
    expect(await screen.findByRole('heading', { name: 'Temperature anomalies' })).toBeInTheDocument()
    expect(screen.getByRole('status', { hidden: true, name: '' })).toBeDefined()

    const nav = screen.getByRole('navigation', { name: 'Result sections' })
    expect(within(nav).getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual([
      '#summary',
      '#charts',
      '#anomalies',
      '#trends',
      '#quality',
      '#method',
    ])
    expect(screen.getByText('Analysis complete: 13 heatwave events found.')).toBeInTheDocument()
  })

  it('shows a clear message, not an error, when there are no heatwaves', async () => {
    const { user } = setup(ok({ noEvents: true }))
    await user.click(analyzeButton())
    expect(await screen.findByText('No heatwaves in this period')).toBeInTheDocument()
    expect(screen.getByText(/That is a valid result, not an error/)).toBeInTheDocument()
  })

  function placeHeading(top: number) {
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
      top,
      bottom: top + 40,
      left: 0,
      right: 100,
      width: 100,
      height: 40,
      x: 0,
      y: top,
      toJSON: () => ({}),
    })
  }

  it('scrolls the results heading into view when it is above the fold or under the header', async () => {
    const scrollSpy = vi.spyOn(Element.prototype, 'scrollIntoView')
    placeHeading(20)
    const { user } = setup(ok())
    await user.click(analyzeButton())
    await screen.findByRole('heading', { name: /Heatwaves near/ })
    expect(scrollSpy).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' })
  })

  it('uses instant scrolling when the user prefers reduced motion', async () => {
    const scrollSpy = vi.spyOn(Element.prototype, 'scrollIntoView')
    mockMedia((query) => query.includes('prefers-reduced-motion'))
    placeHeading(20)
    const { user } = setup(ok())
    await user.click(analyzeButton())
    await screen.findByRole('heading', { name: /Heatwaves near/ })
    expect(scrollSpy).toHaveBeenCalledWith({ behavior: 'auto', block: 'start' })
  })

  it('does not scroll when the heading is already comfortably in view', async () => {
    const scrollSpy = vi.spyOn(Element.prototype, 'scrollIntoView')
    placeHeading(200)
    const { user } = setup(ok())
    await user.click(analyzeButton())
    await screen.findByRole('heading', { name: /Heatwaves near/ })
    expect(scrollSpy).not.toHaveBeenCalled()
  })
})

describe('error handling', () => {
  it('brings an error panel into view when it would be hidden, except validation errors which focus a field', async () => {
    const scrollSpy = vi.spyOn(Element.prototype, 'scrollIntoView')
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ top: 10, bottom: 50, left: 0, right: 1, width: 1, height: 40, x: 0, y: 10, toJSON: () => ({}) })
    const { user } = setup(fails(new ApiError('unavailable', 'Database temporarily unavailable', { status: 503 })))
    await user.click(analyzeButton())
    await screen.findByText('The service is temporarily unavailable')
    expect(scrollSpy).toHaveBeenCalledTimes(1)
  })

  it('does not scroll away from the form on a validation error', async () => {
    const scrollSpy = vi.spyOn(Element.prototype, 'scrollIntoView')
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ top: 10, bottom: 50, left: 0, right: 1, width: 1, height: 40, x: 0, y: 10, toJSON: () => ({}) })
    const { user } = setup(fails(new ApiError('validation', 'Invalid request parameters', { status: 422, fieldErrors: [{ field: 'latitude', message: 'bad' }] })))
    await user.click(analyzeButton())
    await screen.findByText('The request was not accepted')
    expect(scrollSpy).not.toHaveBeenCalled()
  })

  it('422 with field errors: marks the field the backend named and keeps the form usable', async () => {
    const error = new ApiError('validation', 'Invalid request parameters', {
      status: 422,
      fieldErrors: [{ field: 'latitude', message: 'Input should be less than or equal to 90' }],
    })
    const { user } = setup(fails(error))
    await user.click(analyzeButton())

    expect(await screen.findByText('The request was not accepted')).toBeInTheDocument()
    const latitude = screen.getByLabelText('Latitude')
    expect(latitude).toHaveAttribute('aria-invalid', 'true')
    expect(latitude).toHaveFocus()
    expect(screen.getAllByText(/Input should be less than or equal to 90/).length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull() // fix the input instead
    expect(analyzeButton()).toBeEnabled()
  })

  it('422 from a service rule is attached to the matching field', async () => {
    const error = new ApiError('validation', 'start_date must be on or before end_date', { status: 422 })
    const { user } = setup(fails(error))
    await user.click(analyzeButton())
    await screen.findByText('The request was not accepted')
    expect(screen.getByLabelText('End date')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByLabelText('End date')).toHaveAccessibleDescription(/start_date must be on or before end_date/)
  })

  it('429: honours Retry-After by disabling the action and counting down', async () => {
    const error = new ApiError('rate_limited', 'Rate limit exceeded; retry later', { status: 429, retryAfterSeconds: 2 })
    const { spy, user } = setup(fails(error))
    await user.click(analyzeButton())

    expect(await screen.findByText('Too many analyses in a short time')).toBeInTheDocument()
    expect(screen.getByText(/Rate limit exceeded; retry later/)).toBeInTheDocument()
    const retry = screen.getAllByRole('button', { name: /Try again in \ds/ })
    expect(retry.length).toBe(2) // the panel's button and the form's button
    retry.forEach((button) => expect(button).toBeDisabled())
    expect(screen.getByText(/asked clients to wait before retrying/)).toBeInTheDocument()

    await waitFor(() => expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled(), { timeout: 4000 })
    expect(analyzeButton()).toBeEnabled()
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('503: explains the outage, shows the backend message and retries on request', async () => {
    let calls = 0
    const { spy, user } = setup(async () => {
      calls += 1
      if (calls === 1) {
        throw new ApiError('unavailable', 'Database temporarily unavailable', { status: 503 })
      }
      return makeAnalysis()
    })
    await user.click(analyzeButton())

    expect(await screen.findByText('The service is temporarily unavailable')).toBeInTheDocument()
    expect(screen.getByText(/Database temporarily unavailable/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('heading', { name: /Heatwaves near/ })).toBeInTheDocument()
    expect(spy).toHaveBeenCalledTimes(2)
    expect(spy.mock.calls[1][0]).toEqual(spy.mock.calls[0][0]) // the retry repeats the same request
  })

  it('504: explains a timeout and that fetched data is kept', async () => {
    const { user } = setup(fails(new ApiError('timeout', 'Weather provider timed out', { status: 504 })))
    await user.click(analyzeButton())
    expect(await screen.findByText('The analysis took too long')).toBeInTheDocument()
    expect(screen.getByText(/Data already fetched is kept/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled()
  })

  it('network failure: says the service could not be reached', async () => {
    const { user } = setup(fails(new ApiError('network', 'Network request failed.')))
    await user.click(analyzeButton())
    expect(await screen.findByText('Could not reach the analysis service')).toBeInTheDocument()
    expect(screen.getByText(/API address is correct/)).toBeInTheDocument()
    expect(screen.getByRole('alert')).not.toHaveTextContent('Network request failed.')
  })

  it('an unexpected thrown value still becomes a readable error', async () => {
    const { user } = setup(async () => {
      throw new Error('boom')
    })
    await user.click(analyzeButton())
    expect(await screen.findByText('Could not reach the analysis service')).toBeInTheDocument()
  })

  it('malformed 200: shows nothing from the bad payload', async () => {
    const { user } = setup(fails(new ApiError('invalid_response', 'summary.total_events should be a finite number')))
    await user.click(analyzeButton())
    expect(await screen.findByText('The response was not in the expected format')).toBeInTheDocument()
    expect(screen.queryByRole('figure')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()
  })

  it('a new success replaces an earlier error', async () => {
    let calls = 0
    const { user } = setup(async () => {
      calls += 1
      if (calls === 1) throw new ApiError('server', 'Internal server error', { status: 500 })
      return makeAnalysis()
    })
    await user.click(analyzeButton())
    await screen.findByText('The service hit an internal error')
    await user.click(analyzeButton())
    await screen.findByRole('heading', { name: /Heatwaves near/ })
    expect(screen.queryByText('The service hit an internal error')).toBeNull()
  })
})
