import { useEffect, useState } from "react";
import { MadeBy } from "../../components/MadeBy";

/** The left half of the sign-in screen: the phone, and what the app is for. */
export function LoginArt() {
  return (
    <section className="relative hidden w-[44%] flex-col overflow-hidden bg-ink p-12 text-white lg:flex">
      <div className="flex flex-1 flex-col items-center justify-center gap-10 pb-8">
        <LockScreen />
        <p className="max-w-xs text-center text-lg leading-8 text-white/65">
          كل جهاز برقمه التسلسلي وسعته ولونه وبطاريته، ويخرج من المخزون مع فاتورته.
        </p>
      </div>
      <MadeBy />
    </section>
  );
}

/** A phone on the counter, showing the shop's clock on its lock screen. */
function LockScreen() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 10_000);
    return () => clearInterval(timer);
  }, []);
  const time = now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  const date = now.toLocaleDateString("ar-EG", { weekday: "long", day: "numeric", month: "long" });

  return (
    <div className="rounded-[3.25rem] bg-ink-3 p-2 shadow-[0_40px_80px_-20px_rgb(0_0_0/0.6),inset_0_1px_0_rgb(255_255_255/0.12)]">
      <div className="relative flex h-[30rem] w-60 flex-col items-center rounded-[2.75rem] bg-readout px-6 pt-4 text-readout-ink">
        <div className="h-6 w-20 rounded-full bg-black ring-1 ring-white/5" aria-hidden />
        <div className="mt-10 text-sm text-readout-ink/70">{date}</div>
        <div dir="ltr" className="font-display text-6xl leading-tight font-extralight">
          {time}
        </div>
        <div className="mt-auto mb-8 text-center font-display text-xl font-light">نقطة بيع الموبايلات</div>
        <div className="mb-2 h-1 w-24 rounded-full bg-readout-ink/60" aria-hidden />
      </div>
    </div>
  );
}
