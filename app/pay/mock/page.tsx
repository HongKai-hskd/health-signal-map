"use client";

import { Check, CircleHelp, HeartPulse, LockKeyhole } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

type PayerPayment = {
  orderNo: string;
  provider: "wechat_mock";
  plan: "pulse_weekly";
  amountFen: number;
  status: "pending" | "paid" | "expired";
  expiresAt: string;
  paidAt: string | null;
};

async function readJson<T>(response: Response) {
  const payload = await response.json().catch(() => null) as (T & { error?: string }) | null;
  if (!response.ok) throw new Error(payload?.error ?? "模拟收银台暂时不可用。");
  return payload as T;
}

export default function MockPaymentPage() {
  const token = typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("token") ?? "";
  const [payment, setPayment] = useState<PayerPayment | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    void (async () => {
      try {
        const response = await fetch(`/api/pay/mock?token=${encodeURIComponent(token)}`, { cache: "no-store" });
        const payload = await readJson<{ payment: PayerPayment }>(response);
        setPayment(payload.payment);
      } catch (requestError) {
        setError(requestError instanceof Error ? requestError.message : "模拟收银台暂时不可用。");
      }
    })();
  }, [token]);

  const confirm = async () => {
    if (!token || confirming) return;
    setConfirming(true);
    setError(null);
    try {
      const response = await fetch("/api/pay/mock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ checkoutToken: token }),
      });
      const payload = await readJson<{ payment: PayerPayment }>(response);
      setPayment(payload.payment);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "模拟支付没有完成，请重试。");
    } finally {
      setConfirming(false);
    }
  };

  const status = payment?.status;
  return <main className="mock-pay-page"><section className="mock-pay-card"><div className="mock-pay-brand"><span className="brand-mark"><HeartPulse size={18} /></span><span>pulse<span>/08</span> · 模拟收银台</span></div>{error ? <><CircleHelp size={34} className="mock-pay-icon" /><h1>这个二维码无法使用</h1><p>{error}</p></> : !payment ? <><span className="mock-pay-loader" /><p>正在读取模拟订单…</p></> : status === "paid" ? <><span className="mock-pay-success"><Check size={28} /></span><h1>模拟支付已确认</h1><p>不会产生任何扣款。桌面端报告会自动切换为完整地图。</p><Link className="mock-pay-return" href="/">返回已解锁报告</Link></> : status === "expired" ? <><CircleHelp size={34} className="mock-pay-icon" /><h1>二维码已过期</h1><p>请回到桌面端重新生成模拟支付二维码。</p></> : <><div className="mock-pay-provider"><strong>微信支付</strong><span>演示环境 · 不会转账</span></div><p className="mock-pay-amount">￥{(payment.amountFen / 100).toFixed(2)}</p><p>订单号 · {payment.orderNo}</p><div className="mock-pay-notice"><LockKeyhole size={15} /> 此操作仅模拟支付渠道回调，不会调用微信或银行卡。</div><Button className="mock-pay-confirm" onClick={() => void confirm()} disabled={confirming}>{confirming ? "正在确认…" : "确认模拟支付"}</Button></>}</section></main>;
}
