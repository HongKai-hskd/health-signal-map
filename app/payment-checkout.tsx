"use client";

import QRCode from "qrcode";
import { Check, CircleHelp, ExternalLink, QrCode, X } from "lucide-react";
import Image from "next/image";
import { useEffect, useMemo, useState } from "react";

export type CheckoutPayment = {
  id: string;
  orderNo: string;
  provider: "wechat_mock";
  plan: "pulse_weekly";
  amountFen: number;
  status: "pending" | "paid" | "expired";
  expiresAt: string;
  paidAt: string | null;
  createdAt: string;
  updatedAt: string;
  checkoutUrl: string;
};

type PaymentStatusResponse = {
  payment: Pick<CheckoutPayment, "status" | "paidAt" | "expiresAt">;
};

function formatRemaining(expiresAt: string, now: number) {
  const remainingMs = Math.max(0, new Date(expiresAt).getTime() - now);
  const seconds = Math.floor(remainingMs / 1000);
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

async function fetchPaymentStatus(orderId: string) {
  const response = await fetch(`/api/pay?orderId=${encodeURIComponent(orderId)}`, {
    credentials: "same-origin",
    cache: "no-store",
  });
  const payload = await response.json().catch(() => null) as PaymentStatusResponse & { error?: string } | null;
  if (!response.ok) throw new Error(payload?.error ?? "支付状态暂时无法读取。");
  return payload as PaymentStatusResponse;
}

export function PaymentCheckout({
  payment,
  onClose,
  onPaid,
}: {
  payment: CheckoutPayment;
  onClose: () => void;
  onPaid: () => Promise<void>;
}) {
  const [qrImage, setQrImage] = useState<string | null>(null);
  const [status, setStatus] = useState(payment.status);
  const [now, setNow] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const remaining = useMemo(() => now === null ? "--:--" : formatRemaining(payment.expiresAt, now), [payment.expiresAt, now]);

  useEffect(() => {
    let active = true;
    void QRCode.toDataURL(payment.checkoutUrl, {
      width: 300,
      margin: 1,
      errorCorrectionLevel: "M",
      color: { dark: "#0e1517", light: "#f4f7f1" },
    }).then((value) => {
      if (active) setQrImage(value);
    }).catch(() => {
      if (active) setError("二维码生成失败，请使用本设备模拟收银台。 ");
    });
    return () => { active = false; };
  }, [payment.checkoutUrl]);

  useEffect(() => {
    const initial = window.setTimeout(() => setNow(Date.now()), 0);
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    let active = true;
    let handledPaid = false;
    const poll = async () => {
      try {
        const payload = await fetchPaymentStatus(payment.id);
        if (!active) return;
        setStatus(payload.payment.status);
        if (payload.payment.status === "paid" && !handledPaid) {
          handledPaid = true;
          await onPaid();
        }
      } catch (requestError) {
        if (active) setError(requestError instanceof Error ? requestError.message : "支付状态暂时无法读取。");
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 1_500);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [onPaid, payment.id]);

  const expired = status === "expired" || (status === "pending" && remaining === "00:00");
  return (
    <div className="payment-overlay" role="dialog" aria-modal="true" aria-label="模拟扫码支付">
      <section className="payment-modal">
        <button type="button" className="payment-close" onClick={onClose} aria-label="关闭支付窗口"><X size={18} /></button>
        <div className="payment-provider"><span className="payment-provider-mark">￥</span><span>微信支付 · 模拟收银台</span></div>
        <h2>{status === "paid" ? "支付已模拟确认" : expired ? "二维码已过期" : "请使用微信扫码"}</h2>
        <p className="payment-copy">
          {status === "paid"
            ? "桌面端正在为你解锁完整健康地图。"
            : expired
              ? "本次模拟订单已自动关闭，请回到报告页重新生成二维码。"
              : "扫描后会进入演示收银台；全过程不会连接微信，也不会发起真实转账。"}
        </p>
        <div className="payment-amount"><span>演示解锁价</span><strong>￥{(payment.amountFen / 100).toFixed(2)}</strong></div>
        {status === "paid" ? <div className="payment-success"><Check size={20} /> 订阅状态已更新</div> : expired ? <div className="payment-expired"><CircleHelp size={18} /> 请关闭后重新发起模拟支付</div> : <>
          <div className="qr-shell">{qrImage ? <Image src={qrImage} alt="扫描后打开模拟支付收银台" width={300} height={300} unoptimized /> : <span><QrCode size={32} /> 正在生成二维码</span>}</div>
          <div className="payment-timer">二维码剩余 <strong>{remaining}</strong></div>
          <a className="payment-open-link" href={payment.checkoutUrl} target="_blank" rel="noreferrer"><ExternalLink size={15} /> 在本设备打开模拟收银台</a>
        </>}
        {error ? <p className="payment-error" role="alert">{error}</p> : null}
        <p className="payment-order-no">模拟订单号 · {payment.orderNo}</p>
      </section>
    </div>
  );
}
