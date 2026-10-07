import React, { StrictMode } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import PaymentPanel from '../PaymentPanel'
import PaymentModal from '../PaymentModal'

const mocks = vi.hoisted(() => ({
  post: vi.fn(), get: vi.fn(), confirm: vi.fn(), elements: { getElement: vi.fn(() => ({})) },
  sessions: [],
}))
vi.mock('../../lib/api', () => ({ default: { post: mocks.post, get: mocks.get } }))
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
  const storage = new Map()
  vi.stubGlobal('localStorage', { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) })
  localStorage.setItem('sc_token', `test.${btoa(JSON.stringify({ id: 'user-1', shop_id: 'shop-1', role: 'owner' }))}.test`)
  mocks.get.mockReset().mockResolvedValue({ data: { roId: 'ro-1', paymentStatus: 'unpaid', collectionBalance: { remainingCents: 10000, canCollect: true } } })
  vi.stubEnv('VITE_STRIPE_PUBLISHABLE_KEY', 'pk_test_fixture')
  mocks.post.mockReset().mockResolvedValue({ data: session() })
  mocks.confirm.mockReset().mockResolvedValue(result())
  mocks.sessions.length = 0
})
afterEach(() => { cleanup(); vi.unstubAllEnvs(); vi.unstubAllGlobals() })

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
      it(`discards late intent creation and requires explicit reconciliation after ${JSON.stringify(changed)}`, async () => {
        const old = deferred()
        mocks.post.mockReturnValueOnce(old.promise)
        const view = await start()
        view.rerender(<Component {...props(changed)} />)
        await act(async () => old.resolve({ data: session() }))
        expect(screen.queryByTestId('stripe-elements')).not.toBeInTheDocument()
        expect(screen.getByRole('button', { name: 'Pay by Card' })).toBeDisabled()
        expect(mocks.post).toHaveBeenCalledTimes(1)
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

    function reconcile() {
      fireEvent.click(screen.getByRole('button', { name: 'Reconcile payments' }))
      fireEvent.click(screen.getByRole('button', { name: 'Confirm reconciliation' }))
    }
    const reconciles = () => mocks.post.mock.calls.filter(([url]) => url.includes('/reconcile/'))
    const balanceReply = (extra = {}) => ({ roId: 'ro-1', paymentStatus: 'unpaid', collectionBalance: { remainingCents: 10000, canCollect: true }, ...extra })

    for (const role of ['owner', 'admin', 'assistant', 'technician', 'staff', 'superadmin', 'customer', null]) {
      it(`uses real auth identity for reconciliation visibility: ${role}`, async () => {
        if (role) localStorage.setItem('sc_token', `test.${btoa(JSON.stringify({ id: 'user-1', role }))}.test`)
        else localStorage.removeItem('sc_token')
        await start({ role: 'owner' }) // A forged component prop is not authorization.
        await screen.findByRole('button', { name: 'Pay $60.00' })
        expect(!!screen.queryByRole('button', { name: 'Reconcile payments' })).toBe(['owner', 'admin'].includes(role))
        expect(reconciles()).toHaveLength(0)
        expect(mocks.get).not.toHaveBeenCalled()
      })
    }

    it('requires confirmation, traps keyboard focus, cancels with Escape and restores focus', async () => {
      const onClose = vi.fn()
      await start({ onClose })
      await screen.findByRole('button', { name: 'Pay $60.00' })
      const trigger = screen.getByRole('button', { name: 'Reconcile payments' })
      fireEvent.click(trigger)
      expect(screen.getByRole('alertdialog')).toHaveTextContent(/may expire or cancel pending payment attempts/)
      const cancel = screen.getByRole('button', { name: 'Cancel' })
      expect(cancel).toHaveFocus()
      fireEvent.keyDown(cancel, { key: 'Tab' })
      expect(screen.getByRole('button', { name: 'Confirm reconciliation' })).toHaveFocus()
      fireEvent.keyDown(document.activeElement, { key: 'Tab', shiftKey: true })
      expect(cancel).toHaveFocus()
      fireEvent.keyDown(cancel, { key: 'Escape' })
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
      expect(trigger).toHaveFocus()
      expect(onClose).not.toHaveBeenCalled()
      fireEvent.click(trigger)
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
      expect(trigger).toHaveFocus()
      expect(reconciles()).toHaveLength(0)
      expect(screen.getByTestId('stripe-elements')).toBeInTheDocument()
    })

    it('invalidates Stripe, locks duplicate submits and unlocks only after verified refresh and callback', async () => {
      const pending = deferred(), refresh = deferred(), callback = deferred()
      const onSuccess = vi.fn(() => callback.promise)
      await start({ onSuccess }); await screen.findByTestId('stripe-elements')
      mocks.post.mockReturnValue(pending.promise)
      mocks.get.mockReturnValue(refresh.promise)
      fireEvent.click(screen.getByRole('button', { name: 'Reconcile payments' }))
      const confirm = screen.getByRole('button', { name: 'Confirm reconciliation' })
      act(() => { confirm.click(); confirm.click() })
      expect(reconciles()).toHaveLength(1)
      expect(reconciles()[0]).toEqual(['/payments/reconcile/ro-1', {}, { timeout: 15000 }])
      expect(screen.queryByTestId('stripe-elements')).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Pay by Card' })).toBeDisabled()
      await act(async () => pending.resolve({ data: { reconciled: true } }))
      expect(mocks.get).toHaveBeenCalledExactlyOnceWith('/payments/ro/ro-1', { timeout: 15000 })
      expect(onSuccess).not.toHaveBeenCalled()
      await act(async () => refresh.resolve({ data: balanceReply({ paymentStatus: 'partial', collectionBalance: { remainingCents: 4000, canCollect: true } }) }))
      expect(onSuccess).toHaveBeenCalledTimes(1)
      expect(screen.getByRole('button', { name: 'Pay by Card' })).toBeDisabled()
      await act(async () => callback.resolve())
      expect(screen.getByRole('status')).toHaveTextContent('partial. Remaining balance: $40.00')
      expect(screen.getByRole('button', { name: 'Pay by Card' })).toBeEnabled()
      expect(mocks.post).toHaveBeenCalledTimes(2)
      mocks.post.mockResolvedValue({ data: session({ paymentIntentId: 'pi_new', clientSecret: 'pi_new_secret_fixture', amountCents: 4000, amountOwedCents: 4000 }) })
      fireEvent.click(screen.getByRole('button', { name: 'Pay by Card' }))
      expect(await screen.findByRole('button', { name: 'Pay $40.00' })).toBeEnabled()
      expect(screen.getByTestId('stripe-elements')).toHaveAttribute('data-secret', 'pi_new_secret_fixture')
    })

    for (const outcome of [409, 500, 'timeout']) {
      it(`keeps unknown payment recoverable, then holds after reconciliation ${outcome} without exposing errors`, async () => {
        mocks.confirm.mockRejectedValue(new Error('pi_private_secret_PRIVATE'))
        const onSuccess = vi.fn(), onMarkManual = vi.fn()
        await start({ onSuccess, onMarkManual }); await pay()
        await screen.findByText(/outcome is unknown/)
        mocks.post.mockRejectedValue({ code: 'ECONNABORTED', message: 'pi_private_secret_PRIVATE', response: { status: outcome, data: { error: 'provider PRIVATE' } } })
        reconcile()
        expect(await screen.findByRole('alert')).toHaveTextContent(/Collection (is|remains) blocked/)
        expect(screen.getByRole('button', { name: 'Pay by Card' })).toBeDisabled()
        expect(screen.queryByTestId('stripe-elements')).not.toBeInTheDocument()
        expect(screen.queryByText(/PRIVATE|pi_private|provider/)).not.toBeInTheDocument()
        expect(screen.queryByRole('button', { name: 'Mark as Cash\/Check' })).not.toBeInTheDocument()
        expect(onSuccess).not.toHaveBeenCalled()
        expect(mocks.get).not.toHaveBeenCalled()
        expect(reconciles()).toHaveLength(1)
        expect(screen.getByRole('button', { name: 'Reconcile payments' })).toBeEnabled()
      })
    }

    for (const [label, reply] of [
      ['missing', undefined], ['wrong RO', { roId: 'ro-2' }],
      ['invalid cents', balanceReply({ collectionBalance: { remainingCents: '10000', canCollect: true } })],
      ['pending', balanceReply({ paymentStatus: 'pending' })],
      ['unknown', balanceReply({ paymentStatus: 'unknown' })],
      ['inconsistent zero', balanceReply({ collectionBalance: { remainingCents: 0, canCollect: false } })],
      ['occupied', balanceReply({ collectionBalance: { remainingCents: 10000, canCollect: false } })],
      ['paid but collectable', balanceReply({ paymentStatus: 'paid' })],
    ]) it(`fails closed on ${label} refresh`, async () => {
      const onSuccess = vi.fn()
      await start({ onSuccess }); await screen.findByTestId('stripe-elements')
      mocks.post.mockResolvedValue({ data: { reconciled: true } })
      mocks.get.mockResolvedValue({ data: reply })
      reconcile()
      expect(await screen.findByRole('alert')).toHaveTextContent('could not be verified')
      expect(screen.queryByRole('status')).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Pay by Card' })).toBeDisabled()
      expect(onSuccess).not.toHaveBeenCalled()
    })

    for (const failure of ['get', 'callback', 'malformed reconcile']) it(`does not unlock or claim success after ${failure} failure`, async () => {
      const onSuccess = failure === 'callback' ? vi.fn().mockRejectedValue(new Error('PRIVATE')) : vi.fn()
      await start({ onSuccess }); await screen.findByTestId('stripe-elements')
      mocks.post.mockResolvedValue({ data: failure === 'malformed reconcile' ? {} : { reconciled: true } })
      if (failure === 'get') mocks.get.mockRejectedValue(new Error('PRIVATE pi_secret'))
      reconcile()
      expect(await screen.findByRole('alert')).toHaveTextContent('Collection remains blocked')
      expect(screen.queryByRole('status')).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Pay by Card' })).toBeDisabled()
      expect(screen.queryByText(/PRIVATE|pi_secret/)).not.toBeInTheDocument()
    })

    it('refreshes a paid RO without enabling another collection', async () => {
      await start(); await screen.findByTestId('stripe-elements')
      mocks.post.mockResolvedValue({ data: { reconciled: true } })
      mocks.get.mockResolvedValue({ data: balanceReply({ paymentStatus: 'paid', collectionBalance: { remainingCents: 0, canCollect: false } }) })
      reconcile()
      expect(await screen.findByRole('status')).toHaveTextContent('paid. Remaining balance: $0.00')
      expect(screen.getByRole('button', { name: 'Pay by Card' })).toBeDisabled()
    })

    for (const stage of ['post', 'get']) for (const change of ['unmount', 'RO', 'estimate']) {
      it(`ignores late reconciliation ${stage} after ${change}`, async () => {
        const pending = deferred(), onSuccess = vi.fn()
        const view = await start({ onSuccess }); await screen.findByTestId('stripe-elements')
        mocks.post.mockResolvedValue({ data: { reconciled: true } })
        if (stage === 'post') mocks.post.mockReturnValue(pending.promise)
        else mocks.get.mockReturnValue(pending.promise)
        reconcile()
        await act(async () => {})
        if (change === 'unmount') view.unmount()
        else view.rerender(<Component {...props({ onSuccess, ...(change === 'RO' ? { roId: 'ro-2' } : { amount: 120, totalAmount: 120 }) })} />)
        await act(async () => pending.resolve({ data: stage === 'post' ? { reconciled: true } : balanceReply() }))
        expect(onSuccess).not.toHaveBeenCalled()
        expect(screen.queryByTestId('stripe-elements')).not.toBeInTheDocument()
        expect(screen.queryByText(/Reconciliation verified/)).not.toBeInTheDocument()
        if (change !== 'unmount') expect(screen.getByRole('button', { name: 'Pay by Card' })).toBeDisabled()
      })
    }

    for (const outcome of ['resolve', 'reject']) for (const change of ['unmount', 'RO', 'estimate']) {
      it(`ignores stale parent refresh ${outcome} after ${change}`, async () => {
        const callback = deferred(), onSuccess = vi.fn(() => callback.promise)
        const view = await start({ onSuccess }); await screen.findByTestId('stripe-elements')
        mocks.post.mockResolvedValue({ data: { reconciled: true } })
        reconcile()
        await act(async () => {})
        expect(onSuccess).toHaveBeenCalledTimes(1)
        expect(screen.getByRole('button', { name: 'Pay by Card' })).toBeDisabled()
        if (change === 'unmount') view.unmount()
        else view.rerender(<Component {...props({ onSuccess, ...(change === 'RO' ? { roId: 'ro-2' } : { amount: 120, totalAmount: 120 }) })} />)
        await act(async () => outcome === 'resolve' ? callback.resolve() : callback.reject(new Error('PRIVATE stale callback')))
        expect(screen.queryByText(/Reconciliation verified|could not be refreshed|PRIVATE/)).not.toBeInTheDocument()
        expect(screen.queryByTestId('stripe-elements')).not.toBeInTheDocument()
        expect(onSuccess).toHaveBeenCalledTimes(1)
        if (change !== 'unmount') {
          expect(screen.getByRole('button', { name: 'Pay by Card' })).toBeDisabled()
          expect(screen.getByRole('alert')).toHaveTextContent('Repair order changed')
          expect(screen.getByRole('button', { name: 'Reconcile payments' })).toBeEnabled()
        }
      })
    }

    it('reconciles during in-flight confirmation and ignores its late success callback', async () => {
      const provider = deferred(), reconciliation = deferred(), onSuccess = vi.fn()
      mocks.confirm.mockReturnValue(provider.promise)
      await start({ onSuccess }); await pay()
      mocks.post.mockReturnValue(reconciliation.promise)
      reconcile()
      expect(screen.queryByTestId('stripe-elements')).not.toBeInTheDocument()
      await act(async () => provider.resolve(result()))
      expect(onSuccess).not.toHaveBeenCalled()
      expect(screen.getByRole('button', { name: 'Pay by Card' })).toBeDisabled()
      await act(async () => reconciliation.reject(new Error('unknown')))
      expect(await screen.findByRole('alert')).toHaveTextContent('Collection remains blocked')
    })

    it('ignores late intent creation after an explicit reconciliation attempt', async () => {
      const intent = deferred()
      mocks.post.mockReturnValue(intent.promise)
      const view = await start()
      mocks.post.mockRejectedValue(new Error('unknown'))
      reconcile()
      await screen.findByRole('alert')
      await act(async () => intent.resolve({ data: session() }))
      expect(screen.queryByTestId('stripe-elements')).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Pay by Card' })).toBeDisabled()
      view.unmount()
    })

    it('cannot bypass unknown state by changing estimates or switching RO away and back', async () => {
      mocks.confirm.mockRejectedValue(new Error('unknown'))
      const view = await start(); await pay(); await screen.findByRole('alert')
      for (const change of [{ amount: 120, totalAmount: 120 }, { roId: 'ro-2' }, { roId: 'ro-1' }]) {
        view.rerender(<Component {...props(change)} />)
        expect(screen.getByRole('button', { name: 'Pay by Card' })).toBeDisabled()
        expect(screen.queryByTestId('stripe-elements')).not.toBeInTheDocument()
      }
      expect(mocks.post).toHaveBeenCalledTimes(1)
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
