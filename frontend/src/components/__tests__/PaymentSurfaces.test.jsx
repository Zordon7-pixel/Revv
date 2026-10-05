import React, { StrictMode } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import PaymentPanel from '../PaymentPanel'
import PaymentModal from '../PaymentModal'

const mocks = vi.hoisted(() => ({
  post: vi.fn(), confirm: vi.fn(), elements: { getElement: vi.fn(() => ({})) },
  sessions: [],
}))
vi.mock('../../lib/api', () => ({ default: { post: mocks.post } }))
vi.mock('@stripe/stripe-js', () => ({ loadStripe: () => Promise.resolve({}) }))
vi.mock('@stripe/react-stripe-js', () => ({
  Elements: ({ children, options }) => {
    mocks.sessions.push(options.clientSecret)
    return <div data-testid="stripe-elements" data-secret={options.clientSecret}>{children}</div>
  },
  PaymentElement: () => <div>Payment element</div>,
  CardElement: () => <div>Card element</div>,
  useStripe: () => ({ confirmPayment: mocks.confirm, confirmCardPayment: mocks.confirm }),
  useElements: () => mocks.elements,
}))

const session = (extra = {}) => ({ clientSecret: 'pi_fixture_secret_fixture', paymentIntentId: 'pi_fixture', amountCents: 6000, amountOwedCents: 10000, ...extra })
const result = (extra = {}) => ({ paymentIntent: { id: 'pi_fixture', amount: 6000, currency: 'usd', status: 'succeeded', ...extra } })
const deferred = () => {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
beforeEach(() => {
  vi.stubEnv('VITE_STRIPE_PUBLISHABLE_KEY', 'pk_test_fixture')
  mocks.post.mockReset().mockResolvedValue({ data: session() })
  mocks.confirm.mockReset().mockResolvedValue(result())
  mocks.sessions.length = 0
})
afterEach(() => { cleanup(); vi.unstubAllEnvs() })

for (const surface of ['Panel', 'Modal']) {
  describe(surface, () => {
    const Component = surface === 'Panel' ? PaymentPanel : PaymentModal
    const props = (extra = {}) => ({ roId: 'ro-1', totalAmount: 100, amount: 100, onClose: vi.fn(), ...extra })
    async function start(extra = {}) {
      const view = render(<Component {...props(extra)} />)
      if (surface === 'Panel') fireEvent.click(screen.getByRole('button', { name: 'Pay by Card' }))
      return view
    }
    async function pay() {
      const button = await screen.findByRole('button', { name: 'Pay $60.00' })
      fireEvent.click(button)
      return button
    }

    it('requests current available balance without stale gross, renders server cents and partial residual', async () => {
      const success = vi.fn()
      await start({ onSuccess: success })
      await screen.findByRole('button', { name: 'Pay $60.00' })
      expect(mocks.post).toHaveBeenCalledExactlyOnceWith(surface === 'Panel' ? '/payments/intent' : '/payments/create-intent', { ro_id: 'ro-1' })
      expect(screen.getByText(/server balance differs/)).toBeInTheDocument()
      expect(screen.getByText(/Partial payment.*\$40.00/)).toBeInTheDocument()
      const button = await pay()
      await screen.findByText('Confirmed charge:', { exact: false })
      expect(screen.getByRole('status')).toHaveTextContent('Payment received: $60.00')
      expect(screen.getByText(/Partial payment.*\$40.00/)).toBeInTheDocument()
      expect(screen.queryByText(/paid in full|RO paid|Payment successful/i)).not.toBeInTheDocument()
      expect(success).toHaveBeenCalledTimes(1)
      fireEvent.submit(button.closest('form'))
      expect(mocks.confirm).toHaveBeenCalledTimes(1)
      expect(button).toBeDisabled()
      if (surface === 'Panel') expect(mocks.confirm).toHaveBeenCalledWith({ elements: mocks.elements, redirect: 'if_required' })
      else expect(mocks.confirm).toHaveBeenCalledWith('pi_fixture_secret_fixture', { payment_method: { card: expect.any(Object) } })
    })

    it('handles an already partially paid RO using server available amount, without a full gross retry', async () => {
      mocks.post.mockResolvedValue({ data: session({ amountOwedCents: 6000 }) })
      await start()
      await pay()
      await screen.findByText('Confirmed charge:', { exact: false })
      expect(screen.queryByText(/Partial payment/)).not.toBeInTheDocument()
      expect(mocks.post).toHaveBeenCalledTimes(1)
      expect(mocks.post.mock.calls[0][1]).not.toHaveProperty('amount')
      expect(screen.getByRole('status')).toHaveTextContent('$60.00')
    })

    for (const [label, data] of [
      ['missing amount', session({ amountCents: undefined })],
      ['string amount', session({ amountCents: '6000' })],
      ['fraction cents', session({ amountCents: 60.5 })],
      ['zero amount', session({ amountCents: 0 })],
      ['negative amount', session({ amountCents: -1 })],
      ['unsafe cents', session({ amountCents: Number.MAX_SAFE_INTEGER + 1 })],
      ['NaN', session({ amountCents: NaN })],
      ['missing owed', session({ amountOwedCents: undefined })],
      ['inconsistent owed', session({ amountOwedCents: 5000 })],
      ['string owed', session({ amountOwedCents: '10000' })],
      ['fraction owed', session({ amountOwedCents: 10000.5 })],
      ['unsafe owed', session({ amountOwedCents: Number.MAX_SAFE_INTEGER + 1 })],
      ['wrong secret', session({ clientSecret: 'pi_wrong_secret_fixture' })],
      ['missing secret', session({ clientSecret: '' })],
      ['missing intent identity', session({ paymentIntentId: undefined })],
      ['empty reply', null],
    ]) {
      it(`fails closed on ${label} before rendering Stripe confirmation`, async () => {
        mocks.post.mockResolvedValue({ data })
        await start()
        expect(await screen.findByRole('alert')).toHaveTextContent('valid payment session')
        expect(screen.queryByTestId('stripe-elements')).not.toBeInTheDocument()
        expect(mocks.confirm).not.toHaveBeenCalled()
        expect(mocks.post).toHaveBeenCalledTimes(1)
      })
    }

    it('shows an initialization error without leaking API text or retrying an uncertain reservation', async () => {
      mocks.post.mockRejectedValue({ response: { data: { error: 'private provider error' } } })
      await start()
      expect(await screen.findByRole('alert')).toHaveTextContent('Refresh the balance')
      expect(screen.queryByText(/private provider/)).not.toBeInTheDocument()
      expect(mocks.confirm).not.toHaveBeenCalled()
      expect(mocks.post).toHaveBeenCalledTimes(1)
    })

    for (const [label, outcome, message] of [
      ['provider error', { error: { message: 'private provider error' } }, /could not be confirmed/],
      ['processing', result({ status: 'processing' }), /pending or incomplete/],
      ['requires action', result({ status: 'requires_action' }), /pending or incomplete/],
      ['requires payment method', result({ status: 'requires_payment_method' }), /pending or incomplete/],
      ['wrong amount', result({ amount: 9999 }), /could not be verified/],
      ['wrong identity', result({ id: 'pi_other' }), /could not be verified/],
      ['wrong currency', result({ currency: 'eur' }), /could not be verified/],
      ['no result', undefined, /could not be verified/],
    ]) {
      it(`resets submitting and refuses duplicate confirmation for ${label}`, async () => {
        mocks.confirm.mockResolvedValue(outcome)
        const success = vi.fn()
        await start({ onSuccess: success })
        const button = await pay()
        expect(await screen.findByRole('alert')).toHaveTextContent(message)
        expect(button).toHaveTextContent('Pay $60.00')
        expect(button).toBeDisabled()
        fireEvent.submit(button.closest('form'))
        expect(mocks.confirm).toHaveBeenCalledTimes(1)
        expect(success).not.toHaveBeenCalled()
        expect(screen.queryByText(/private provider/)).not.toBeInTheDocument()
      })
    }

    for (const asynchronous of [false, true]) {
      it(`handles ${asynchronous ? 'asynchronous rejection' : 'synchronous throw'} as unknown without duplicate charge`, async () => {
        mocks.confirm.mockImplementation(() => {
          if (asynchronous) return Promise.reject(new Error('private error'))
          throw new Error('private error')
        })
        const success = vi.fn()
        await start({ onSuccess: success })
        const button = await pay()
        expect(await screen.findByRole('alert')).toHaveTextContent('outcome is unknown')
        expect(button).toHaveTextContent('Pay $60.00')
        fireEvent.submit(button.closest('form'))
        expect(mocks.confirm).toHaveBeenCalledTimes(1)
        expect(success).not.toHaveBeenCalled()
      })
    }

    it('locks immediately during deferred provider confirmation and keeps callback failure separate from charge success', async () => {
      const pending = deferred()
      mocks.confirm.mockReturnValue(pending.promise)
      const success = vi.fn().mockRejectedValue(new Error('refresh failed'))
      await start({ onSuccess: success })
      const button = await pay()
      fireEvent.submit(button.closest('form'))
      expect(button).toHaveTextContent('Processing...')
      expect(mocks.confirm).toHaveBeenCalledTimes(1)
      await act(async () => pending.resolve(result()))
      expect(await screen.findByRole('alert')).toHaveTextContent('Payment received, but the balance could not be refreshed')
      expect(screen.getByRole('status')).toHaveTextContent('$60.00')
      expect(button).toHaveTextContent('Pay $60.00')
      expect(success).toHaveBeenCalledTimes(1)
    })

    for (const changed of [{ roId: 'ro-2' }, { amount: 120, totalAmount: 120 }]) {
      it(`removes the old client secret and ignores late intent creation after ${JSON.stringify(changed)}`, async () => {
        const old = deferred(), next = deferred()
        mocks.post.mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise)
        const view = await start()
        view.rerender(<Component {...props(changed)} />)
        if (surface === 'Panel') fireEvent.click(screen.getByRole('button', { name: 'Pay by Card' }))
        await act(async () => old.resolve({ data: session() }))
        expect(screen.queryByTestId('stripe-elements')).not.toBeInTheDocument()
        await act(async () => next.resolve({ data: session({ paymentIntentId: 'pi_next', clientSecret: 'pi_next_secret_fixture' }) }))
        expect(await screen.findByTestId('stripe-elements')).toHaveAttribute('data-secret', 'pi_next_secret_fixture')
        expect(mocks.sessions).not.toContain('pi_fixture_secret_fixture')
        expect(mocks.confirm).not.toHaveBeenCalled()
      })

      it(`unmounts a ready checkout immediately after ${JSON.stringify(changed)}`, async () => {
        const view = await start()
        await screen.findByTestId('stripe-elements')
        const next = deferred()
        mocks.post.mockReturnValue(next.promise)
        view.rerender(<Component {...props(changed)} />)
        expect(screen.queryByTestId('stripe-elements')).not.toBeInTheDocument()
        expect(screen.queryByRole('button', { name: 'Pay $60.00' })).not.toBeInTheDocument()
        expect(mocks.confirm).not.toHaveBeenCalled()
      })
    }

    it('ignores provider completion/callback after RO identity changed', async () => {
      const pending = deferred()
      mocks.confirm.mockReturnValue(pending.promise)
      const success = vi.fn()
      const view = await start({ onSuccess: success })
      await pay()
      mocks.post.mockReturnValue(new Promise(() => {}))
      view.rerender(<Component {...props({ roId: 'ro-2', onSuccess: success })} />)
      await act(async () => pending.resolve(result()))
      expect(success).not.toHaveBeenCalled()
      expect(screen.queryByText(/Payment received/)).not.toBeInTheDocument()
    })

    it('does not initialize duplicate intents under StrictMode or rapid clicks', async () => {
      render(<StrictMode><Component {...props()} /></StrictMode>)
      if (surface === 'Panel') {
        const startButton = screen.getByRole('button', { name: 'Pay by Card' })
        fireEvent.click(startButton)
        fireEvent.click(startButton)
      }
      await screen.findByRole('button', { name: 'Pay $60.00' })
      expect(mocks.post).toHaveBeenCalledTimes(1)
    })
  })
}
