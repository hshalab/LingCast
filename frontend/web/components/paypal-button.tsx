'use client'

import { PayPalButtons, PayPalScriptProvider } from '@paypal/react-paypal-js'

const CLIENT_ID = process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID

export default function PayPalCheckout() {
  if (!CLIENT_ID) {
    return (
      <p className="rounded-lg border border-dashed border-zinc-700 px-4 py-3 text-center text-sm text-zinc-500">
        PayPal 未配置：请设置 NEXT_PUBLIC_PAYPAL_CLIENT_ID 环境变量。
      </p>
    )
  }
  return (
    <PayPalScriptProvider options={{ clientId: CLIENT_ID }}>
      <PayPalButtons style={{ layout: 'vertical' }} />
    </PayPalScriptProvider>
  )
}
